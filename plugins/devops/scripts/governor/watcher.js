#!/usr/bin/env node
/**
 * @module governor/watcher
 * @description The one governor process for all sessions. Started detached by
 *   ss.governor.attach / the gate hook (a second start exits at once:
 *   singleton lock). Each tick: sample → attribute (claude ancestry) →
 *   priority/budget → plan → apply. Every throttle is recorded in state.json
 *   BEFORE the OS call and removed ONLY after a successful release — a crash,
 *   a failed orphan revert or a failed release keeps it for the next attempt.
 *   Exits when no session, no Claude job, no throttle and no pressure remain,
 *   after marking deferred commands ready and releasing everything.
 *
 *   `--revert-only`: take the lock, reverse recorded throttles, exit (used by
 *   the disabled path and `governor stop` when no watcher is running).
 *
 *   createWatcher() holds all tick logic with an injected adapter (unit-tested
 *   with a fake adapter, watcher.test.js); main() wires the real adapter.
 */
'use strict';

const path = require('path');
const http = require('http');
const S = require('./state');
const P = require('./policy');
const Q = require('./queue');
const { derive } = require('./sample');
const libraries = require('./libraries');

const sanitize = (jobId) => String(jobId).replace(/[^A-Za-z0-9_@-]/g, '-');

function pluginVersion() {
  try { return require('../../.claude-plugin/plugin.json').version; } catch { return '0.0.0'; }
}

/** Best effort: unload the models listed in the local-llm markers (loaded by Claude requests). */
function unloadOllama(baseUrl, models) {
  const req = (body) => new Promise((resolve) => {
    try {
      const r = http.request(new URL('/api/generate', baseUrl), { method: 'POST', timeout: 3000, headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); });
      r.on('error', resolve); r.on('timeout', () => { r.destroy(); resolve(); });
      r.end(JSON.stringify(body));
    } catch { resolve(); }
  });
  return Promise.all((models || []).map((m) => req({ model: m, keep_alive: 0 })));
}

/**
 * @param {object} o
 * @param {object} o.adapter OS adapter (real or fake): sample/apply/release/notify/selfPids
 * @param {object} o.p paths
 * @param {() => object} o.loadCfg
 * @param {() => number} o.now
 * @param {{version?:string, logger?:{event:function, flush:function, name?:string}, libraries?:object, unload?:function}} [o.deps]
 */
