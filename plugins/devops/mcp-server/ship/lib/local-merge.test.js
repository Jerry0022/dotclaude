import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { localMerge, localTag, LocalMergeError } from "./local-merge.js";

// Real git in a throwaway repo without a remote — the exact situation the
// local merge exists for.
let root;
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

function commitFile(name, content, msg, cwd = root) {
  fs.writeFileSync(path.join(cwd, name), content);
  git(["add", name], cwd);
  git(["commit", "-q", "-m", msg], cwd);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "local-merge-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "core.autocrlf", "false"]);
  commitFile("a.txt", "one\n", "init");
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("localMerge — landing a branch on its local base without a remote", () => {
  test("squash: base gets one new commit carrying the branch's tree; the checked-out base follows", () => {
    git(["switch", "-q", "-c", "feat/x"]);
    commitFile("b.txt", "two\n", "feat: b");
    commitFile("c.txt", "three\n", "feat: c");
    // main is not checked out anywhere → ref update path
    const res = localMerge({ branch: "feat/x", base: "main", strategy: "squash", message: "feat: x\n\nbody", cwd: root });
    expect(res.via).toBe("ref");
    expect(git(["rev-parse", "main"])).toBe(res.mergeSha);
    expect(git(["rev-parse", "main^{tree}"])).toBe(git(["rev-parse", "feat/x^{tree}"]));
    expect(git(["rev-list", "--count", "main"])).toBe("2"); // init + one squash commit
    expect(git(["log", "-1", "--format=%s", "main"])).toBe("feat: x");
  });

  test("the base checked out in another worktree is fast-forwarded there", () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "local-merge-wt-"));
    fs.rmSync(wt, { recursive: true, force: true });
    git(["worktree", "add", "-q", "-b", "feat/y", wt]);
    commitFile("d.txt", "four\n", "feat: d", wt);
    try {
      const res = localMerge({ branch: "feat/y", base: "main", strategy: "merge", message: "Merge feat/y", cwd: wt });
      expect(res.via).toBe("worktree");
      expect(git(["rev-parse", "HEAD"])).toBe(res.mergeSha);
      expect(fs.existsSync(path.join(root, "d.txt"))).toBe(true); // main's checkout followed
      expect(git(["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ")).toHaveLength(3); // merge commit
    } finally {
      git(["worktree", "remove", "--force", wt]);
    }
  });

  test("a base that moved ahead asks for a rebase and writes nothing", () => {
    git(["switch", "-q", "-c", "feat/z"]);
    commitFile("e.txt", "five\n", "feat: e");
    git(["switch", "-q", "main"]);
    commitFile("f.txt", "six\n", "fix: f");
    const before = git(["rev-parse", "main"]);
    git(["switch", "-q", "feat/z"]);
    expect(() => localMerge({ branch: "feat/z", base: "main", message: "m", cwd: root }))
      .toThrowError(expect.objectContaining({ code: "rebase-required" }));
    expect(git(["rev-parse", "main"])).toBe(before);
  });

  test("a dirty checkout of the base is never overwritten", () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "local-merge-wt-"));
    fs.rmSync(wt, { recursive: true, force: true });
    git(["worktree", "add", "-q", "-b", "feat/w", wt]);
    commitFile("g.txt", "seven\n", "feat: g", wt);
    fs.writeFileSync(path.join(root, "a.txt"), "local edit\n");
    try {
      let err;
      try { localMerge({ branch: "feat/w", base: "main", message: "m", cwd: wt }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(LocalMergeError);
      expect(err.code).toBe("base-dirty");
      expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("local edit\n");
    } finally {
      git(["worktree", "remove", "--force", wt]);
    }
  });

  test("an untracked file in the base checkout that the branch adds blocks cleanly, with a code", () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "local-merge-wt-"));
    fs.rmSync(wt, { recursive: true, force: true });
    git(["worktree", "add", "-q", "-b", "feat/u", wt]);
    commitFile("clash.txt", "from branch\n", "feat: clash", wt);
    fs.writeFileSync(path.join(root, "clash.txt"), "untracked in main\n");
    const before = git(["rev-parse", "main"]);
    try {
      let err;
      try { localMerge({ branch: "feat/u", base: "main", message: "m", cwd: wt }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(LocalMergeError);
      expect(err.code).toBe("base-blocked");
      expect(git(["rev-parse", "main"])).toBe(before);
      expect(fs.readFileSync(path.join(root, "clash.txt"), "utf8")).toBe("untracked in main\n");
    } finally {
      git(["worktree", "remove", "--force", wt]);
    }
  });

  test("after a squash the branch points at what landed, so the next ship needs no rebase", () => {
    git(["switch", "-q", "-c", "feat/k"]);
    commitFile("k.txt", "k\n", "feat: k");
    const res = localMerge({ branch: "feat/k", base: "main", strategy: "squash", message: "feat: k", cwd: root });
    expect(res.branchSynced).toBe(true);
    expect(git(["rev-parse", "HEAD"])).toBe(res.mergeSha);
    commitFile("k2.txt", "k2\n", "feat: k2");
    const next = localMerge({ branch: "feat/k", base: "main", strategy: "squash", message: "feat: k2", cwd: root });
    expect(git(["rev-parse", "main"])).toBe(next.mergeSha);
  });

  test("a sub-branch lands on its parent feature branch the same way", () => {
    git(["switch", "-q", "-c", "feat/p"]);
    commitFile("h.txt", "p\n", "feat: parent");
    git(["switch", "-q", "-c", "feat/p-core"]);
    commitFile("i.txt", "core\n", "feat: core");
    const res = localMerge({ branch: "feat/p-core", base: "feat/p", strategy: "squash", message: "feat(core): i", cwd: root });
    expect(git(["rev-parse", "feat/p"])).toBe(res.mergeSha);
    expect(git(["rev-parse", "main"])).not.toBe(res.mergeSha);
  });

  test("shipping on base itself is already landed", () => {
    const res = localMerge({ branch: "main", base: "main", message: "m", cwd: root });
    expect(res.noop).toBe(true);
    expect(res.mergeSha).toBe(git(["rev-parse", "HEAD"]));
  });
});

describe("localTag", () => {
  test("creates the ring tag once and reports an existing one", () => {
    const sha = git(["rev-parse", "HEAD"]);
    expect(localTag({ tag: "alpha/v1.0.0", sha, version: "1.0.0", cwd: root })).toEqual({ created: true });
    expect(git(["rev-parse", "alpha/v1.0.0^{commit}"])).toBe(sha);
    expect(localTag({ tag: "alpha/v1.0.0", sha, version: "1.0.0", cwd: root }).created).toBe(false);
  });
});

describe("detectDefaultBranch without a remote", () => {
  test("a master-only repo lands on master, not a missing main", async () => {
    const { detectDefaultBranch } = await import("./git.js");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "local-merge-master-"));
    try {
      git(["init", "-q", "-b", "master"], repo);
      git(["config", "user.email", "t@example.com"], repo);
      git(["config", "user.name", "t"], repo);
      commitFile("a.txt", "x\n", "init", repo);
      expect(detectDefaultBranch({ cwd: repo })).toBe("master");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
