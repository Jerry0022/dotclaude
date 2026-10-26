/**
 * @module ship/lib/landing-lock
 * @description Per-REPO landing lock for ship_release. Ships of the same repo
 *   (all worktrees share `git rev-parse --git-common-dir`) serialize between
 *   "final base-freshness check" and "merge + tag", so a second ship does not
 *   spend a CI run on a tree whose base is about to move. Other repos never
 *   block each other, and the lock never blocks a ship for good:
 *
 *   - acquire is atomic (`wx`); content `{ token, pid, host, branch, worktree,
 *     acquiredAt, heartbeatAt, ttlMs, maxHoldMs }`;
 *   - STALE = holder pid dead (same host), OR heartbeat older than ttlMs, OR
 *     held longer than maxHoldMs. A stale lock is taken over under a short-lived
 *     steal guard (`wx`), so two stealers can never both win;
 *   - waiters poll with backoff up to `waitMs`; on timeout they PROCEED without
 *     the lock (the pre-lock behaviour — release.js already copes with a moved
 *     base) and report `outcome: "timeout-proceeded"`;
 *   - every filesystem failure fails open (`outcome: "disabled"` + `reason`);
 *   - release is token-checked (never deletes somebody else's lock), runs in
 *     release.js's `finally`, from ship_cleanup (crash leftover), and on process exit.
 *
 *   Outcomes: "acquired" | "stolen-stale" | "timeout-proceeded" | "disabled".
 */

import { openSync, writeSync, closeSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

export const LOCK_NAME = "devops-landing.lock";
export const DEFAULT_WAIT_MS = 10 * 60_000;
export const DEFAULT_MAX_HOLD_MS = 25 * 60_000;
const GUARD_STALE_MS = 30_000;
const YOUNG_UNREADABLE_MS = 10_000;

/** Locks this process holds — dropped by the exit handler. path → token */
const held = new Map();
let exitHooked = false;

function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", () => {
    for (const [path, token] of held) removeIfOwner(path, (o) => o.token === token);
  });
}

/** The lock file path for the repo of `cwd`, or null outside a git repo. */
export function lockPath(cwd) {
  try {
    const dir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      windowsHide: true, cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return dir ? resolve(cwd, dir, LOCK_NAME) : null;
  } catch { return null; }
}

