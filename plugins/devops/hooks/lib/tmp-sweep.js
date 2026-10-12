/**
 * TTL sweep for the plugin's `dotclaude-*` entries in os.tmpdir() (#699).
 *
 * Hooks and MCP servers keep per-session / per-turn markers as small temp
 * files and nothing removed them: one machine collected ~5,300 in a week.
 * This sweep deletes `dotclaude-*` files (and the `dotclaude-cacherebuild-*`
 * scratch dirs) whose mtime is older than the TTL. Anything a live session
 * still uses is touched far more often than that; a session idle longer than
 * the TTL at worst re-runs a once-per-session step.
 *
 * Never swept, whatever their age:
 *   - durable per-repo / per-user state read across sessions
 *     (`dotclaude-team-changelog-*` "last shown", `dotclaude-locale*`)
 *   - live-process bookkeeping (`dotclaude-mcp-*` pid/heartbeat/status,
 *     `dotclaude-inuse-*`, any `*.pid` / `*.lock`)
 *
 * Throttled by a stamp file, bounded, fail-silent: it never throws.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TTL_MS = 48 * 60 * 60 * 1000;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
const MAX_REMOVALS = 5000;
const STAMP = 'dotclaude-tmp-sweep.stamp';

const KEEP = [
  /^dotclaude-team-changelog-/,
  /^dotclaude-locale/,
  /^dotclaude-mcp-/,
  /^dotclaude-inuse-/,
  /\.(pid|lock)$/,
];
const SWEEPABLE_DIR = /^dotclaude-cacherebuild-/;

function isSweepable(name) {
  return name.startsWith('dotclaude-') && name !== STAMP && !KEEP.some((re) => re.test(name));
}

/**
 * @param {{dir?: string, now?: number, ttlMs?: number, force?: boolean,
 *          throttleMs?: number, maxRemovals?: number}} [opts]
 * @returns {{ran: boolean, scanned: number, removed: number}}
 */
function sweepTmp(opts = {}) {
  const dir = opts.dir || os.tmpdir();
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const throttleMs = opts.throttleMs ?? THROTTLE_MS;
  const maxRemovals = opts.maxRemovals ?? MAX_REMOVALS;
  const out = { ran: false, scanned: 0, removed: 0 };
  try {
    const stamp = path.join(dir, STAMP);
    if (!opts.force) {
      try {
        if (now - fs.statSync(stamp).mtimeMs < throttleMs) return out;
      } catch { /* no stamp yet — run */ }
    }
    try { fs.writeFileSync(stamp, new Date(now).toISOString()); } catch { /* best effort */ }
    out.ran = true;

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (out.removed >= maxRemovals) break;
      if (!isSweepable(e.name)) continue;
      const isDir = e.isDirectory();
      if (isDir && !SWEEPABLE_DIR.test(e.name)) continue;
      if (!isDir && !e.isFile()) continue;
      out.scanned++;
      const p = path.join(dir, e.name);
      try {
        if (now - fs.statSync(p).mtimeMs <= ttlMs) continue;
        if (isDir) fs.rmSync(p, { recursive: true, force: true });
        else fs.unlinkSync(p);
        out.removed++;
      } catch { /* gone already, or held open — skip */ }
    }
  } catch { /* never throw */ }
  return out;
}

module.exports = { sweepTmp, isSweepable, TTL_MS, THROTTLE_MS, STAMP };