function createWatcher({ adapter, p, loadCfg, now, deps = {} }) {
  const version = deps.version || pluginVersion();
  const logger = deps.logger || { event() {}, flush() {} };
  const ev = (name, fields, level) => logger.event(name, fields, level);
  const libs = deps.libraries || { discover: libraries.discover };
  const unload = deps.unload || unloadOllama;

  const st = {
    pid: process.pid, throttles: {}, tracked: {}, prio: {}, budget: { baseline: {} }, last: {}, kinds: {}, notified: {},
    prevSample: null, lib: { roots: [], dirs: [], exes: [] }, libAt: 0, startedAt: now(), summaryAt: now(),
    pressure: { priority: [], over: [] }, priorityBy: null, sys: {}, liveSessions: 0,
  };

  const save = () => S.writeState(p, {
    pid: st.pid, version, heartbeat: now(), helperPid: adapter.selfPids[1] || null, logFile: logger.name || null,
    throttles: Object.values(st.throttles), pressure: st.pressure, priorityBy: st.priorityBy, sys: st.sys, kinds: st.kinds,
    budget: { over: st.budget.over, baseline: st.budget.baseline },
    jobs: Object.values(st.tracked).map((j) => ({ id: j.id, name: j.name, kind: j.kind, heavy: j.heavy })),
  });

  // Release by key; the record goes ONLY on success.
  const release = async (id, reason) => {
    const t = st.throttles[id];
    if (!t) return true;
    try {
      await adapter.release(t.key, t.pids);
      delete st.throttles[id];
      save();
      ev('release', { key: t.key, name: t.name, reason });
      return true;
    } catch (e) { ev('release-failed', { key: t.key, reason, error: e.message }, 'error'); return false; }
  };

  // Orphan reversal: adopt every recorded throttle, then release it; failures stay recorded.
  const init = async (prevState) => {
    st.kinds = (prevState && prevState.kinds) || {};
    st.budget.baseline = (prevState && prevState.budget && prevState.budget.baseline) || {};
    for (const t of (prevState && prevState.throttles) || []) st.throttles[t.jobId] = t;
    save();
    for (const id of Object.keys(st.throttles)) await release(id, 'orphan');
  };

  // After a helper restart the new helper knows nothing: release every record again (idempotent).
  const reapply = async () => { for (const id of Object.keys(st.throttles)) await release(id, 'helper-restart'); };

  const notify = (cfg, title, text) => { ev('notify', { title, shown: Boolean(cfg.notify) }); return cfg.notify ? Promise.resolve(adapter.notify(title, text)).catch(() => null) : null; };

  async function tick() {
    const cfg = loadCfg();
    const control = S.readJson(p.control, {});
    const t = now();
    if (t - st.libAt > 30 * 60000) { st.lib = libs.discover(); st.libAt = t; }

    const busy = Object.keys(st.tracked).length > 0 || st.pressure.priority.length || st.pressure.over.length;
    const raw = await adapter.sample({ gpu: Boolean(busy) });
    const sm = derive(st.prevSample, raw);
    st.prevSample = sm;
    const procs = sm.procs;
    const byPid = new Map(procs.map((x) => [x.pid, x]));

    // Sessions: the hook records the session's claude pid; liveness = that pid alive with the same start.
    const sessions = S.readDir(p.sessions);
    const sessionPids = {};
    let liveSessions = 0;
    for (const { file, data } of sessions) {
      let c = byPid.get(data.claudePid);
      for (let i = 0; c && !P.isClaudeRoot(c) && i < 10; i++) c = byPid.get(c.ppid); // walk up to the Claude root
      const ok = c && P.isClaudeRoot(c) && (!Number.isFinite(data.claudeStartMs) || Math.abs(c.startMs - data.claudeStartMs) < 2000);
      if (!ok) { if (t - (data.startedAt || 0) > 30000) S.removeFile(file); continue; }
      if (!Number.isFinite(data.claudeStartMs)) S.writeJson(file, { ...data, claudePid: c.pid, claudeStartMs: c.startMs });
      liveSessions++;
      sessionPids[data.sessionId] = c.pid;
    }
    const sessionStarts = sessions.map((x) => x.data.startedAt).filter(Number.isFinite);

    const scopePid = Number(process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID) || 0; // smoke/test scope: only this tree is Claude's
    const attributed = scopePid ? P.attributedPids(procs, { extraRoots: [scopePid], claudeRoots: false }) : P.attributedPids(procs);
    const sessionOf = scopePid ? new Map() : P.sessionMap(procs, sessionPids);

    const markers = {};
    for (const { file, data } of S.readDir(path.join(p.inflight, 'local-llm'))) {
      const pid = Number(path.basename(file, '.json'));
      // Clean up markers of gone client processes once their self-loop window passed.
      if (!S.isAlive(pid) && t - (data.endedAt || data.updatedAt || 0) > cfg.selfLoopMs) { S.removeFile(file); continue; }
      (markers['local-llm'] = markers['local-llm'] || []).push(data);
    }
    const activeServices = P.activeServiceNames(cfg.claudeServices, markers, t, cfg.selfLoopMs);

    const env = { platform: process.platform, systemRoot: process.env.SystemRoot };
    const selfPids = new Set(adapter.selfPids);
    const keyOf = (x) => P.appKey(x.path, st.lib.roots, st.lib.dirs);
    const hosts = P.hostKeys(procs, keyOf);
    const classes = new Map();
    for (const x of procs) {
      let c = P.classify({ ...x, os: P.isOsProcess(x, env) }, { selfPids, attributed, sessionStarts, graceMs: cfg.infraGraceMs, activeServices });
      if (c === 'foreign' && x.path && hosts.has(keyOf(x))) c = 'host'; // the app hosting Claude: never priority, never learned
      classes.set(x.pid, c);
    }

    const fgRecs = [];
    for (const { file, data } of S.readDir(p.foreground)) {
      if (t - (data.startedAt || 0) > cfg.foregroundTtlMs) S.removeFile(file); else fgRecs.push(data);
    }

    const jobs = P.groupJobs(procs, classes, sm.listening, sessionOf);
    const prevTracked = st.tracked;
    const userPids = new Set(procs.filter((x) => attributed.has(x.pid) && P.isUserAppProc(x)).map((x) => x.pid));
    if (sm.fg && attributed.has(sm.fg.pid)) userPids.add(sm.fg.pid);
    st.tracked = P.trackJobs(prevTracked, jobs, t, cfg, { diskBusy: Boolean(st.budget.over && st.budget.over.disk), foreground: fgRecs, userPids });
    for (const [id, j] of Object.entries(st.tracked)) {
      const was = prevTracked[id];
      if (j.heavy && !(was && was.heavy)) ev('job-heavy', { job: id, name: j.name, kind: j.kind, res: j.res, session: j.session });
      else if (j.heavy && was && was.kind !== j.kind) ev('job-kind', { job: id, name: j.name, kind: j.kind });
    }
    for (const [id, j] of Object.entries(prevTracked)) {
      if (st.tracked[id]) continue;
      const kind = j.cmdKind || P.commandKind(j.cmd);
      if (kind && j.peakMB) st.kinds[kind] = { peakMB: Math.round(Math.max(j.peakMB, ((st.kinds[kind] && st.kinds[kind].peakMB) || 0) * 0.8)) };
    }

    st.budget = P.updateBudget(st.budget, sm.sys, t, cfg);
    const learned = S.readJson(p.learned, {});
    const foreign = procs.filter((x) => classes.get(x.pid) === 'foreign');
    const fg = sm.fg && classes.get(sm.fg.pid) === 'foreign' ? sm.fg : null;
    const beforePrio = new Set(st.pressure.priority);
    st.prio = P.updatePriority(st.prio, foreign, t, {
      cfg, libraryRoots: st.lib.roots, libraryDirs: st.lib.dirs, libraryExes: new Set(st.lib.exes.map((e) => e.toLowerCase())),
      learned, manual: Boolean(control.manual), foreground: fg, diskPressed: Boolean(st.budget.over.disk),
      noLearn: new Set([...(cfg.noLearn || []).map((x) => x.toLowerCase()), ...P.serviceNames(cfg.claudeServices)]),
    });
    for (const a of st.prio.newlyLearned) {
      learned[a.key] = { name: a.name, resources: a.resources, learnedAt: a.learnedAt };
      ev('learned', { app: a.key, resources: a.resources });
      S.writeJson(p.learned, learned);
      await notify(cfg, `Claude yields to ${a.name}`, `Claude's heavy jobs now give way to ${a.name}. Wrong? Run: governor not-priority "${a.key}"`);
    }
    const before = st.pressure;
    st.pressure = P.pressureOf(st.prio, st.budget);
    st.priorityBy = st.prio.allBy || Object.values(st.prio.active)[0] || null;
    for (const r of st.pressure.priority) if (!before.priority.includes(r)) ev('priority-gained', { resource: r, app: st.prio.active[r], all: st.prio.all || undefined });
    for (const r of before.priority) if (!st.pressure.priority.includes(r)) ev('priority-lost', { resource: r });
    for (const r of st.pressure.over) if (!before.over.includes(r)) ev('budget-over', { resource: r });
    for (const r of before.over) if (!st.pressure.over.includes(r)) ev('budget-ok', { resource: r });
    st.sys = { freeMB: sm.sys.freeMB, totalMB: sm.sys.totalMB, cpuPct: sm.sys.cpuPct, gpuPct: sm.sys.gpuPct };

    // GPU/RAM priority just started: unload the models Claude's local requests loaded.
    if (['gpu', 'ram'].some((r) => st.pressure.priority.includes(r) && !beforePrio.has(r))) {
      const models = [...new Set((markers['local-llm'] || []).flatMap((m) => m.models || []))];
      if (models.length) unload(cfg.ollamaUrl, models).catch(() => {});
    }

    // Prune recorded pids to live (pid, start) pairs: a reused pid is never acted on again.
    for (const tr of Object.values(st.throttles)) {
      tr.pids = tr.pids.filter((x) => { const cur = byPid.get(x.pid); return cur && Math.abs((cur.startMs || 0) - (x.startMs || 0)) < 2000; });
    }

    const current = {};
    for (const [id, tr] of Object.entries(st.throttles)) current[id] = { level: tr.level, resources: tr.resources };
    const { desired, last } = P.plan(st.tracked, current, st.pressure, t, cfg, st.last);
    st.last = last;
    for (const id of Object.keys(st.throttles)) if (!desired[id]) await release(id, st.tracked[id] ? 'relaxed' : 'job-gone');
    for (const [id, d] of Object.entries(desired)) {
      const j = st.tracked[id];
      if (!j) continue;
      const old = st.throttles[id];
      const pids = old ? [...old.pids] : [];
      for (const x of j.pids) if (!pids.some((o) => o.pid === x.pid)) pids.push(x);
      if (old && old.level === d.level && pids.length === old.pids.length) continue;
      st.throttles[id] = {
        jobId: id, key: sanitize(id), level: d.level, resources: d.resources, kind: j.kind, name: j.name, pids,
        requeue: j.gpu && j.kind === 'generator', by: st.priorityBy, appliedAt: (old && old.appliedAt) || t,
      };
      save(); // BEFORE the OS call
      try { await adapter.apply(st.throttles[id].key, d.level, pids); ev('throttle', { key: st.throttles[id].key, kind: j.kind, name: j.name, resources: d.resources, level: d.level, by: st.priorityBy }); } catch (e) { ev('apply-failed', { key: st.throttles[id].key, error: e.message }, 'error'); }
      if (d.level >= 2 && !st.notified[id]) st.notified[id] = { pausedAt: t };
    }
    for (const [id, n] of Object.entries(st.notified)) {
      if (!st.throttles[id] || st.throttles[id].level < 2) { delete st.notified[id]; continue; }
      if (!n.sent && t - n.pausedAt >= cfg.starvationMs) { n.sent = true; await notify(cfg, 'Claude job waiting', `${st.throttles[id].name} has been paused for 30 min because of ${P.appLabel(st.priorityBy || 'budget')}.`); }
    }

    // Queue: expire, starvation notice, mark ready only while nothing presses.
    const noPressure = !st.pressure.priority.length && !st.pressure.over.length;
    for (const e of Q.list(p.queue)) {
      if (Q.isExpired(e, t, cfg)) { Q.remove(p.queue, e.id); ev('queue-expired', { id: e.id, kind: e.kind }); continue; }
      if (Q.starving(e, t, cfg)) { await notify(cfg, 'Claude command waiting', `"${e.command.slice(0, 60)}" has waited 30 min.`); Q.save(p.queue, { ...e, starvationNotified: true }); }
      else if (noPressure && e.status === 'queued') { Q.save(p.queue, Q.markReady(e, t)); ev('queue-ready', { id: e.id, kind: e.kind }); }
    }

    st.liveSessions = liveSessions;
    const active = Object.keys(st.tracked).length || st.pressure.priority.length || st.pressure.over.length || Object.keys(st.throttles).length;
    if (active && t - st.summaryAt >= ((cfg.log && cfg.log.summaryMs) || 60000)) {
      st.summaryAt = t;
      const m = st.budget.mean || {};
      const r1 = (x) => (Number.isFinite(x) ? Math.round(x) : null);
      ev('summary', {
        cpu: r1(m.cpu), gpu: r1(m.gpu), diskMs: Number.isFinite(m.diskMs) ? Math.round(m.diskMs * 10) / 10 : null, freeMB: r1(m.freeMB),
        priority: [...new Set(Object.values(st.prio.active || {}))], over: st.pressure.over,
        jobs: Object.keys(st.tracked).length, heavy: Object.values(st.tracked).filter((j) => j.heavy).length, throttled: Object.keys(st.throttles).length,
      });
      logger.flush();
    } else if (!active) st.summaryAt = t;
    save();
    return { liveSessions, jobs: Object.keys(st.tracked).length, throttles: Object.keys(st.throttles).length, pressure: st.pressure };
  }

  // Shutdown: mark pending commands ready only if nothing presses; release all throttles.
  const drain = async () => {
    const t = now();
    const cfg = loadCfg();
    if (!st.pressure.priority.length && !st.pressure.over.length) {
      for (const e of Q.list(p.queue)) if (e.status === 'queued' && !Q.isExpired(e, t, cfg)) Q.save(p.queue, Q.markReady(e, t));
    }
    for (const id of Object.keys(st.throttles)) await release(id, 'shutdown');
  };

  // Stay alive while anything could still need us: a session, a job, a throttle, or active pressure.
  const canExit = () => st.liveSessions === 0 && !Object.keys(st.tracked).length && !Object.keys(st.throttles).length
    && !st.pressure.priority.length && !st.pressure.over.length && now() - st.startedAt > 60000;

  return { st, init, reapply, tick, drain, save, release, canExit };
}