function pidAliveDefault(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function readOwner(path) {
  try {
    const o = JSON.parse(readFileSync(path, "utf8"));
    return o && typeof o === "object" ? o : undefined;
  } catch (e) {
    return e.code === "ENOENT" ? null : undefined; // null = absent, undefined = unreadable
  }
}

function removeIfOwner(path, pred) {
  try {
    const o = readOwner(path);
    if (o && pred(o)) { unlinkSync(path); return true; }
  } catch { /* gone already */ }
  return false;
}

function staleReason(o, { now, pidAlive }) {
  if (o.host === hostname() && !pidAlive(o.pid)) return "holder-dead";
  if (!(now - Date.parse(o.heartbeatAt) <= (o.ttlMs ?? 0))) return "heartbeat-expired";
  if (!(now - Date.parse(o.acquiredAt) <= (o.maxHoldMs ?? DEFAULT_MAX_HOLD_MS))) return "max-hold-exceeded";
  return null;
}

/**
 * Acquire the landing lock. Always resolves; never throws.
 * @returns {Promise<{ outcome, waitedMs, reason?, held, refresh(), release() }>}
 */
export async function acquireLandingLock(cwd, {
  branch = null, worktree = cwd, ttlMs = 10 * 60_000, maxHoldMs = DEFAULT_MAX_HOLD_MS,
  waitMs = DEFAULT_WAIT_MS, pollMs = 1_000, maxPollMs = 15_000, enabled = true,
  now = () => Date.now(), pidAlive = pidAliveDefault,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const none = (outcome, waitedMs = 0, reason) => ({
    outcome, waitedMs, ...(reason && { reason }), held: false, refresh() { return false; }, release() { return false; },
  });
  if (!enabled || process.env.DEVOPS_SHIP_LANDING_LOCK === "0") return none("disabled", 0, "switched off");
  const path = lockPath(cwd);
  if (!path) return none("disabled", 0, "no git common dir");

  const token = randomBytes(8).toString("hex");
  const mine = () => {
    const t = new Date(now()).toISOString();
    return { token, pid: process.pid, host: hostname(), branch, worktree, acquiredAt: t, heartbeatAt: t, ttlMs, maxHoldMs };
  };
  const start = now();
  const handle = (outcome) => {
    held.set(path, token);
    hookExit();
    return {
      outcome, waitedMs: now() - start, held: true,
      refresh() {
        try {
          const o = readOwner(path);
          if (!o || o.token !== token) return false;
          // Atomic swap, then re-verify: a steal that landed between the read and
          // the rename is detected instead of being overwritten with our token.
          const tmp = `${path}.${token}.hb`;
          writeFileSync(tmp, JSON.stringify({ ...o, heartbeatAt: new Date(now()).toISOString() }));
          renameSync(tmp, path);
          const after = readOwner(path);
          return !!after && after.token === token;
        } catch { return false; }
      },
      release() { held.delete(path); return removeIfOwner(path, (o) => o.token === token); },
    };
  };

  const tryCreate = () => {
    const fd = openSync(path, "wx");
    try { writeSync(fd, JSON.stringify(mine())); } finally { closeSync(fd); }
  };

  // Steal a stale lock under a guard: only the guard holder may replace it, and
  // it re-verifies staleness (and the observed token) right before the swap.
  const steal = (observed) => {
    const guard = `${path}.steal`;
    try {
      try { closeSync(openSync(guard, "wx")); } catch (e) {
        if (e.code !== "EEXIST") throw e;
        try { if (now() - statSync(guard).mtimeMs > GUARD_STALE_MS) unlinkSync(guard); } catch { /* raced */ }
        return false;
      }
      try {
        const cur = readOwner(path);
        const unchanged = cur === undefined ? observed === undefined : cur && observed && cur.token === observed.token;
        if (cur === null) { tryCreate(); return true; }
        if (!unchanged) return false;
        if (cur && !staleReason(cur, { now: now(), pidAlive }) && !(cur.branch === branch && cur.worktree === worktree)) return false;
        const tmp = `${path}.${process.pid}.${token}.tmp`;
        writeFileSync(tmp, JSON.stringify(mine()));
        renameSync(tmp, path); // atomic replace
        const after = readOwner(path);
        return !!after && after.token === token;
      } finally { try { unlinkSync(guard); } catch { /* gone */ } }
    } catch { return false; }
  };

  let delay = pollMs;
  let stolen = false;
  try {
    for (;;) {
      try {
        tryCreate();
        return handle(stolen ? "stolen-stale" : "acquired");
      } catch (e) {
        if (e.code !== "EEXIST") return none("disabled", now() - start, `lock file not usable: ${e.code || e.message}`);
      }
      const o = readOwner(path);
      if (o === null) continue; // vanished between create and read — retry at once
      let takeover = false;
      if (o === undefined) {
        // Unreadable: a holder mid-write, or garbage. Garbage ages out.
        try { takeover = now() - statSync(path).mtimeMs > YOUNG_UNREADABLE_MS; } catch { continue; }
      } else {
        // Our own branch + worktree = a leftover of an earlier crashed attempt.
        takeover = !!staleReason(o, { now: now(), pidAlive }) || (o.branch === branch && o.worktree === worktree && o.token !== token);
      }
      if (takeover && steal(o)) return handle("stolen-stale");
      if (now() - start >= waitMs) return none("timeout-proceeded", now() - start);
      await sleep(Math.min(delay, Math.max(0, waitMs - (now() - start))));
      delay = Math.min(maxPollMs, Math.round(delay * 1.6));
    }
  } catch (e) {
    return none("disabled", now() - start, `lock error: ${e.message}`);
  }
}

/**
 * Drop a lock this branch still holds (crash leftover) — called by ship_cleanup.
 * Only a lock owned by `branch` (or by a dead pid on this host) is removed.
 */
export function releaseLandingLockFor(cwd, { branch, pidAlive = pidAliveDefault } = {}) {
  const path = lockPath(cwd);
  if (!path) return false;
  return removeIfOwner(path, (o) => (branch && o.branch === branch) || (o.host === hostname() && !pidAlive(o.pid)));
}
