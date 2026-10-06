#!/usr/bin/env node
/**
 * @hook pre.governor.gate
 * @version 0.2.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Admission gate of the Claude load governor.
 *   1. Records a foreground tool call (not run_in_background), scoped to the
 *      session id with a short TTL, so the watcher only caps — never pauses —
 *      what Claude is waiting on.
 *   2. Heavy-looking starts (builds, tests, installs, docker, generators) and,
 *      while a resource they need is under priority/over budget, escape routes
 *      (wsl, schtasks, Start-Process -Verb, sc create, systemd-run) ask for a
 *      slot: policy.admit against the watcher's state file (fail open when the
 *      state is missing or stale). Allowed → proceed. Deferred → the command
 *      is RECORDED in the watcher's queue; the governor does not run it. The
 *      call is refused and Claude is told it will be offered again when
 *      resources free up — meanwhile defer the dependent steps and report
 *      them as open.
 *   Spawns the watcher (detached) on both the allow and defer paths when the
 *   state is missing/stale, so a defer is re-evaluated. Fail open on any error.
 */

require('../lib/plugin-guard');

const path = require('path');

const SHELLS = { Bash: 'bash', PowerShell: 'powershell' };

function spawnWatcher() {
  if (process.env.DOTCLAUDE_GOVERNOR_NO_SPAWN === '1') return;
  try {
    const { spawn } = require('child_process');
    spawn(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'governor', 'watcher.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* fail open */ }
}

function main(hook, deps = {}) {
  const shell = SHELLS[hook.tool_name];
  if (!shell) return null;
  const { hasAdapter } = require('../../scripts/governor/adapters');
  if (!(deps.supported ?? hasAdapter())) return null;
  const { paths, loadConfig } = require('../../scripts/governor/config');
  const S = require('../../scripts/governor/state');
  const P = require('../../scripts/governor/policy');
  const p = paths();
  const cfg = loadConfig(p);
  if (!cfg.enabled) return null;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) return null;
  const sid = String(hook.session_id || 'nosession').replace(/[^A-Za-z0-9_-]/g, '');
  const tid = String(hook.tool_use_id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '');
  const now = deps.now || Date.now();
  const fgFile = path.join(p.foreground, `${sid}-${tid}.json`);
  if (!input.run_in_background) S.writeJson(fgFile, { sessionId: sid, startedAt: now, command: command.slice(0, 160), kind: P.commandKind(command) });

  const c = P.classifyCommand(command);
  if (!c.kind && !c.escape) return null;
  const state = S.readState(p);
  const res = P.admit({ command, now, state, kinds: (state && state.kinds) || {}, cfg });
  const log = require('../../scripts/governor/log').hookLogger(p, cfg, 'gate');
  log.event('admit', { decision: res.decision, reason: res.reason, kind: res.kind, escape: c.escape || undefined, session: sid, command });
  if (res.decision === 'allow') {
    if (res.reason === 'watcher-absent') spawnWatcher();
    return null;
  }
  // Deferred: record it with the state it was deferred at (drift context for Claude); do NOT run it.
  const Q = require('../../scripts/governor/queue');
  const cwd = typeof hook.cwd === 'string' ? hook.cwd : process.cwd();
  const git = deps.git || ((cc) => { const { gitOut } = require('../lib/git-timeout'); return { branch: gitOut(cc, ['rev-parse', '--abbrev-ref', 'HEAD']), head: gitOut(cc, ['rev-parse', 'HEAD']) }; });
  let g = {};
  try { g = git(cwd) || {}; } catch { g = {}; }
  const e = Q.newEntry({ command, cwd, branch: g.branch || null, head: g.head || null, sessionId: sid, kind: res.kind, reason: res.reason, now });
  const rec = Q.record(p.queue, e, now, cfg);
  log.event('queue-defer', { id: rec.id, kind: rec.kind, reason: res.reason, reused: rec.id !== e.id || undefined });
  S.removeFile(fgFile);
  if (!state || now - (state.heartbeat || 0) >= cfg.admission.staleMs) spawnWatcher();
  const yieldsTo = res.reason.startsWith('priority:') ? 'an app that has priority right now' : 'the 80 % resource budget';
  return {
    block: `[governor] Not starting this now — heavy work yields to ${yieldsTo} (${res.reason}).\n`
      + 'The governor recorded the command and will tell you (this session or the next one in this repo) when the resources are free, so you can re-run it yourself under normal permissions.\n'
      + 'For now: do NOT start it another way, defer the steps that depend on its result, and report those steps as open. Continue with other work.',
  };
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'PreToolUse' }); } catch { /* fail open */ }
}

module.exports = { main };
