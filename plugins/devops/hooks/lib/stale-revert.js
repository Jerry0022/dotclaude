/**
 * @module stale-revert
 * @version 0.1.0
 * @description Is a worktree's uncommitted "work" only an older state of the
 *   base branch? A checkout whose files were never refreshed after its branch
 *   moved forward shows the newer base commits in reverse as changes — parking
 *   that as "work" preserved a pure revert of a shipped release (#877).
 *
 *   Per changed path, compared with `base` (e.g. origin/main):
 *   - same as the base tip            → neutral (no change vs base)
 *   - a blob the path held earlier in base history (within HISTORY commits)
 *                                     → revert
 *   - deleted, and the path was added inside that history window → revert
 *   - anything else                   → own content
 *   `stale` = at least one non-deletion revert and no own content: pure
 *   deletions alone never count (deleting files is a normal change).
 *
 *   Read-only, never throws; any git failure answers `stale: false`.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HISTORY = 300;
const MAX_PATHS = 300;

function git(args, cwd) {
  try {
    return execFileSync('git', args, { windowsHide: true, cwd, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/** The blob the working-tree file would get, or null when it does not exist. */
function worktreeBlob(wt, rel) {
  const abs = path.join(wt, rel);
  try { if (!fs.lstatSync(abs).isFile()) return null; } catch { return null; }
  return git(['hash-object', '--', rel], wt);
}

/** Blobs the path held in base history, and whether it was added in that window. */
function history(wt, base, rel) {
  const out = git(['log', `-n${HISTORY}`, '--format=', '--raw', '--no-abbrev', '--no-renames', base, '--', rel], wt);
  const blobs = new Set();
  let added = false;
  if (!out) return { blobs, added };
  for (const line of out.split('\n')) {
    const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/.exec(line);
    if (!m) continue;
    for (const b of [m[1], m[2]]) if (!/^0+$/.test(b)) blobs.add(b);
    if (m[3] === 'A') added = true;
  }
  return { blobs, added };
}

/**
 * @param {string} wt worktree root
 * @param {string[]} paths changed paths, relative to `wt`
 * @param {string} base ref to compare against (e.g. "origin/main")
 * @returns {{stale:boolean, reverted:string[], own:string[]}}
 */
function staleRevert(wt, paths, base) {
  const none = { stale: false, reverted: [], own: [] };
  if (!wt || !base || !Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS) return none;
  if (!git(['rev-parse', '--verify', '-q', `${base}^{commit}`], wt)) return none;
  const reverted = [];
  const own = [];
  let restored = 0;
  for (const rel of paths) {
    const now = worktreeBlob(wt, rel);
    const tip = git(['rev-parse', '-q', '--verify', `${base}:${rel}`], wt);
    if (now === tip) continue;
    const h = history(wt, base, rel);
    if (now && h.blobs.has(now)) { reverted.push(rel); restored++; }
    else if (!now && tip && h.added) reverted.push(rel);
    else own.push(rel);
  }
  return { stale: restored > 0 && own.length === 0, reverted, own };
}

module.exports = { staleRevert, HISTORY };
