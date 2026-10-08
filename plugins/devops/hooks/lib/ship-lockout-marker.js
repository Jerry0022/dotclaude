'use strict';
/**
 * @module ship-lockout-marker
 * @version 0.1.0
 * @plugin devops
 * @description The per-ship lockout marker `.claude/.ship-lockout`.
 *
 *   /do-ship Pre-Step A persists `$SHIP_LOCKOUT` in this file so a compaction
 *   during the CI wait cannot drop it: every interactive gate re-derives the
 *   lockout from the file's presence. A marker that outlives its ship is
 *   therefore harmful — the next interactive /do-ship would take every
 *   non-interactive BLOCK branch as if the user were AFK.
 *
 *   It used to be written and deleted only by skill prose, and deleted only in
 *   the success cleanup (Step 5); every `ship-blocked` / aborted exit stranded
 *   it, with no expiry. Now code owns it end to end:
 *     - `autonomous-lockout.js check --ship` (Pre-Step A, the start of EVERY
 *       ship) writes it when the lockout is active and deletes it otherwise,
 *       so a leftover can never reach a new ship;
 *     - `ship_cleanup` deletes it on every return path that clears the
 *       ship-in-progress sentinel (success, keep-mode, the ship-blocked exits);
 *     - a marker older than MARKER_TTL_MS is stale and ignored + removed by
 *       `readMarker`, the last line for a crash between those two.
 *
 *   Anchored at the repo root (project-root.js) like every runtime artifact.
 */

const fs = require('fs');
const path = require('path');
const { projectRoot } = require('./project-root');

const MARKER_FILE = '.ship-lockout';
/** One ship — the same horizon as autonomous-lockout's `do-run` TTL and the `.ship-queue` stale rule. */
const MARKER_TTL_MS = 6 * 60 * 60 * 1000;

function markerPath(cwd) {
  // Literal name, not MARKER_FILE: scripts/check-claude-artifacts.js scans for it.
  return path.join(projectRoot(cwd), '.claude', '.ship-lockout');
}

/**
 * Write (or refresh) the marker. Never throws.
 * @param {string} cwd
 * @param {{owner?:string|null, session?:string|null}} [info] the active lockout
 * @param {number} [now] epoch ms (tests)
 * @returns {boolean} written
 */
function writeMarker(cwd, info = {}, now = Date.now()) {
  if (!cwd) return false;
  const p = markerPath(cwd);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      owner: info.owner || null,
      session: info.session || null,
      written: new Date(now).toISOString(),
    }), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Delete the marker; true when a file was removed. Never throws. */
function clearMarker(cwd) {
  if (!cwd) return false;
  try {
    fs.unlinkSync(markerPath(cwd));
    return true;
  } catch {
    return false;
  }
}

/**
 * The marker when it is live; a stale one (older than MARKER_TTL_MS, by its
 * `written` stamp or, unparseable — e.g. the pre-0.1.0 bare `1` — by mtime) is
 * removed and reported as inactive.
 * @param {string} cwd
 * @param {number} [now] epoch ms (tests)
 * @returns {{active:boolean, stale?:boolean, removed?:boolean, owner?:string|null, written?:string|null}}
 */
function readMarker(cwd, now = Date.now()) {
  if (!cwd) return { active: false };
  const p = markerPath(cwd);
  let text;
  let mtimeMs;
  try {
    text = fs.readFileSync(p, 'utf8');
    mtimeMs = fs.statSync(p).mtimeMs;
  } catch {
    return { active: false };
  }
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || typeof data !== 'object') data = {};
  const written = typeof data.written === 'string' ? data.written : null;
  let t = written ? Date.parse(written) : NaN;
  if (!Number.isFinite(t)) t = mtimeMs;
  const owner = typeof data.owner === 'string' ? data.owner : null;
  if (Number.isFinite(t) && now - t > MARKER_TTL_MS) {
    return { active: false, stale: true, removed: clearMarker(cwd), owner, written };
  }
  return { active: true, owner, written };
}

module.exports = {
  MARKER_FILE,
  MARKER_TTL_MS,
  markerPath,
  writeMarker,
  clearMarker,
  readMarker,
};
