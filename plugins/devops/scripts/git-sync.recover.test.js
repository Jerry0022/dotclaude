import { describe, test, expect, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const R = require("../hooks/lib/git-sync-recover.js");

/**
 * The repair git-sync runs after a merge that died mid-checkout (2026-09-26:
 * a fast-forward killed by the 15 s budget left half of #543 on disk, HEAD and
 * index on the old commit, and a stale index.lock — reported only as "merge
 * refused, no conflicted files"). These tests build that state by hand, byte
 * for byte, in a real repository; git-sync.midcheckout.test.js produces it
 * with a real merge.
 */

const repos = [];
afterEach(() => {
  while (repos.length) {
    try { fs.rmSync(repos.pop(), { recursive: true, force: true, maxRetries: 3 }); } catch { /* disposable */ }
  }
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

function raw(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}
const sh = (cwd, args) => raw(cwd, args).trim();

/**
 * main = preHead's content moved on by one "incoming" commit; `feature` sits
 * on the old commit. autocrlf off, so byte comparisons below are exact.
 */
function makeRepo(base, incoming) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-recover-"));
  repos.push(dir);
  sh(dir, ["init", "-q", "-b", "main"]);
  sh(dir, ["config", "core.autocrlf", "false"]);
  sh(dir, ["config", "commit.gpgsign", "false"]);
  put(dir, base);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "-m", "base"]);
  sh(dir, ["branch", "feature"]);
  put(dir, incoming);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "-m", "incoming"]);
  sh(dir, ["checkout", "-q", "feature"]);
  const run = R.gitRunner({ cwd: dir, timeoutMs: 60_000 });
  return { dir, run, preHead: sh(dir, ["rev-parse", "HEAD"]), gitDir: sh(dir, ["rev-parse", "--absolute-git-dir"]) };
}

