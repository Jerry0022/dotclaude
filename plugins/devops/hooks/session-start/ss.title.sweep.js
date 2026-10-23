#!/usr/bin/env node
/**
 * @hook ss.title.sweep
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Fixes sidebar titles a crash or an app quit left on ⏳. A turn
 *   that ends normally swaps the hourglass in its Stop hook (F5); a killed
 *   process runs no Stop hook, so after a restart every session that was
 *   working still reads "⏳ … working" until the user resumes it. Hooks cannot
 *   rename sessions — this one finds the candidates on disk (lib/stale-titles:
 *   ⏳ title sidecar, transcript idle ≥ 2 min, no live governor pid) and hands
 *   Claude the exact old → new titles; Claude renames those whose
 *   list_sessions row says `isRunning:false` to `👉 ➜ ⚡ Interrupted ┃ <title>`.
 *   Reported sessions go into ~/.claude/title-sweep-seen.json (session id →
 *   transcript mtime) so the next session start does not repeat them.
 *   Silent when nothing is stale. Never blocks: fail open.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LISTED = 25;
const SEEN_TTL_MS = 14 * 24 * 3_600_000;

function seenPath() {
  return process.env.DEVOPS_TITLE_SWEEP_SEEN || path.join(os.homedir(), '.claude', 'title-sweep-seen.json');
}

function readSeen(file) {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

/** Seen map with `stale` added and entries older than the TTL dropped. */
function nextSeen(seen, stale, now = Date.now()) {
  const out = {};
  for (const [id, t] of Object.entries(seen)) if (Number.isFinite(t) && now - t < SEEN_TTL_MS) out[id] = t;
  for (const s of stale) out[s.sessionId] = s.mtimeMs;
  return out;
}

/** The additionalContext for `stale`, or null. */
function buildContext(stale) {
  if (!stale.length) return null;
  const rows = stale.slice(0, MAX_LISTED).map((s) => `  ${JSON.stringify(s.title)} → ${JSON.stringify(s.next)}`);
  return [
    '[ss.title.sweep] Desktop app only, once, silently, in this turn\'s first tool batch: these sessions still',
    'show ⏳ although their transcript has been idle — the app or Claude Code was closed or crashed mid-turn.',
    `Call mcp__ccd_session_mgmt__list_sessions {limit: 50}; for every row with isRunning:false whose title`,
    'equals a left-hand title below, call mcp__ccd_session_mgmt__set_session_title {session_id: <its sessionId>,',
    'title: <the right-hand title>}. Leave running rows, rows not listed and archived sessions alone.',
    'Tools only deferred → load them with ToolSearch first. Unavailable or failing: skip, no retry, no note.',
    'Do not mention this to the user.',
    ...rows,
  ].join('\n');
}

function main(hook) {
  const selfId = String(hook.session_id || '');
  const file = seenPath();
  const seen = readSeen(file);
  const { findStaleTitles } = require('../lib/stale-titles');
  const stale = findStaleTitles({ selfId, seen });
  const ctx = buildContext(stale);
  if (!ctx) return null;
  try { fs.writeFileSync(file, JSON.stringify(nextSeen(seen, stale))); } catch { /* best effort */ }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } };
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'SessionStart' }); } catch { /* fail open */ }
}

module.exports = { main, buildContext, nextSeen, seenPath };
