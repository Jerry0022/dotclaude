#!/usr/bin/env node
/**
 * @module governor/cli
 * @description `node cli.js status | priority on|off | not-priority <app> |
 *   always-priority <app> | queue | log | report [--hours N] |
 *   wait <queue-id> | wait --command "<cmd>" [--timeout 15m] | stop`.
 *   Writes only CLI-owned files (control.json, config.json); the watcher
 *   picks them up on its next tick. `wait` polls the same admission rule the
 *   gate uses: exit 0 = admitted (re-run the command now), 2 = timeout,
 *   1 = unknown queue id / usage.
 */
'use strict';

const { paths, loadConfig } = require('./config');
const S = require('./state');
const Q = require('./queue');
const P = require('./policy');

/** "900", "90s", "15m", "1h" → ms; NaN when unparsable. */
function parseDuration(s) {
  const m = String(s || '').trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!m) return NaN;
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[(m[2] || 's').toLowerCase()];
  return Number(m[1]) * mult;
}

/**
 * Wait until the gate would admit a command (the queue entry's, or `command`). Bounded; prints why
 * it waits (the pressed resource and its culprit) whenever that changes. A watcher that is gone
 * admits (fail open, like the gate).
 * @returns {Promise<0|1|2>}
 */
async function waitFor({ p, cfg, id, command, timeoutMs = 15 * 60000, pollMs = 3000, now = Date.now, sleep, out }) {
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let cmd = command;
  if (id) {
    const e = Q.list(p.queue).find((x) => x.id === id);
    if (!e) { out(`wait: no queue entry ${id} (expired or already re-run) — just re-run the command; the gate decides again`); return 1; }
    cmd = e.command;
  }
  if (!cmd) { out('usage: wait <queue-id> | wait --command "<cmd>" [--timeout 15m]'); return 1; }
  const start = now();
  let why = null;
  for (;;) {
    const state = S.readState(p);
    const res = P.admit({ command: cmd, now: now(), state, kinds: (state && state.kinds) || {}, cfg });
    const secs = Math.round((now() - start) / 1000);
    if (res.decision === 'allow') {
      out(why ? `admitted after ${secs}s (waited for ${why}) — re-run the command now` : `admitted (${res.reason}) — run the command now`);
      if (id) Q.remove(p.queue, id);
      return 0;
    }
    const cur = `${P.pressedText(res, state)} [${res.reason}]`;
    if (cur !== why) { out(`waiting: ${cur}`); why = cur; }
    const left = timeoutMs - (now() - start);
    if (left <= 0) { out(`timeout after ${secs}s — still waiting for ${why}`); return 2; }
    await nap(Math.min(pollMs, left));
  }
}

function editConfig(p, fn) {
  const raw = S.readJson(p.config, {});
  fn(raw);
  S.writeJson(p.config, raw);
}

