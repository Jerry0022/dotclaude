#!/usr/bin/env node
/**
 * @hook ss.mcp.reap
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Reclaim orphaned Claude Desktop MCP server processes leaked by
 *   previously-closed sessions, in the background, without delaying session
 *   start.
 *
 *   Spawns scripts/mcp-reap.js DETACHED, fire-and-forget, windowless
 *   (`{ detached: true, stdio: 'ignore', windowsHide: true }` + `.unref()`)
 *   in --apply mode, then exits 0 immediately — the hook never waits on the
 *   child. The detached CLI persists its own JSON result to a temp status
 *   file (dotclaude-mcp-reap-status.json in os.tmpdir(), see
 *   scripts/mcp-reap.js) so a later "what did it reap?" is inspectable even
 *   though stdout is discarded here.
 *
 *   Silent by design: no stdout, no startup noise — this is the
 *   SessionStart half of the background reap mechanism. The periodic half
 *   (subsequent turns, without a restart) is stop.mcp.reap.js, cooldown-
 *   gated so it doesn't spawn a scan every turn.
 *
 *   Windows-gated cheaply: mcp-reaper.js's orphan detection is a documented
 *   no-op on non-win32 platforms (dead-parent PID signal only means
 *   anything on Windows — see that module's header), so spawning it
 *   elsewhere would just be wasted process-creation cost.
 *
 *   Guarded end-to-end: any throw here is swallowed and the hook still
 *   exits 0 — reaping is a nice-to-have, never allowed to block or fail a
 *   session start.
 */

require('../lib/plugin-guard');

try {
  if (process.platform === 'win32') {
    const path = require('path');
    const { spawn } = require('child_process');

    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
    const scriptPath = path.join(pluginRoot, 'scripts', 'mcp-reap.js');

    const child = spawn(process.execPath, [scriptPath, '--apply', '--json'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
} catch {
  // Never block session start — reaping is best-effort.
}

process.exit(0);
