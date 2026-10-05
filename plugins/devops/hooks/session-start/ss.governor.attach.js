#!/usr/bin/env node
/**
 * @hook ss.governor.attach
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Registers the session with the Claude load governor and starts
 *   its watcher detached (a running watcher makes the new one exit at once).
 *   Writes ~/.claude/governor/sessions/<id>.json (hook pids, cwd, plugin
 *   version); the watcher puts the session's claude process into the named
 *   job `Local\dotclaude-gov-s-<id>` and reverses orphaned throttles on start.
 *   No-op when disabled (`"enabled": false` in governor/config.json) or on a
 *   platform without an adapter. Never blocks: fail open, no waiting.
 */

require('../lib/plugin-guard');

const path = require('path');

function main(hook) {
  const { hasAdapter } = require('../../scripts/governor/adapters');
  if (!hasAdapter()) return null;
  const { paths, loadConfig } = require('../../scripts/governor/config');
  const S = require('../../scripts/governor/state');
  const p = paths();
  if (!loadConfig(p).enabled) return null;
  const id = String(hook.session_id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return null;
  let version = '0.0.0';
  try { version = require('../../.claude-plugin/plugin.json').version; } catch {}
  S.writeJson(path.join(p.sessions, `${id}.json`), {
    sessionId: id, hookPid: process.pid, hookPpid: process.ppid, cwd: hook.cwd || null, startedAt: Date.now(), pluginVersion: version,
  });
  if (process.env.DOTCLAUDE_GOVERNOR_NO_SPAWN === '1') return null; // test seam
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'governor', 'watcher.js')], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  return null;
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'SessionStart' }); } catch { /* fail open */ }
}

module.exports = { main };