async function main(argv = process.argv.slice(2)) {
  const { paths: govPaths, loadConfig } = require('./config');
  const { createAdapter } = require('./adapters');
  const p = govPaths();
  const cfg = loadConfig(p);
  const revertOnly = argv.includes('--revert-only') || !cfg.enabled;
  const prevState = S.readState(p);
  if (revertOnly && !(prevState && (prevState.throttles || []).length)) return; // nothing to undo
  let logger = null;
  const ev = (name, fields, level) => logger && logger.event(name, fields, level);
  const adapter = createAdapter(process.platform, cfg, { onEvent: (n, f) => ev(n, f, 'error') });
  if (!adapter) return;
  const version = pluginVersion();
  const pid = process.pid;
  const L = require('./log');

  let got = S.acquireLock(p, { pid, version, now: Date.now(), startOf: S.processStart });
  for (let i = 0; i < 40 && !got.ok && got.handover; i++) { await new Promise((r) => setTimeout(r, 500)); got = S.acquireLock(p, { pid, version, now: Date.now(), startOf: S.processStart }); }
  if (!got.ok) return;
  if (prevState && prevState.newer) { S.releaseLock(p, pid); return; }
  logger = L.openRun(p.logs, cfg, { pid });
  ev('start', { version, revertOnly: revertOnly || undefined, platform: process.platform });
  try { await adapter.start(); } catch (e) { ev('helper-failed', { error: e.message }, 'error'); ev('stop', { why: 'helper failed' }); S.releaseLock(p, pid); return; }

  const w = createWatcher({ adapter, p, loadCfg: () => loadConfig(p), now: Date.now, deps: { version, logger } });
  await w.init(prevState);

  let stopping = false;
  const shutdown = async (why) => {
    if (stopping) return; stopping = true;
    await w.drain();
    logger.flush();
    ev('stop', { why });
    await adapter.stop();
    S.releaseLock(p, pid);
    process.exit(0);
  };
  if (revertOnly) return shutdown(cfg.enabled ? 'revert only' : 'disabled');
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const beat = setInterval(() => {
    if (!S.heartbeat(p, pid, version, Date.now())) { ev('stop', { why: 'lock lost' }); adapter.stop().finally(() => process.exit(0)); }
  }, cfg.heartbeatMs);
  beat.unref();

  for (;;) {
    const tickStart = Date.now();
    const c = loadConfig(p);
    if (!c.enabled) return shutdown('disabled');
    if (S.handoverRequested(p, version, tickStart)) return shutdown('handover to newer version');
    const control = S.readJson(p.control, {});
    if (control.stopAt > w.st.startedAt) return shutdown('stop requested');
    if (!adapter.alive) {
      ev('helper-restart', {});
      try { await adapter.start(); await w.reapply(); } catch (e) { ev('helper-restart-failed', { error: e.message }, 'error'); }
    }
    try { await w.tick(); } catch (e) { ev('tick-error', { error: e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e) }, 'error'); }
    if (w.canExit()) return shutdown('no session and no Claude job left');
    const idle = !Object.keys(w.st.tracked).length && !w.st.pressure.priority.length && !w.st.pressure.over.length;
    await new Promise((r) => setTimeout(r, Math.max(250, (idle ? c.idleTickMs : c.tickMs) - (Date.now() - tickStart))));
  }
}

if (require.main === module) {
  main().catch((e) => { try { const { paths } = require('./config'); require('./log').hookLogger(paths(), null, 'watcher').event('fatal', { error: e.message }, 'error'); } catch {} process.exit(1); });
}

module.exports = { createWatcher, main, sanitize };
