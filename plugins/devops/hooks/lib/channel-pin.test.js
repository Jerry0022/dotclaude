import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { pinToTag } from "./channel-pin.js";
import {
  STALE_LOCK_MIN_AGE_MS,
  YOUNG_LOCK_MIN_AGE_MS,
  parseEtime,
  parsePs,
  parseWinJson,
  gitProcesses,
  releaseStaleIndexLock,
} from "./stale-index-lock.js";

// The 2026-10-08 incident: a 0-byte .git/index.lock, 2 h old, left by a killed
// git in the marketplace clone. Every `--force` run resolved alpha/v0.249.4,
// the checkout failed with "Another git process seems to be running", HEAD
// stayed on alpha/v0.248.8 and ss.plugin.update printed nothing.

const HOUR = 60 * 60_000;
let dir;
let oldSha;
let newSha;

function git(args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 }).trim();
}

function commit(file, text) {
  fs.writeFileSync(path.join(dir, file), text);
  git(["add", file]);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", file]);
  return git(["rev-parse", "HEAD"]);
}

/** A lock exactly like the incident's: 0 bytes, mtime `ageMs` in the past. */
function plantLock(ageMs, content = "") {
  const lock = path.join(dir, ".git", "index.lock");
  fs.writeFileSync(lock, content);
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(lock, t, t);
  return lock;
}

const noGit = () => [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "channel-pin-test-"));
  git(["init", "-q"]);
  oldSha = commit("a.txt", "one");
  git(["tag", "alpha/v0.248.8"]);
  newSha = commit("b.txt", "two");
  git(["tag", "alpha/v0.249.4"]);
  git(["checkout", "-q", "--detach", "alpha/v0.248.8"]);
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("pinToTag — repair-then-pin with a visible failure", () => {
  test("clean clone: pins to the tag, reports nothing", () => {
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v0.249.4", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: noGit });
    expect(r.ok).toBe(true);
    expect(git(["rev-parse", "HEAD"])).toBe(newSha);
    expect(lines).toEqual([]);
  });

  test("stale 0-byte lock (2 h, no git running): removed, said so, pin lands", () => {
    const lock = plantLock(2 * HOUR);
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v0.249.4", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: noGit });
    expect(r.ok).toBe(true);
    expect(r.lock.status).toBe("removed");
    expect(fs.existsSync(lock)).toBe(false);
    expect(git(["rev-parse", "HEAD"])).toBe(newSha);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/removed stale index\.lock \(0 bytes, 120 min old/);
  });

  test("lock a git process may own: kept, pin fails with ONE line naming tag, HEAD, git error and the pid", () => {
    const lock = plantLock(2 * HOUR);
    const holder = () => [{ pid: 4242, start: Date.now() - 3 * HOUR, cmd: "git checkout main" }];
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v0.249.4", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: holder });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    expect(r.head).toBe(oldSha);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("pin to alpha/v0.249.4 failed — HEAD stays on alpha/v0.248.8");
    expect(lines[0]).toMatch(/index\.lock/); // git's own "Unable to create …index.lock" text
    expect(lines[0]).toContain("git process 4242 may own it");
  });

  // v0.254.0 ship (PR #677): a fresh 0-byte lock, no git running, blocked the
  // self-sync three times — the 10-min age rule alone kept it every time.
  test("young 0-byte lock (40 s, no git running): removed, said so, pin lands", () => {
    const lock = plantLock(40_000);
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v0.249.4", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: noGit });
    expect(r.ok).toBe(true);
    expect(r.lock.status).toBe("removed");
    expect(fs.existsSync(lock)).toBe(false);
    expect(git(["rev-parse", "HEAD"])).toBe(newSha);
    expect(lines).toEqual([expect.stringMatching(/removed stale index\.lock \(0 bytes, 40 s old, no git process holding it\)/)]);
  });

  test("young lock a git process may own: kept, failure names the pid", () => {
    const lock = plantLock(40_000);
    const holder = () => [{ pid: 777, start: Date.now() - 60_000, cmd: "git checkout main" }];
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v0.249.4", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: holder });
    expect(r.ok).toBe(false);
    expect(r.lock.status).toBe("held");
    expect(fs.existsSync(lock)).toBe(true);
    expect(lines[0]).toContain("40 s old; git process 777 may own it");
  });

  test("young lock with an unreadable process list: kept by the age rule, failure names its age", () => {
    plantLock(60_000);
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v0.249.4", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: () => null });
    expect(r.ok).toBe(false);
    expect(r.lock.status).toBe("young");
    expect(lines[0]).toMatch(/younger than 10 min/);
  });

  test("never moves off the channel pin: a pin to an OLDER tag goes there, not to main", () => {
    git(["checkout", "-q", "--detach", "alpha/v0.249.4"]);
    const r = pinToTag({ dir, tag: "alpha/v0.248.8", targetSha: oldSha, listGitProcesses: noGit });
    expect(r.ok).toBe(true);
    expect(git(["rev-parse", "HEAD"])).toBe(oldSha);
  });

  test("unknown tag: fails with git's error, HEAD unchanged", () => {
    const lines = [];
    const r = pinToTag({ dir, tag: "alpha/v9.9.9", targetSha: newSha, report: (l) => lines.push(l), listGitProcesses: noGit });
    expect(r.ok).toBe(false);
    expect(r.head).toBe(oldSha);
    expect(lines[0]).toMatch(/^pin to alpha\/v9\.9\.9 failed — HEAD stays on alpha\/v0\.248\.8: (error|fatal):/);
  });
});

