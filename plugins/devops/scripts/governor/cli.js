#!/usr/bin/env node
/**
 * @module governor/cli
 * @description `node cli.js status | priority on|off | not-priority <app> |
 *   always-priority <app> | queue | stop`. Writes only CLI-owned files
 *   (control.json, config.json); the watcher picks them up on its next tick.
 */
'use strict';

const { paths, loadConfig } = require('./config');
const S = require('./state');
const Q = require('./queue');

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
      S.writeJson(p.control, { ...S.readJson(p.control, {}), manual: arg === 'on', at: now });
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
    case 'queue': {
      const list = Q.list(p.queue);
      if (!list.length) out('queue empty');
      for (const e of list) out(`${e.id}  ${e.status}  ${new Date(e.created_at).toISOString()}  ${e.cwd}  ${e.command}`);
      return 0;
    }
    case 'stop': {
      S.writeJson(p.control, { ...S.readJson(p.control, {}), stop: true, at: now });
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
      out('usage: governor status | priority on|off | not-priority <app> | always-priority <app> | queue | stop');
      return 2;
  }
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));

module.exports = { run };