function run(argv, out = (s) => process.stdout.write(`${s}\n`)) {
  const p = paths();
  const [cmd, arg] = argv;
  const now = Date.now();
  switch (cmd) {
    case 'priority': {
      if (arg !== 'on' && arg !== 'off') { out('usage: priority on|off'); return 2; }
      S.writeJson(p.control, { ...S.readJson(p.control, {}), manual: arg === 'on', manualAt: now });
      out(`manual priority ${arg}`);
      return 0;
    }
    case 'not-priority':
    case 'always-priority': {
      if (!arg) { out(`usage: ${cmd} <app folder or exe>`); return 2; }
      const listKey = cmd === 'not-priority' ? 'neverPriority' : 'alwaysPriority';
      const other = cmd === 'not-priority' ? 'alwaysPriority' : 'neverPriority';
      editConfig(p, (c) => {
        c[listKey] = Array.from(new Set([...(c[listKey] || []), arg]));
        c[other] = (c[other] || []).filter((x) => x !== arg);
      });
      out(`${arg} added to ${listKey}`);
      return 0;
    }
    case 'log': {
      const L = require('./log');
      const i = argv.indexOf('--runs');
      const runs = i >= 0 ? Math.max(1, parseInt(argv[i + 1], 10) || 1) : 1;
      for (const l of L.readable(p.logs, runs)) out(l);
      if (argv.includes('--tail')) {
        const files = L.runFiles(p.logs);
        const file = require('path').join(p.logs, files[files.length - 1] || 'hooks.jsonl');
        let pos = (() => { try { return require('fs').statSync(file).size; } catch { return 0; } })();
        const fs = require('fs');
        setInterval(() => {
          try {
            const size = fs.statSync(file).size;
            if (size > pos) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(size - pos); fs.readSync(fd, b, 0, b.length, pos); fs.closeSync(fd); pos = size; process.stdout.write(b.toString('utf8')); }
          } catch {}
        }, 1000);
        return null; // keep running until Ctrl+C
      }
      return 0;
    }
    case 'report': {
      const i = argv.indexOf('--hours');
      const hours = i >= 0 ? Math.max(1, Number(argv[i + 1]) || 24) : 24;
      for (const l of require('./log').report(p.logs, { hours, now })) out(l);
      return 0;
    }
    case 'wait': {
      const ci = argv.indexOf('--command');
      const ti = argv.indexOf('--timeout');
      const timeoutMs = ti >= 0 ? parseDuration(argv[ti + 1]) : 15 * 60000;
      if (!(timeoutMs > 0)) { out('usage: wait <queue-id> | wait --command "<cmd>" [--timeout 15m]'); return 1; }
      const command = ci >= 0 ? argv[ci + 1] : null;
      const id = ci >= 0 ? null : (arg && !arg.startsWith('--') ? arg : null);
      return waitFor({ p, cfg: loadConfig(p), id, command, timeoutMs, out });
    }
    case 'queue': {
      const list = Q.list(p.queue);
      if (!list.length) out('queue empty');
      for (const e of list) out(`${e.id}  ${e.status}  ${new Date(e.created_at).toISOString()}  ${e.cwd}  ${e.command}`);
      return 0;
    }
    case 'stop': {
      S.writeJson(p.control, { ...S.readJson(p.control, {}), stopAt: now });
      const st = S.readState(p);
      const running = st && S.isAlive(st.pid) && now - (st.heartbeat || 0) < loadConfig(p).admission.staleMs;
      if (!running && st && (st.throttles || []).length) {
        // No watcher to drain them: a revert-only watcher takes the lock, reverses the records and exits.
        const { spawnSync } = require('child_process');
        spawnSync(process.execPath, [require('path').join(__dirname, 'watcher.js'), '--revert-only'], { stdio: 'ignore', windowsHide: true, timeout: 120000 });
        out('stop: reverted recorded throttles');
      } else out('stop requested');
      return 0;
    }
    case 'status':
    case undefined: {
      const cfg = loadConfig(p);
      const st = S.readState(p);
      const alive = st && now - (st.heartbeat || 0) < cfg.admission.staleMs;
      out(JSON.stringify({
        enabled: cfg.enabled, watcher: alive ? `running (pid ${st.pid}, v${st.version})` : 'not running',
        manual: Boolean(S.readJson(p.control, {}).manual), pressure: st && st.pressure, priorityBy: st && st.priorityBy,
        throttles: ((st && st.throttles) || []).map((t) => ({ job: t.jobId, name: t.name, level: t.level === 2 ? 'paused' : 'capped', resources: t.resources, requeue: t.requeue || undefined })),
        queue: Q.list(p.queue).length, sys: st && st.sys,
      }, null, 2));
      return 0;
    }
    default:
      out('usage: governor status | priority on|off | not-priority <app> | always-priority <app> | queue | log [--runs N] [--tail] | report [--hours N] | wait <queue-id> | wait --command "<cmd>" [--timeout 15m] | stop');
      return 2;
  }
}

if (require.main === module) {
  Promise.resolve(run(process.argv.slice(2))).then((code) => { if (code !== null) process.exitCode = code; }, () => { process.exitCode = 1; });
}

module.exports = { run, waitFor, parseDuration };
