#!/usr/bin/env node
/**
 * @module concept-port-registry
 * @description Cross-session port-ownership registry for the devops-concept
 *   bridge server (concept-server.py).
 *
 *   THE BUG THIS FIXES: two concurrent concept sessions (different worktrees)
 *   used to pick the SAME random port 8700-8999 and blindly `Stop-Process`
 *   whatever was listening there before binding — so session A would kill
 *   session B's live bridge, B's watchdog respawned it on the wrong cwd, and
 *   the page flapped between "connected" and "HTTP 404 / claude_ts=0". The
 *   `run_in_background` launch also surfaced as a bogus `exit 127` when the
 *   port was reclaimed mid-boot.
 *
 *   THE FIX: every live bridge advertises `{port, pid, worktree, html_path,
 *   started_at}` in a SHARED, per-user location — `~/.claude/concept-bridges/
 *   <port>.json`. Before choosing or sweeping a port, a session consults the
 *   registry:
 *     - `pickFreePort()` skips any port owned by a LIVE FOREIGN session (and
 *       any port currently bound), so two sessions never collide.
 *     - `canClaim()` gates the pre-launch sweep: a port is sweepable only when
 *       it is NOT held by a live foreign session (no entry, our own entry, or a
 *       dead owner all qualify) — so we never kill another session's bridge.
 *
 *   Pure, dependency-free, and fully injectable (read / isAlive / isBound /
 *   rand) so the decision logic is unit-testable without touching the FS or
 *   real processes. concept-server.py writes/removes the entry; this module +
 *   its CLI are what the launch procedure (bridge-server.md) consults.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const REGISTRY_DIR = path.join(os.homedir(), '.claude', 'concept-bridges');
const PORT_MIN = 8700;
const PORT_MAX = 8999;

/** Absolute path of the registry entry for a port. */
function bridgeFile(port) {
  return path.join(REGISTRY_DIR, `${port}.json`);
}

/** Normalize a worktree/path for comparison: forward slashes, no trailing slash, lowercased. */
function normWorktree(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Read a registry entry; returns null on missing dir / missing file / bad JSON. */
function readEntry(port) {
  try {
    return JSON.parse(fs.readFileSync(bridgeFile(port), 'utf8'));
  } catch {
    return null;
  }
}

/** Write (create/overwrite) a registry entry. Creates the registry dir if needed. */
function writeEntry(port, entry) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(bridgeFile(port), JSON.stringify(entry));
}

/** Remove a registry entry; swallow ENOENT and friends. */
function removeEntry(port) {
  try { fs.unlinkSync(bridgeFile(port)); } catch { /* already gone */ }
}

/** Default liveness probe: signal 0 tells us whether a pid exists (EPERM ⇒ alive). */
function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

/**
 * Does this registry entry belong to a LIVE FOREIGN session? Such a port must
 * never be swept or reused. "Foreign" = a different worktree; "live" = its pid
 * is still running. A dead owner (stale entry) is NOT foreign-live — it is free
 * to reclaim.
 */
function isForeignLiveOwner(entry, myWorktree, isAlive = isProcessAlive) {
  if (!entry) return false;
  if (!isAlive(entry.pid)) return false;
  return normWorktree(entry.worktree) !== normWorktree(myWorktree);
}

/**
 * May THIS session sweep + bind `port`? Only when it is not held by a live
 * foreign session. No entry, our own entry, or a dead owner all qualify.
 */
function canClaim(port, { myWorktree, isAlive = isProcessAlive, read = readEntry } = {}) {
  return !isForeignLiveOwner(read(port), myWorktree, isAlive);
}

/**
 * Pick a free bridge port. Randomized scan of the [lo, hi] range so two
 * sessions starting at the same instant are unlikely to probe in lock-step;
 * skips ports owned by a live foreign session AND ports that are currently
 * bound. Returns null when the whole range is exhausted (caller surfaces an
 * error rather than colliding).
 *
 * @param {object} opts
 * @param {string}  opts.myWorktree   this session's worktree (cwd)
 * @param {(pid:number)=>boolean} [opts.isAlive]  liveness probe
 * @param {(port:number)=>boolean} [opts.isBound] is the port currently listening?
 * @param {(port:number)=>object|null} [opts.read] registry reader
 * @param {()=>number} [opts.rand]    RNG in [0,1)
 * @param {[number,number]} [opts.range] inclusive port range
 * @returns {number|null}
 */
function pickFreePort({
  myWorktree,
  isAlive = isProcessAlive,
  isBound = () => false,
  read = readEntry,
  rand = Math.random,
  range = [PORT_MIN, PORT_MAX],
} = {}) {
  const [lo, hi] = range;
  const span = hi - lo + 1;
  if (span <= 0) return null;
  const start = lo + Math.floor(rand() * span);
  for (let i = 0; i < span; i++) {
    const port = lo + (((start - lo) + i) % span);
    if (isForeignLiveOwner(read(port), myWorktree, isAlive)) continue;
    if (isBound(port)) continue;
    return port;
  }
  return null;
}

module.exports = {
  REGISTRY_DIR,
  PORT_MIN,
  PORT_MAX,
  bridgeFile,
  normWorktree,
  readEntry,
  writeEntry,
  removeEntry,
  isProcessAlive,
  isForeignLiveOwner,
  canClaim,
  pickFreePort,
};

// ---------------------------------------------------------------------------
// CLI — consumed by the launch procedure (bridge-server.md § port selection).
//   node concept-port-registry.js pick [myWorktree]       → prints a free port
//   node concept-port-registry.js can-claim <port> [wt]   → exit 0 (yes) / 1 (no)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'pick') {
    const myWorktree = rest[0] || process.cwd();
    const port = pickFreePort({ myWorktree });
    if (port == null) {
      process.stderr.write('concept-port-registry: no free port in range 8700-8999\n');
      process.exit(1);
    }
    process.stdout.write(String(port));
  } else if (cmd === 'can-claim') {
    const port = Number(rest[0]);
    const myWorktree = rest[1] || process.cwd();
    process.exit(canClaim(port, { myWorktree }) ? 0 : 1);
  } else {
    process.stderr.write('usage: concept-port-registry.js pick [worktree] | can-claim <port> [worktree]\n');
    process.exit(2);
  }
}