describe("releaseStaleIndexLock — only a lock nobody can own", () => {
  const gitDir = () => path.join(dir, ".git");

  test("no lock → absent", () => {
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: noGit }).status).toBe("absent");
  });

  test("lock with content → kept (may be mid-commit)", () => {
    const lock = plantLock(2 * HOUR, "DIRC");
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: noGit }).status).toBe("nonempty");
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("age fallback: process list unreadable → old lock 'unknown', young lock 'young', both kept", () => {
    const lock = plantLock(STALE_LOCK_MIN_AGE_MS - 30_000);
    const mtime = fs.statSync(lock).mtimeMs;
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: () => null }).status).toBe("young");
    expect(releaseStaleIndexLock({ gitDir: gitDir(), now: mtime + STALE_LOCK_MIN_AGE_MS, listGitProcesses: () => null }).status).toBe("unknown");
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("young lock, no git running → removed without the process list being skipped", () => {
    const lock = plantLock(30_000);
    let listed = 0;
    const r = releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: () => { listed++; return []; } });
    expect(r.status).toBe("removed");
    expect(listed).toBe(1);
    expect(fs.existsSync(lock)).toBe(false);
  });

  test("a lock seconds old is never touched, not even with no git running", () => {
    const lock = plantLock(0);
    const mtime = fs.statSync(lock).mtimeMs;
    let listed = 0;
    const r = releaseStaleIndexLock({ gitDir: gitDir(), now: mtime + YOUNG_LOCK_MIN_AGE_MS - 1, listGitProcesses: () => { listed++; return []; } });
    expect(r.status).toBe("young");
    expect(listed).toBe(0);
    expect(fs.existsSync(lock)).toBe(true);
    expect(releaseStaleIndexLock({ gitDir: gitDir(), now: mtime + YOUNG_LOCK_MIN_AGE_MS, listGitProcesses: noGit }).status).toBe("removed");
  });

  test("young lock with a git that started before it → held, kept", () => {
    const lock = plantLock(30_000);
    const holder = () => [{ pid: 9, start: Date.now() - 45_000, cmd: "git pull --ff-only origin main" }];
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: holder })).toMatchObject({ status: "held", pids: [9] });
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("process list unreadable → kept as unknown", () => {
    const lock = plantLock(2 * HOUR);
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: () => null }).status).toBe("unknown");
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("git started AFTER the lock was written cannot own it → removed", () => {
    plantLock(2 * HOUR);
    const later = () => [{ pid: 1, start: Date.now() - 5_000, cmd: "git status" }];
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: later }).status).toBe("removed");
  });

  test("long-running read-only git (fsmonitor daemon, IDE cat-file) is ignored", () => {
    plantLock(2 * HOUR);
    const daemons = () => [
      { pid: 1, start: Date.now() - 5 * HOUR, cmd: "git fsmonitor--daemon run --detach" },
      { pid: 2, start: Date.now() - 5 * HOUR, cmd: "\"C:\\Program Files\\Git\\cmd\\git.exe\" cat-file --batch" },
    ];
    expect(releaseStaleIndexLock({ gitDir: gitDir(), listGitProcesses: daemons }).status).toBe("removed");
  });
});

describe("process listing", () => {
  test("parseEtime handles mm:ss, hh:mm:ss and dd-hh:mm:ss", () => {
    expect(parseEtime("05:03")).toBe(303);
    expect(parseEtime("02:00:01")).toBe(7201);
    expect(parseEtime("1-00:00:00")).toBe(86400);
    expect(parseEtime("garbage")).toBeNull();
  });

  test("parsePs keeps only git, with absolute start times", () => {
    const now = 1_000_000_000;
    const out = "  12   01:00 /usr/bin/git checkout x\n  13   01:00 node git.js\n  14 1-00:00:00 git fetch\n";
    expect(parsePs(out, now)).toEqual([
      { pid: 12, start: now - 60_000, cmd: "/usr/bin/git checkout x" },
      { pid: 14, start: now - 86_400_000, cmd: "git fetch" },
    ]);
  });

  test("parseWinJson accepts an array, a single object and empty output", () => {
    expect(parseWinJson("")).toEqual([]);
    expect(parseWinJson("[]")).toEqual([]);
    expect(parseWinJson('{"pid":7,"start":5,"cmd":"git.exe status"}')).toEqual([{ pid: 7, start: 5, cmd: "git.exe status" }]);
    expect(parseWinJson('[{"pid":7,"start":5,"cmd":null}]')).toEqual([{ pid: 7, start: 5, cmd: "" }]);
  });

  test("gitProcesses reads the real process table on this platform (array, never throws)", () => {
    const procs = gitProcesses();
    expect(Array.isArray(procs)).toBe(true);
    for (const p of procs) expect(Number.isFinite(p.start)).toBe(true);
  }, 20_000);
});
