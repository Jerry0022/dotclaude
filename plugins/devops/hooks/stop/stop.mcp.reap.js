#!/usr/bin/env node
/**
 * @hook stop.mcp.reap
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Periodic background reclaim of orphaned Claude Desktop MCP
 *   server processes — the "runs on its own without a restart" half of the
 *   mechanism (ss.mcp.reap.js only covers SessionStart, which happens once).
 *
 *   Cooldown-gated to ~20 minutes, per-worktree, using the exact same
 *   atomic write-temp-then-rename marker pattern as
 *   stop.flow.selfcalibration.js: the marker file is keyed to an md5 hash
 *   of process.cwd() in os.tmpdir(), so parallel worktrees each get their
 *   own independent cooldown clock.
 *
 *   When the cooldown has elapsed: refresh the marker FIRST (so a burst of
 *   rapid Stop events can't all slip through before the first spawn lands),
 *   then spawn scripts/mcp-reap.js DETACHED, fire-and-forget, windowless
 *   (`{ detached: true, stdio: 'ignore', windowsHide: true }` + `.unref()`)
 *   in --apply mode, and exit 0. Silent — no stdout either way.
 *
 *   Degrades safely if os.tmpdir() is unwritable: the marker write fails
 *   silently (best-effort, non-fatal) and the cooldown check simply never
 *   finds a marker, so the hook fires every turn instead of crashing —
 *   same documented degrade as self-calibration's cooldown.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const COOLDOWN_MS = 20 * 60 * 1000;

function worktreeKey() {
  const cwd = process.cwd().replace(/\\/g, '/');
  return crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
}

function markerFile() {
  return path.join(os.tmpdir(), `dotclaude-devops-mcp-reap-wt-${worktreeKey()}`);
}

// Atomic write: write to a pid-suffixed temp file, then rename. Prevents a
// concurrent Stop hook from observing a half-written marker.
function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function spawnReaper() {
  try {
    if (process.platform !== 'win32') return; // documented no-op elsewhere, see mcp-reaper.js
    const { spawn } = require('child_process');
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
    const scriptPath = path.join(pluginRoot, 'scripts', 'mcp-reap.js');

    const child = spawn(process.execPath, [scriptPath, '--apply', '--json'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Never block Stop — reaping is best-effort.
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  try {
    const file = markerFile();

    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs < COOLDOWN_MS) {
        process.exit(0);
      }
    } catch {
      // No marker yet (or unreadable) — treat as cooldown elapsed, proceed.
    }

    atomicWrite(file, String(Date.now()));
    spawnReaper();
  } catch {
    // Never block Stop.
  }
  process.exit(0);
});
