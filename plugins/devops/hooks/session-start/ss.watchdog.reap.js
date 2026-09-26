#!/usr/bin/env node
/**
 * @hook ss.watchdog.reap
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Removes expired ClaudeAutonomousWatchdog-* scheduled tasks
 *   left behind by earlier autonomous runs (#544), in the background, without
 *   delaying session start.
 *
 *   A one-shot scheduled task is not removed by Task Scheduler after it
 *   fired, so every autonomous run registered before the recovery script
 *   learned to delete its own task — or killed before it could — left a dead
 *   entry behind. Spawns `scripts/autonomous-watchdog.js reap --apply
 *   --cooldown-hours=24` DETACHED, fire-and-forget, windowless, and exits 0
 *   at once. The CLI removes only tasks with our exact name that are not
 *   running and will never fire again; an armed watchdog of a run still in
 *   progress stays. The 24 h cooldown keeps the Task Scheduler query to one
 *   per day, however many sessions start.
 *
 *   Windows-only: the watchdog exists only there. Silent and guarded end to
 *   end — a failure here never blocks or fails a session start.
 */

require('../lib/plugin-guard');

try {
  if (process.platform === 'win32') {
    const path = require('path');
    const { spawn } = require('child_process');

    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
    const scriptPath = path.join(pluginRoot, 'scripts', 'autonomous-watchdog.js');

    const child = spawn(process.execPath, [scriptPath, 'reap', '--apply', '--cooldown-hours=24'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
} catch {
  // Never block session start — the sweep is best-effort.
}

process.exit(0);
