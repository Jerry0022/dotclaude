/**
 * @module stale-titles
 * @version 0.2.0
 * @description Finds sessions whose sidebar title still says ⏳ although no
 *   Claude process works on them any more — left behind when the Desktop app
 *   or Claude Code crashed or was quit mid-turn, so no Stop hook (F5) could
 *   swap the hourglass for `👉 ➜ ⚡ Interrupted ┃ `.
 *
 *   Source: the Desktop app keeps each session's current title in the sidecar
 *   `~/.claude/projects/<slug>/<sessionId>/custom-title.json`
 *   (`{"customTitle": …}`) — a few bytes, no transcript tail to read. A
 *   session id can sit under several slugs (it moved into a worktree); the
 *   newest sidecar wins. A candidate needs a ⏳ title (or a 👉 approval head:
 *   a crash mid-approval leaves the finger with nobody left to approve), a transcript idle for
 *   `idleMs`, and no live Claude process in the governor's session file. The
 *   caller's own session is never one. The hook only pre-filters: Claude
 *   still checks `isRunning:false` in list_sessions before renaming.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { STATUS, INTERRUPTED_PREFIX, stripPrefixes, classify } = require('./title-scheme');

const IDLE_MS = 2 * 60_000;
/** A live session idle this long with no open background work is treated as idle too (#964). */
const LIVE_IDLE_MS = 60 * 60_000;
const MAX_AGE_MS = 7 * 24 * 3_600_000;

function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** True when the governor still tracks a live Claude process for `id`. */
function governorAlive(id, governorDir) {
  if (!governorDir) return false;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(governorDir, `${id}.json`), 'utf8'));
    return pidAlive(Number(s.claudePid));
  } catch { return false; }
}

/** True when the transcript shows no open background work (dev servers do not count). Unknown → false. */
function noOpenWork(transcript) {
  try {
    const { scanOpenTasksInFile } = require("./pending-tasks");
    return scanOpenTasksInFile(transcript).length === 0;
  } catch { return false; }
}

/** The title `title` becomes: Interrupted in front of its bare text, or null. */
function interruptedFor(title) {
  if (typeof title !== 'string') return null;
  if (!title.startsWith(STATUS.work) && classify(title) !== 'approval') return null;
  const rest = stripPrefixes(title).trim();
  return rest ? INTERRUPTED_PREFIX + rest : null;
}

/**
 * Stale ⏳ sessions under `root` (`~/.claude/projects`).
 *
 * @param {{ root?: string, governorDir?: string|null, selfId?: string,
 *   now?: number, idleMs?: number, seen?: Record<string, number> }} [o]
 *   `seen` maps session id → transcript mtime already reported; an unchanged
 *   one is skipped so every session start does not repeat the sweep.
 * @returns {{ sessionId: string, title: string, next: string, mtimeMs: number }[]}
 */
function findStaleTitles({
  root = path.join(os.homedir(), '.claude', 'projects'),
  governorDir = path.join(os.homedir(), '.claude', 'governor', 'sessions'),
  selfId = '', now = Date.now(), idleMs = IDLE_MS, seen = {},
} = {}) {
  const newest = new Map();
  let slugs;
  try { slugs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    let ids;
    try { ids = fs.readdirSync(path.join(root, slug.name), { withFileTypes: true }); } catch { continue; }
    for (const id of ids) {
      if (!id.isDirectory() || !/^[\w-]+$/.test(id.name) || id.name === selfId) continue;
      const sidecar = path.join(root, slug.name, id.name, 'custom-title.json');
      const sm = mtime(sidecar);
      if (sm === null || now - sm > MAX_AGE_MS) continue;
      const jsonl = path.join(root, slug.name, `${id.name}.jsonl`);
      const tm = mtime(jsonl) ?? sm;
      const prev = newest.get(id.name);
      if (!prev || sm > prev.sm) newest.set(id.name, { sidecar, sm, jsonl, tm: Math.max(tm, prev ? prev.tm : 0) });
      else prev.tm = Math.max(prev.tm, tm);
    }
  }
  const out = [];
  for (const [sessionId, { sidecar, tm, jsonl }] of newest) {
    if (now - tm < idleMs || seen[sessionId] === tm) continue;
    let title;
    try { title = JSON.parse(fs.readFileSync(sidecar, 'utf8')).customTitle; } catch { continue; }
    const next = interruptedFor(title);
    if (!next) continue;
    // A live process normally keeps the title; only a long idle session whose
    // transcript holds no open work (a dev server does not count) is handed on.
    if (governorAlive(sessionId, governorDir) && (now - tm < LIVE_IDLE_MS || !noOpenWork(jsonl))) continue;
    out.push({ sessionId, title, next, mtimeMs: tm });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

module.exports = { findStaleTitles, interruptedFor, IDLE_MS, LIVE_IDLE_MS };
