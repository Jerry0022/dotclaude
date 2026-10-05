#!/usr/bin/env node
/**
 * @module governor/watcher
 * @description The one governor process for all sessions. Started detached by
 *   ss.governor.attach / the gate hook (a second start exits at once:
 *   singleton lock). Each tick: sample → attribute → priority/budget → plan →
 *   apply. Every throttle is recorded in state.json BEFORE the OS call; a
 *   recorded throttle is removed ONLY after a successful release, so a crash
 *   or a failed release leaves it for the next start to reverse (key-based,
 *   via the adapter — no dead reversal code). Exits when no session and no
 *   Claude job remain, after marking deferred commands ready and releasing
 *   everything.
 *
 *   createWatcher() holds all tick logic with an injected adapter, so the
 *   whole loop is unit-tested with a fake adapter (watcher.test.js); main()
 *   only wires the real adapter, the clock and the lock.
 */
'use strict';

const fs = require('fs');
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

/** Best effort: unload the models a Claude request loaded (Ollama keep_alive 0). */
function unloadOllama(baseUrl) {
  const req = (method, p, body) => new Promise((resolve) => {
    try {
      const u = new URL(p, baseUrl);
      const r = http.request(u, { method, timeout: 3000, headers: { 'content-type': 'application/json' } }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      r.on('error', () => resolve(null)); r.on('timeout', () => { r.destroy(); resolve(null); });
      if (body) r.write(JSON.stringify(body));
      r.end();
    } catch { resolve(null); }
  });
  return req('GET', '/api/ps').then(async (ps) => {
    for (const m of (ps && ps.models) || []) await req('POST', '/api/generate', { model: m.name, keep_alive: 0 });
  });
}

/**
 * @param {object} o
 * @param {object} o.adapter OS adapter (real or fake)
 * @param {object} o.p paths
 * @param {() => object} o.loadCfg config loader
 * @param {() => number} o.now clock
 * @param {{libraries?:object, gitInfo?:function, log?:function, unload?:function}} [o.deps]
 */
function createWatcher({ adapter, p, loadCfg, now, deps = {} }) {
  const version = deps.version || pluginVersion();
  const log = deps.log || ((msg) => { try { fs.mkdirSync(p.logs, { recursive: true }); fs.appendFileSync(p.log, `${new Date().toISOString()} [${process.pid}] ${msg}\n`); } catch {} });
  const libs = deps.libraries || { discover: libraries.discover };
  const unload = deps.unload || unloadOllama;

  const st = {
    pid: process.pid, version, throttles: {}, tracked: {}, prio: {}, budget: { baseline: {} },
    last: {}, kinds: {}, notified: {}, attached: new Set(), prevSample: null,
    lib: { roots: [], dirs: [], exes: [] }, libAt: 0, startedAt: now(),
    pressure: { priority: [], over: [] }, priorityBy: null, sys: {},
  };

  const save = () => S.writeState(p, {
    pid: st.pid, version, heartbeat: now(), helperPid: adapter.selfPids[1] || null,
    throttles: Object.values(st.throttles),
    pressure: st.pressure, priorityBy: st.priorityBy, sys: st.sys, kinds: st.kinds,
    budget: { over: st.budget.over, baseline: st.budget.baseline },
    jobs: Object.values(st.tracked).map((j) => ({ id: j.id, name: j.name, kind: j.kind, heavy: j.heavy })),
  });

  // Release a throttle by key; drop the record ONLY on success (failed release stays for next start).
  const release = async (id, reason) => {
    const t = st.throttles[id];
    if (!t) return;
    try {
      await adapter.release(t.key, t.pids);
      delete st.throttles[id];
      save();
      log(`released ${id} (${reason})`);
    } catch (e) { log(`release failed ${id}: ${e.message} — kept for retry`); }
  };

  // init(): orphan reversal of whatever a previous watcher recorded.
  const init = async (prevState) => {
    st.kinds = (prevState && prevState.kinds) || {};
    st.budget.baseline = (prevState && prevState.budget && prevState.budget.baseline) || {};
    for (const t of (prevState && prevState.throttles) || []) {
      try { await adapter.release(t.key, t.pids); log(`orphan reverted ${t.jobId}`); } catch (e) { log(`orphan revert failed ${t.jobId}: ${e.message}`); }
    }
    save();
  };

  async function tick() {
    const cfg = loadCfg();
    const control = S.readJson(p.control, {});
    const t = now();
    if (t - st.libAt > 30 * 60000) { st.lib = libs.discover(); st.libAt = t; }

    const haveJobs = Object.keys(st.tracked).length > 0 || st.pressure.priority.length || st.pressure.over.length;
    const raw = await adapter.sample({ gpu: Boolean(haveJobs) });
    const sm = derive(st.prevSample, raw);
    st.prevSample = sm;
    const procs = sm.procs;
    const byPid = new Map(procs.map((x) => [x.pid, x]));

    // Sessions: resolve each to its claude pid via the recorded hookPpid chain; attach once; expire by liveness.
    const sessions = S.readDir(p.sessions);
    const sessionPids = {};
    let liveSessions = 0;
    for (const { file, data } of sessions) {
      let claude = null;
      for (let cur = byPid.get(data.hookPpid), i = 0; cur && i < 30; cur = byPid.get(cur.ppid), i++) if (P.isClaudeRoot(cur)) { claude = cur; break; }
      if (!claude) {
        if (!S.isAlive(data.hookPid) && t - (data.startedAt || 0) > 30000) S.removeFile(file);
        continue;
      }
      liveSessions++;
      sessionPids[data.sessionId] = claude.pid;
      if (!st.attached.has(data.sessionId)) {
        try { await adapter.attach(data.sessionId, [{ pid: claude.pid, startMs: claude.startMs }]); st.attached.add(data.sessionId); } catch (e) { log(`attach failed: ${e.message}`); }
      }
    }
    const sessionStarts = sessions.map((x) => x.data.startedAt).filter(Number.isFinite);

    const jobPids = Object.values(sm.jobPids || {}).flat();
    const scopePid = Number(process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID) || 0;
    const attributed = scopePid
      ? P.attributedPids(procs, { extraRoots: [scopePid], claudeRoots: false })
      : P.attributedPids(procs, { jobPids });
    const sessionOf = scopePid ? new Map() : P.sessionMap(procs, sessionPids);

    const markers = {};
    for (const { file, data } of S.readDir(p.inflight)) {
      const name = path.basename(path.dirname(file));
      (markers[name] = markers[name] || []).push(data);
    }
    const activeServices = P.activeServiceNames(cfg.claudeServices, markers, t, cfg.selfLoopMs);

    const env = { platform: process.platform, systemRoot: process.env.SystemRoot };
    const selfPids = new Set(adapter.selfPids);
    const classes = new Map();
    for (const x of procs) classes.set(x.pid, P.classify({ ...x, os: P.isOsProcess(x, env) }, { selfPids, attributed, sessionStarts, graceMs: cfg.infraGraceMs, activeServices }));

    // Foreground tool-call records (per session, short TTL).
    const fgRecs = [];
    for (const { file, data } of S.readDir(p.foreground)) {
      if (t - (data.startedAt || 0) > cfg.foregroundTtlMs) S.removeFile(file); else fgRecs.push(data);
    }

    const jobs = P.groupJobs(procs, classes, sm.listening, sessionOf);
    const prevTracked = st.tracked;
    st.tracked = P.trackJobs(prevTracked, jobs, t, cfg, { diskBusy: Boolean(st.budget.over && st.budget.over.disk), foreground: fgRecs });
    for (const [id, j] of Object.entries(prevTracked)) {
      if (st.tracked[id]) continue;
      const kind = j.cmdKind || P.commandKind(j.cmd);
      if (kind && j.peakMB) st.kinds[kind] = { peakMB: Math.round(Math.max(j.peakMB, ((st.kinds[kind] && st.kinds[kind].peakMB) || 0) * 0.8)) };
    }

    const learned = S.readJson(p.learned, {});
    const foreign = procs.filter((x) => classes.get(x.pid) === 'foreign');
    const fg = sm.fg && classes.get(sm.fg.pid) === 'foreign' ? sm.fg : null;
    const beforePrio = new Set(P.pressureOf(st.prio, st.budget).priority);
    st.prio = P.updatePriority(st.prio, foreign, t, {
      cfg, libraryRoots: st.lib.roots, libraryDirs: st.lib.dirs, libraryExes: new Set(st.lib.exes.map((e) => e.toLowerCase())),
      learned, manual: Boolean(control.manual), foreground: fg, noLearn: new Set([...(cfg.noLearn || []).map((x) => x.toLowerCase()), ...P.serviceNames(cfg.claudeServices)]),
    });
    for (const a of st.prio.newlyLearned) {
      learned[a.key] = { name: a.name, resources: a.resources, learnedAt: a.learnedAt };
      S.writeJson(p.learned, learned);
      await notify(cfg, `Claude yields to ${a.name}`, `Claude's heavy jobs now give way to ${a.name}. Wrong? Run: governor not-priority "${a.key}"`);
    }
    st.budget = P.updateBudget(st.budget, sm.sys, t, cfg);
    st.pressure = P.pressureOf(st.prio, st.budget);
    st.priorityBy = st.prio.allBy || Object.values(st.prio.active)[0] || null;
    st.sys = { freeMB: sm.sys.freeMB, totalMB: sm.sys.totalMB, cpuPct: sm.sys.cpuPct, gpuPct: sm.sys.gpuPct };

    const nowPrio = new Set(st.pressure.priority);
    if (['gpu', 'ram'].some((r) => nowPrio.has(r) && !beforePrio.has(r))) {
      if ((markers['local-llm'] || []).some((m) => m.count > 0 || t - (m.endedAt || 0) < 30 * 60000)) unload(cfg.ollamaUrl).catch(() => {});
    }

    // Plan and apply — record first, then act; release by key on removal.
    const current = {};
    for (const [id, tr] of Object.entries(st.throttles)) current[id] = { level: tr.level, resources: tr.resources };
    const { desired, last } = P.plan(st.tracked, current, st.pressure, t, cfg, st.last);
    st.last = last;
    for (const id of Object.keys(st.throttles)) if (!desired[id]) await release(id, st.tracked[id] ? 'relaxed' : 'job-gone');
    for (const [id, d] of Object.entries(desired)) {
      const j = st.tracked[id];
      if (!j) continue;
      const old = st.throttles[id];
      const mergedPids = old ? [...old.pids] : [];
      for (const pid of j.pids) if (!mergedPids.some((o) => o.pid === pid.pid)) mergedPids.push(pid);
      if (old && old.level === d.level && mergedPids.length === old.pids.length) continue;
      const entry = {
        jobId: id, key: sanitize(id), level: d.level, resources: d.resources, kind: j.kind, name: j.name,
        pids: mergedPids, memMB: Math.round(j.memMB * cfg.cap.memFactor), everPaused: Boolean((old && old.everPaused) || d.level >= 2),
        requeue: j.gpu && j.kind === 'generator', by: st.priorityBy, appliedAt: (old && old.appliedAt) || t,
      };
      st.throttles[id] = entry;
      save(); // BEFORE the OS call
      try { await adapter.apply(entry.key, d.level, entry.pids, { memMB: entry.memMB }); log(`level ${d.level} ${id} (${j.kind}, ${j.name}) for ${d.resources.join(',')}`); } catch (e) { log(`apply failed ${id}: ${e.message}`); }
      if (d.level >= 2 && !st.notified[id]) st.notified[id] = { pausedAt: t };
    }
    for (const [id, n] of Object.entries(st.notified)) {
      if (!st.throttles[id]) { delete st.notified[id]; continue; }
      if (!n.sent && t - n.pausedAt >= cfg.starvationMs) { n.sent = true; await notify(cfg, 'Claude job waiting', `${st.throttles[id].name} has been paused for 30 min because of ${P.appLabel(st.priorityBy || 'budget')}.`); }
    }

    // Queue: expire, starvation notice, mark ready when nothing presses.
    const noPressure = !st.pressure.priority.length && !st.pressure.over.length;
    for (const e of Q.list(p.queue)) {
      if (Q.isExpired(e, t, cfg)) { Q.remove(p.queue, e.id); log(`queue expired ${e.id}`); continue; }
      if (Q.starving(e, t, cfg)) { await notify(cfg, 'Claude command waiting', `"${e.command.slice(0, 60)}" has waited 30 min.`); Q.save(p.queue, { ...e, starvationNotified: true }); }
      if (noPressure && e.status === 'queued') { Q.save(p.queue, Q.markReady(e, t)); log(`queue ready ${e.id}`); }
    }

    st.liveSessions = liveSessions;
    save();
    return { liveSessions, jobs: Object.keys(st.tracked).length, throttles: Object.keys(st.throttles).length, pressure: st.pressure };
  }

  const notify = (cfg, title, text) => { log(`notify: ${title} - ${text}`); return cfg.notify ? adapter.notify(title, text).catch(() => null) : null; };

  // Mark every pending command ready (so a session can re-run them) and release all throttles.
  const drain = async () => {
    const t = now();
    for (const e of Q.list(p.queue)) if (e.status === 'queued' && !Q.isExpired(e, t, loadCfg())) Q.save(p.queue, Q.markReady(e, t));
    for (const id of Object.keys(st.throttles)) await release(id, 'shutdown');
  };

  const canExit = () => st.liveSessions === 0 && Object.keys(st.tracked).length === 0 && Object.keys(st.throttles).length === 0 && now() - st.startedAt > 60000;

  return { st, init, tick, drain, save, release, canExit };
}

async function main() {
  const { paths: govPaths, loadConfig } = require('./config');
  const { createAdapter } = require('./adapters');
  const p = govPaths();
  const cfg = loadConfig(p);
  if (!cfg.enabled) return;
  const adapter = createAdapter(process.platform, cfg);
  if (!adapter) return;
  const version = pluginVersion();
  const pid = process.pid;
  const log = (msg) => { try { fs.mkdirSync(p.logs, { recursive: true }); fs.appendFileSync(p.log, `${new Date().toISOString()} [${pid}] ${msg}\n`); } catch {} };

  let got = S.acquireLock(p, { pid, version, now: Date.now(), startOf: S.processStart });
  for (let i = 0; i < 40 && !got.ok && got.handover; i++) { await new Promise((r) => setTimeout(r, 500)); got = S.acquireLock(p, { pid, version, now: Date.now(), startOf: S.processStart }); }
  if (!got.ok) return;
  const prevState = S.readState(p);
  if (prevState && prevState.newer) { S.releaseLock(p, pid); return; }
  log(`start v${version}`);
  try { await adapter.start(); } catch (e) { log(`helper failed: ${e.message}`); S.releaseLock(p, pid); return; }

  const w = createWatcher({ adapter, p, loadCfg: () => loadConfig(p), now: Date.now, deps: { version, log } });
  await w.init(prevState);

  let stopping = false;
  const shutdown = async (why) => {
    if (stopping) return; stopping = true;
    log(`stop: ${why}`);
    await w.drain();
    await adapter.stop();
    S.releaseLock(p, pid);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  let lastBeat = 0;
  for (;;) {
    const tickStart = Date.now();
    const c = loadConfig(p);
    if (!c.enabled) return shutdown('disabled');
    if (tickStart - lastBeat >= c.heartbeatMs) {
      if (!S.heartbeat(p, pid, version, tickStart)) { log('lock lost'); await adapter.stop(); process.exit(0); }
      lastBeat = tickStart;
    }
    if (S.handoverRequested(p, version, tickStart)) return shutdown('handover to newer version');
    const control = S.readJson(p.control, {});
    if (control.stop && control.at > w.st.startedAt) return shutdown('stop requested');
    if (!adapter.alive) {
      try { await adapter.start(); } catch (e) { log(`helper restart failed: ${e.message}`); }
      for (const t of Object.values(w.st.throttles)) { try { await adapter.release(t.key, t.pids); } catch {} delete w.st.throttles[t.jobId]; }
      w.save();
    }
    try { await w.tick(); } catch (e) { log(`tick error: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
    if (w.canExit()) return shutdown('no session and no Claude job left');
    const idle = Object.keys(w.st.tracked).length === 0 && !w.st.pressure.priority.length && !w.st.pressure.over.length;
    const interval = idle ? c.idleTickMs : c.tickMs;
    await new Promise((r) => setTimeout(r, Math.max(250, interval - (Date.now() - tickStart))));
  }
}

if (require.main === module) {
  main().catch((e) => { try { const { paths } = require('./config'); fs.appendFileSync(paths().log, `fatal: ${e.message}\n`); } catch {} process.exit(1); });
}

module.exports = { createWatcher, main, sanitize };
