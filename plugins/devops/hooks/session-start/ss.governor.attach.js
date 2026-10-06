#!/usr/bin/env node
/**
 * @hook ss.governor.attach
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Registers the session with the Claude load governor and starts
 *   its watcher detached (a running watcher makes the new one exit at once).
 *   Writes ~/.claude/governor/sessions/<id>.json (the session's claude pid,
 *   cwd, plugin version); the watcher attributes by claude ancestry, expires
 *   the session when that pid is gone, and reverses orphaned throttles on start.
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
    // The session's Claude Code process: Claude exports CLAUDE_PID to its children; the hook's own
    // parent may be a short-lived shell. The watcher walks up from here to the Claude root.
    sessionId: id, claudePid: Number(process.env.CLAUDE_PID) || process.ppid, hookPid: process.pid, cwd: hook.cwd || null, startedAt: Date.now(), pluginVersion: version,
  });
  require('../../scripts/governor/log').hookLogger(p, loadConfig(p), 'attach').event('session-start', { session: id, claudePid: Number(process.env.CLAUDE_PID) || process.ppid });
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
