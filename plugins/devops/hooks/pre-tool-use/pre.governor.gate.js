#!/usr/bin/env node
/**
 * @hook pre.governor.gate
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Admission gate of the Claude load governor.
 *   1. Records a foreground tool call (not run_in_background) so the watcher
 *      only caps — never pauses — what Claude is waiting on.
 *   2. Heavy-looking starts (builds, tests, installs, docker, generators) and,
 *      while priority/over-budget is active, escape routes (wsl, schtasks,
 *      Start-Process -Verb, sc, systemd-run …) ask for a slot: policy.admit
 *      against the watcher's state file. Allowed → a RAM reservation is
 *      written; deferred → the command goes into the watcher's queue (cwd,
 *      branch, HEAD) and the call is refused with the queue id and log path.
 *   Fail open on any error; no network, no waiting beyond a 150 ms file lock.
 *   Inline `DOTCLAUDE_GOVERNOR=off` in the command skips the gate.
 */

require('../lib/plugin-guard');

const path = require('path');

const SHELLS = { Bash: 'bash', PowerShell: 'powershell' };

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
  if (!command || /\bDOTCLAUDE_GOVERNOR=off\b/.test(command)) return null;
  const sid = String(hook.session_id || 'nosession').replace(/[^A-Za-z0-9_-]/g, '');
  const tid = String(hook.tool_use_id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '');
  const now = deps.now || Date.now();
  const fgFile = path.join(p.foreground, `${sid}-${tid}.json`);
  if (!input.run_in_background) S.writeJson(fgFile, { sessionId: sid, startedAt: now, command: command.slice(0, 200) });

  if (!P.commandKind(command) && !P.isEscape(command)) return null;
  const state = S.readState(p);
  const res = S.withDirLock(p.reservations, () => {
    const reservations = S.readDir(p.reservations).map((x) => x.data);
    const r = P.admit({ command, now, state, reservations, kinds: (state && state.kinds) || {}, cfg });
    if (r.decision === 'allow' && r.reserve) S.writeJson(path.join(p.reservations, `${sid}-${tid}.json`), { mb: r.expectedMB, kind: r.kind, expiresAt: now + cfg.admission.reserveMs });
    return r;
  });
  if (res.decision === 'allow') {
    if (res.reason === 'watcher-absent' && process.env.DOTCLAUDE_GOVERNOR_NO_SPAWN !== '1') {
      const { spawn } = require('child_process');
      spawn(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'governor', 'watcher.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
    return null;
  }
  // Deferred: queue it with the state it must still match when it runs.
  const Q = require('../../scripts/governor/queue');
  const cwd = typeof hook.cwd === 'string' ? hook.cwd : process.cwd();
  const git = deps.git || ((c) => {
    const { gitOut } = require('../lib/git-timeout');
    return { branch: gitOut(c, ['rev-parse', '--abbrev-ref', 'HEAD']), head: gitOut(c, ['rev-parse', 'HEAD']) };
  });
  let g = {};
  try { g = git(cwd) || {}; } catch { g = {}; }
  const e = Q.newEntry({ command, shell, cwd, branch: g.branch || null, head: g.head || null, sessionId: sid, kind: res.kind, reason: res.reason, now });
  Q.save(p.queue, e);
  S.removeFile(fgFile);
  const cli = path.join(__dirname, '..', '..', 'scripts', 'governor', 'cli.js');
  return {
    block: `[governor] Not started now (${res.reason}): heavy work yields to ${res.reason.startsWith('priority:') ? 'an app with priority' : 'the 80 % resource budget'}.\n`
      + `Queued as ${e.id}; the governor runs it when resources are free (cwd/branch/HEAD are re-checked first).\n`
      + `Log: ${Q.logFile(p.queue, e.id)}\n`
      + 'Do NOT start it another way. Defer the steps that depend on its result and report them as open; continue with other work.\n'
      + `Queue: node "${cli}" queue`,
  };
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'PreToolUse' }); } catch { /* fail open */ }
}

module.exports = { main };