/** Write `{file: content}`; `null` deletes. */
function put(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(dir, file);
    if (content === null) { fs.rmSync(abs, { force: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

const bytes = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");
const exists = (dir, file) => fs.existsSync(path.join(dir, file));
// Porcelain lines start with a space for unstaged changes — never trimmed.
const status = dir => raw(dir, ["status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean).sort();

describe("restoreIncomingTree — a fast-forward that died mid-checkout", () => {
  test("puts back what the merge wrote, keeps the user's work, names what matches neither side", () => {
    const { dir, run, preHead, gitDir } = makeRepo(
      {
        "keep.txt": "keep\n", "mod.txt": "old mod\n", "rewrite.txt": "old rewrite\n",
        "del.txt": "to delete\n", "race.txt": "old race\n", "user.txt": "user base\n",
      },
      {
        "mod.txt": "new mod\n", "rewrite.txt": "new rewrite\n", "del.txt": null,
        "add.txt": "added\n", "nested/deep/new.txt": "nested\n", "race.txt": "new race\n",
      },
    );
    // The shape the killed merge left: written, unlinked mid-rewrite, the
    // source's deletion applied, a new file on disk, a new file not reached
    // yet, a stale lock — plus the user's own edit elsewhere, and an incoming
    // path someone edited meanwhile.
    put(dir, {
      "mod.txt": "new mod\n", "rewrite.txt": null, "del.txt": null, "add.txt": "added\n",
      "nested/deep/new.txt": null, "race.txt": "typed during the merge\n", "user.txt": "user edit\n",
    });
    fs.writeFileSync(path.join(gitDir, "index.lock"), "");

    expect(R.releaseKilledIndexLock({ gitDir, startedAt: Date.now() - 1000, timedOut: true })).toBe("removed");
    const rec = R.restoreIncomingTree({ run, top: dir, preHead, source: "main" });

    expect(rec.error).toBeUndefined();
    expect(rec.restored.sort()).toEqual(["del.txt", "mod.txt", "rewrite.txt"]);
    expect(rec.removed).toEqual(["add.txt"]);
    expect(rec.manual).toEqual(["race.txt"]);

    expect(bytes(dir, "mod.txt")).toBe("old mod\n");
    expect(bytes(dir, "rewrite.txt")).toBe("old rewrite\n");
    expect(bytes(dir, "del.txt")).toBe("to delete\n");
    expect(exists(dir, "add.txt")).toBe(false);
    expect(exists(dir, "nested")).toBe(false);
    expect(bytes(dir, "race.txt")).toBe("typed during the merge\n");
    expect(bytes(dir, "user.txt")).toBe("user edit\n");
    expect(status(dir)).toEqual([" M race.txt", " M user.txt"]);
    expect(sh(dir, ["rev-parse", "HEAD"])).toBe(preHead);
    expect(exists(gitDir, "index.lock")).toBe(false);
  });

  test("a directory the merge created for a new file goes with it", () => {
    const { dir, run, preHead } = makeRepo({ "a.txt": "a\n" }, { "fresh/sub/b.txt": "b\n", "fresh/sub/c.txt": "c\n" });
    put(dir, { "fresh/sub/b.txt": "b\n" }); // c.txt not reached

    const rec = R.restoreIncomingTree({ run, top: dir, preHead, source: "main" });

    expect(rec.removed).toEqual(["fresh/sub/b.txt"]);
    expect(exists(dir, "fresh")).toBe(false);
    expect(status(dir)).toEqual([]);
  });

  test(".gitattributes goes back first, so restored files get preHead's eol settings", () => {
    const { dir, run, preHead } = makeRepo(
      { "mod.txt": "old mod\n" },
      { ".gitattributes": "*.txt text eol=crlf\n", "mod.txt": "new mod\n" },
    );
    // As the merge wrote them: the new attributes, then mod.txt under them.
    put(dir, { ".gitattributes": "*.txt text eol=crlf\n", "mod.txt": "new mod\r\n" });

    const rec = R.restoreIncomingTree({ run, top: dir, preHead, source: "main" });

    expect(rec.manual).toEqual([]);
    expect(rec.removed).toEqual([".gitattributes"]);
    expect(rec.restored).toEqual(["mod.txt"]);
    // Checked out under the incoming attributes it would be "old mod\r\n".
    expect(bytes(dir, "mod.txt")).toBe("old mod\n");
    expect(status(dir)).toEqual([]);
  });

  test("nothing reached the work tree → nothing to do", () => {
    const { dir, run, preHead } = makeRepo({ "a.txt": "a\n" }, { "a.txt": "A\n", "b.txt": "b\n" });
    put(dir, { "other.txt": "unrelated scratch\n" });

    expect(R.restoreIncomingTree({ run, top: dir, preHead, source: "main" })).toEqual({ restored: [], removed: [], manual: [] });
    expect(status(dir)).toEqual(["?? other.txt"]);
  });

  test("an unreadable source is reported, not guessed at", () => {
    const { dir, run, preHead } = makeRepo({ "a.txt": "a\n" }, { "a.txt": "A\n" });
    expect(R.restoreIncomingTree({ run, top: dir, preHead, source: "no-such-ref" }).error).toBe("incoming diff unreadable");
  });
});

describe("releaseKilledIndexLock — only the killed child's lock", () => {
  const withLock = (mtimeMs) => {
    const { gitDir } = makeRepo({ "a.txt": "a\n" }, { "a.txt": "A\n" });
    const lock = path.join(gitDir, "index.lock");
    fs.writeFileSync(lock, "");
    if (mtimeMs) fs.utimesSync(lock, mtimeMs / 1000, mtimeMs / 1000);
    return { gitDir, lock };
  };

  test("a lock written after the merge started, after a timeout → removed", () => {
    const { gitDir, lock } = withLock();
    expect(R.releaseKilledIndexLock({ gitDir, startedAt: Date.now() - 500, timedOut: true })).toBe("removed");
    expect(fs.existsSync(lock)).toBe(false);
  });

  test("a lock older than the merge is someone else's", () => {
    const startedAt = Date.now();
    const { gitDir, lock } = withLock(startedAt - 60_000);
    expect(R.releaseKilledIndexLock({ gitDir, startedAt, timedOut: true })).toBe("held");
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("git cleans its own lock on a normal failure — a lock then is someone else's", () => {
    const { gitDir, lock } = withLock();
    expect(R.releaseKilledIndexLock({ gitDir, startedAt: Date.now() - 500, timedOut: false })).toBe("held");
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("no lock → absent", () => {
    const { gitDir } = makeRepo({ "a.txt": "a\n" }, { "a.txt": "A\n" });
    expect(R.releaseKilledIndexLock({ gitDir, startedAt: Date.now(), timedOut: true })).toBe("absent");
  });
});

describe("headState", () => {
  test("unchanged, completed (the merge landed before it was stopped), moved", () => {
    const { dir, run, preHead } = makeRepo({ "a.txt": "a\n" }, { "a.txt": "A\n" });
    expect(R.headState(run, preHead, "main")).toBe("unchanged");

    sh(dir, ["merge", "-q", "--ff-only", "main"]);
    expect(R.headState(run, preHead, "main")).toBe("completed");

    sh(dir, ["reset", "-q", "--hard", preHead]);
    put(dir, { "own.txt": "own\n" });
    sh(dir, ["add", "-A"]);
    sh(dir, ["commit", "-q", "-m", "own work, not the source"]);
    expect(R.headState(run, preHead, "main")).toBe("moved");
  });
});

describe("writeTimeoutMs — the writing calls' ceiling", () => {
  test("defaults far above the 15 s read budget, and never below it", () => {
    expect(R.writeTimeoutMs({}, 15_000)).toBe(R.WRITE_TIMEOUT_DEFAULT_MS);
    expect(R.WRITE_TIMEOUT_DEFAULT_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(R.writeTimeoutMs({}, 400_000)).toBe(400_000);
  });

  test("DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS overrides, capped; junk is ignored", () => {
    expect(R.writeTimeoutMs({ DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS: "2500" }, 15_000)).toBe(2500);
    expect(R.writeTimeoutMs({ DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS: "999999999" }, 15_000)).toBe(R.WRITE_TIMEOUT_MAX_MS);
    for (const junk of ["", "abc", "0", "-5"]) {
      expect(R.writeTimeoutMs({ DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS: junk }, 15_000)).toBe(R.WRITE_TIMEOUT_DEFAULT_MS);
    }
  });
});

describe("firstErrorLine", () => {
  test("git's own reason, one line, bounded", () => {
    expect(R.firstErrorLine("refusing b.slow\nerror: external filter 'x' failed 3\nerror: external filter 'x' failed\n"))
      .toBe("error: external filter 'x' failed 3");
    expect(R.firstErrorLine("fatal: refusing to merge unrelated histories\n")).toBe("fatal: refusing to merge unrelated histories");
    expect(R.firstErrorLine("just a line\r\n")).toBe("just a line");
    expect(R.firstErrorLine("")).toBe("");
    expect(R.firstErrorLine(`error: ${"x".repeat(400)}`)).toHaveLength(160);
  });
});
