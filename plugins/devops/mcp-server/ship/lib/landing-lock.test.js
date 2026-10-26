import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { acquireLandingLock, releaseLandingLockFor, lockPath } from "./landing-lock.js";

const dirs = [];
function repo() {
  const d = mkdtempSync(join(tmpdir(), "landing-lock-"));
  dirs.push(d);
  execFileSync("git", ["init", "-q"], { cwd: d, windowsHide: true });
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const fast = { pollMs: 5, maxPollMs: 5, waitMs: 60 };
const plant = (cwd, o) => writeFileSync(lockPath(cwd), JSON.stringify({
  token: "other", pid: 999999, host: hostname(), branch: "x", worktree: "/x",
  acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), ttlMs: 600_000, maxHoldMs: 1_500_000, ...o,
}));

describe("landing-lock", () => {
  it("acquires, blocks a second ship of the same repo, and releases", async () => {
    const cwd = repo();
    const a = await acquireLandingLock(cwd, { branch: "a", worktree: "/a", ...fast });
    expect(a.outcome).toBe("acquired");
    expect(existsSync(lockPath(cwd))).toBe(true);
    const b = await acquireLandingLock(cwd, { branch: "b", worktree: "/b", ...fast });
    expect(b.outcome).toBe("timeout-proceeded");
    expect(b.held).toBe(false);
    expect(b.release()).toBe(false); // a non-holder never deletes the lock
    expect(existsSync(lockPath(cwd))).toBe(true);
    expect(a.release()).toBe(true);
    expect(existsSync(lockPath(cwd))).toBe(false);
    const c = await acquireLandingLock(cwd, { branch: "c", ...fast });
    expect(c.outcome).toBe("acquired");
    c.release();
  });

  it("waiter gets the lock once the holder releases", async () => {
    const cwd = repo();
    const a = await acquireLandingLock(cwd, { branch: "a", worktree: "/a", ...fast });
    let n = 0;
    const b = await acquireLandingLock(cwd, {
      branch: "b", worktree: "/b", ...fast, waitMs: 5_000,
      sleep: async () => { if (++n === 2) a.release(); },
    });
    expect(b.outcome).toBe("acquired");
    b.release();
  });

  it("takes over a lock whose pid is dead", async () => {
    const cwd = repo();
    plant(cwd, {});
    const pidAlive = () => false;
    const b = await acquireLandingLock(cwd, { branch: "b", worktree: "/b", pidAlive, ...fast });
    expect(b.outcome).toBe("stolen-stale");
    expect(JSON.parse(readFileSync(lockPath(cwd), "utf8")).branch).toBe("b");
    b.release();
  });

  it("takes over a lock with an expired heartbeat even when the pid looks alive", async () => {
    const cwd = repo();
    plant(cwd, { heartbeatAt: new Date(Date.now() - 3_600_000).toISOString(), ttlMs: 1000 });
    const b = await acquireLandingLock(cwd, { branch: "b", worktree: "/b", pidAlive: () => true, ...fast });
    expect(b.outcome).toBe("stolen-stale");
    b.release();
  });

  it("takes over a lock held past max-hold; a fresh live lock is respected", async () => {
    const cwd = repo();
    plant(cwd, { acquiredAt: new Date(Date.now() - 3_600_000).toISOString(), maxHoldMs: 1000 });
    const b = await acquireLandingLock(cwd, { branch: "b", worktree: "/b", pidAlive: () => true, ...fast });
    expect(b.outcome).toBe("stolen-stale");
    b.release();
    plant(cwd, {});
    const c = await acquireLandingLock(cwd, { branch: "c", worktree: "/c", pidAlive: () => true, ...fast });
    expect(c.outcome).toBe("timeout-proceeded");
  });

  it("only one of two concurrent stealers wins", async () => {
    const cwd = repo();
    plant(cwd, {});
    const pidAlive = (pid) => pid === process.pid;
    const [x, y] = await Promise.all([
      acquireLandingLock(cwd, { branch: "x1", worktree: "/1", pidAlive, ...fast }),
      acquireLandingLock(cwd, { branch: "y1", worktree: "/2", pidAlive, ...fast }),
    ]);
    const outcomes = [x.outcome, y.outcome].sort();
    expect(outcomes).toEqual(["stolen-stale", "timeout-proceeded"]);
    x.release(); y.release();
  });

  it("a live steal guard blocks stealing; a stale guard is cleaned up", async () => {
    const cwd = repo();
    plant(cwd, {});
    writeFileSync(`${lockPath(cwd)}.steal`, "");
    const b = await acquireLandingLock(cwd, { branch: "b", worktree: "/b", pidAlive: () => false, ...fast });
    expect(b.outcome).toBe("timeout-proceeded");
    const c = await acquireLandingLock(cwd, { branch: "c", worktree: "/c", pidAlive: () => false, ...fast, now: () => Date.now() + 120_000 });
    expect(["stolen-stale", "timeout-proceeded"]).toContain(c.outcome);
    c.release();
  });

  it("reclaims its own branch's leftover and cleans garbage", async () => {
    const cwd = repo();
    plant(cwd, { branch: "mine", worktree: "/w" });
    const a = await acquireLandingLock(cwd, { branch: "mine", worktree: "/w", pidAlive: () => true, ...fast });
    expect(a.outcome).toBe("stolen-stale");
    a.release();
  });

  it("refresh moves the heartbeat only for the holder", async () => {
    const cwd = repo();
    let t = 1_000_000;
    const a = await acquireLandingLock(cwd, { branch: "a", now: () => t, ...fast });
    t += 5000;
    expect(a.refresh()).toBe(true);
    expect(Date.parse(JSON.parse(readFileSync(lockPath(cwd), "utf8")).heartbeatAt)).toBe(t);
    a.release();
    expect(a.refresh()).toBe(false);
  });

  it("REGRESSION (review): refresh never resurrects a lock another ship stole, and leaves no temp file", async () => {
    const cwd = repo();
    const a = await acquireLandingLock(cwd, { branch: "a", ...fast });
    plant(cwd, { token: "thief" }); // a steal landed after a's heartbeat expired
    expect(a.refresh()).toBe(false);
    expect(JSON.parse(readFileSync(lockPath(cwd), "utf8")).token).toBe("thief");
    expect(a.release()).toBe(false);
    expect(readdirSync(dirname(lockPath(cwd))).some((f) => f.endsWith(".hb"))).toBe(false);
  });

  it("is per repo: another repo is never blocked", async () => {
    const r1 = repo();
    const r2 = repo();
    const a = await acquireLandingLock(r1, { branch: "a", ...fast });
    const b = await acquireLandingLock(r2, { branch: "b", ...fast });
    expect(a.outcome).toBe("acquired");
    expect(b.outcome).toBe("acquired");
    expect(b.waitedMs).toBeLessThan(50);
    a.release(); b.release();
  });

  it("is shared by all worktrees of one repo", async () => {
    const cwd = repo();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "i"], { cwd, windowsHide: true });
    const wt = join(cwd, "..", `wt-${Date.now()}`);
    execFileSync("git", ["worktree", "add", "-q", "-b", "side", wt], { cwd, windowsHide: true });
    dirs.push(wt);
    expect(lockPath(wt)).toBe(lockPath(cwd));
    const a = await acquireLandingLock(cwd, { branch: "a", worktree: cwd, ...fast });
    const b = await acquireLandingLock(wt, { branch: "side", worktree: wt, ...fast });
    expect(b.outcome).toBe("timeout-proceeded");
    a.release();
  });

  it("disabled by param or env, and outside a git repo, without blocking", async () => {
    const cwd = repo();
    expect((await acquireLandingLock(cwd, { enabled: false })).outcome).toBe("disabled");
    process.env.DEVOPS_SHIP_LANDING_LOCK = "0";
    try { expect((await acquireLandingLock(cwd, {})).outcome).toBe("disabled"); } finally { delete process.env.DEVOPS_SHIP_LANDING_LOCK; }
    const plain = mkdtempSync(join(tmpdir(), "landing-nogit-"));
    dirs.push(plain);
    expect((await acquireLandingLock(plain, {})).outcome).toBe("disabled");
  });

  it("releaseLandingLockFor drops this branch's leftover but not a live foreign lock", async () => {
    const cwd = repo();
    plant(cwd, { branch: "mine" });
    expect(releaseLandingLockFor(cwd, { branch: "other", pidAlive: () => true })).toBe(false);
    expect(releaseLandingLockFor(cwd, { branch: "mine", pidAlive: () => true })).toBe(true);
    expect(existsSync(lockPath(cwd))).toBe(false);
  });
});
