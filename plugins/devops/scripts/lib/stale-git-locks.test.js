import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const { clearStaleLocks } = createRequire(import.meta.url)("./stale-git-locks.js");

const HOUR = 3_600_000;
const dirs = [];
afterEach(() => {
  while (dirs.length) try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* temp */ }
});
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "locks-")));
  dirs.push(d);
  git(d, "init", "-q", "-b", "main");
  git(d, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c0");
  git(d, "update-ref", "refs/remotes/origin/pr/1", "HEAD");
  return d;
}
function lockAt(file, ageMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
}

describe("clearStaleLocks", () => {
  test("removes old ref, packed-refs and maintenance locks; keeps fresh ones and index.lock", () => {
    const d = repo();
    const g = path.join(d, ".git");
    const old = [
      path.join(g, "refs", "remotes", "origin", "pr", "1.lock"),
      path.join(g, "packed-refs.lock"),
      path.join(g, "objects", "maintenance.lock"),
    ];
    for (const f of old) lockAt(f, 6 * 24 * HOUR);
    const fresh = path.join(g, "refs", "heads", "busy.lock");
    lockAt(fresh, 60_000);
    const index = path.join(g, "index.lock");
    lockAt(index, 6 * 24 * HOUR);

    const removed = clearStaleLocks(d);
    expect(removed.map((f) => path.relative(g, f).replace(/\\/g, "/")).sort())
      .toEqual(["objects/maintenance.lock", "packed-refs.lock", "refs/remotes/origin/pr/1.lock"]);
    for (const f of old) expect(fs.existsSync(f)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(index)).toBe(true);
  });

  test("a maintenance.lock survives a long gc (kept under 24 h), a missing repo clears nothing", () => {
    const d = repo();
    const m = path.join(d, ".git", "objects", "maintenance.lock");
    lockAt(m, 3 * HOUR);
    expect(clearStaleLocks(d)).toEqual([]);
    expect(fs.existsSync(m)).toBe(true);
    expect(clearStaleLocks(undefined)).toEqual([]);
  });

  test("a stale ref lock no longer blocks deleting that ref", () => {
    const d = repo();
    lockAt(path.join(d, ".git", "refs", "remotes", "origin", "pr", "1.lock"), 2 * HOUR);
    expect(() => git(d, "update-ref", "-d", "refs/remotes/origin/pr/1")).toThrow();
    clearStaleLocks(d);
    git(d, "update-ref", "-d", "refs/remotes/origin/pr/1");
    expect(git(d, "for-each-ref", "refs/remotes")).toBe("");
  });

  test("works from a linked worktree (common dir) and outside a repo returns []", () => {
    const d = repo();
    const wt = path.join(d, "..", `${path.basename(d)}-wt`);
    dirs.push(wt);
    git(d, "worktree", "add", "-q", "-b", "side", wt);
    lockAt(path.join(d, ".git", "refs", "heads", "x.lock"), 2 * HOUR);
    expect(clearStaleLocks(wt)).toHaveLength(1);
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nolocks-")));
    dirs.push(plain);
    expect(clearStaleLocks(plain)).toEqual([]);
  });
});
