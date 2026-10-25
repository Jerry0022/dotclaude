'use strict';
/**
 * @module scripts/lib/stale-git-locks
 * @version 0.1.0
 * @plugin devops
 * @description Removes ref and maintenance lock files that a crashed git
 *   process left behind. One leftover `refs/remotes/origin/x.lock` makes every
 *   later `git fetch --prune` fail on the WHOLE prune ("cannot lock ref"), and
 *   callers that run it quietly never notice: dead tracking refs and landed
 *   leftovers then pile up for days. A live git operation holds a ref lock
 *   for seconds, so only ref locks older than `maxAgeMs` (default 1 h) go;
 *   `objects/maintenance.lock` is held for a whole gc/repack, which can run
 *   past an hour, so it gets `maintenanceMaxAgeMs` (default 24 h).
 *   Covered: `refs/**\/*.lock`, `packed-refs.lock`, `objects/maintenance.lock`
 *   in the repo's common dir. A worktree's `index.lock` is not touched (that
 *   is the session's own state; git-sync repairs it). Fails closed: any error
 *   leaves the file.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_AGE_MS = 3_600_000;
const DEFAULT_MAINTENANCE_MAX_AGE_MS = 24 * 3_600_000;

function commonDir(repo) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? path.resolve(repo, out) : null;
  } catch { return null; }
}

function lockFilesUnder(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) lockFilesUnder(p, out);
    else if (e.isFile() && e.name.endsWith('.lock')) out.push(p);
  }
}

/**
 * Delete lock files older than `maxAgeMs` in the repo's common git dir.
 * @param {string} repo  any checkout (main or worktree) of the repo
 * @param {{maxAgeMs?:number, maintenanceMaxAgeMs?:number, now?:number}} [opts]
 * @returns {string[]} the removed paths
 */
function clearStaleLocks(repo, {
  maxAgeMs = DEFAULT_MAX_AGE_MS, maintenanceMaxAgeMs = DEFAULT_MAINTENANCE_MAX_AGE_MS, now = Date.now(),
} = {}) {
  // no repo given: never fall back to the process cwd (some other repo)
  if (!repo) return [];
  const git = commonDir(repo);
  if (!git) return [];
  const candidates = [];
  lockFilesUnder(path.join(git, 'refs'), candidates);
  candidates.push(path.join(git, 'packed-refs.lock'));
  const maintenance = path.join(git, 'objects', 'maintenance.lock');
  candidates.push(maintenance);
  const removed = [];
  for (const f of candidates) {
    try {
      const limit = f === maintenance ? maintenanceMaxAgeMs : maxAgeMs;
      if (now - fs.statSync(f).mtimeMs <= limit) continue;
      fs.unlinkSync(f);
      removed.push(f);
    } catch { /* missing or busy — leave it */ }
  }
  return removed;
}

module.exports = { clearStaleLocks, DEFAULT_MAX_AGE_MS, DEFAULT_MAINTENANCE_MAX_AGE_MS };
