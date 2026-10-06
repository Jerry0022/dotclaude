#!/usr/bin/env node
/**
 * @hook prompt.governor.resume
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Tells the session when deferred heavy commands can run again.
 *   The governor never runs a deferred command itself (that would bypass
 *   Claude's permission prompts and could run against a stale tree). Instead
 *   the watcher marks an entry `ready` once resources are free; this hook,
 *   on the next prompt in the same repo, injects "N command(s) can run again"
 *   with each command and a drift note, then removes the entries so the
 *   notice never repeats. Claude re-runs them under normal permissions.
 *   Silent and fail-open when disabled or nothing is ready.
 */

require('../lib/plugin-guard');

function main(hook) {
  const { hasAdapter } = require('../../scripts/governor/adapters');
  if (!hasAdapter()) return null;
  const { paths, loadConfig } = require('../../scripts/governor/config');
  const S = require('../../scripts/governor/state');
  const Q = require('../../scripts/governor/queue');
  const p = paths();
  const cfg = loadConfig(p);
  if (!cfg.enabled) return null;
  const cwd = typeof hook.cwd === 'string' ? hook.cwd : process.cwd();
  const now = Date.now();
  const liveSessions = new Set(S.readDir(p.sessions).map((x) => x.data.sessionId).filter(Boolean));
  const sessionId = String(hook.session_id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const ready = Q.readyFor(Q.list(p.queue), now, cfg, { cwd, sessionId, liveSessions });
  if (!ready.length) return null;
  const lines = ready.map((e) => {
    const drift = e.branch ? ` (deferred on branch ${e.branch}@${String(e.head || '').slice(0, 8)}; re-check the tree still matches before running)` : '';
    S.removeFile(require('path').join(p.queue, `${e.id}.json`));
    return `  - ${e.command}${drift}`;
  });
  require('../../scripts/governor/log').hookLogger(p, cfg, 'resume').event('queue-inject', { session: sessionId, n: ready.length, ids: ready.map((e) => e.id) });
  return `[governor] ${ready.length} deferred command(s) can run again — resources are free. Re-run the ones still needed, under normal permissions:\n${lines.join('\n')}`;
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'UserPromptSubmit' }); } catch { /* fail open */ }
}

module.exports = { main };
