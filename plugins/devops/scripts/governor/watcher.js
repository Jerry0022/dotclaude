#!/usr/bin/env node
/**
 * @module governor/watcher
 * @description The one governor process for all sessions. Started detached
 *   by ss.governor.attach (a second start exits at once: singleton lock).
 *   Each tick: sample → attribute → priority/budget → plan → apply. Every
 *   throttle is written to state.json BEFORE the OS call; on start every
 *   recorded throttle is reversed (orphans of a crashed watcher). Exits when
 *   no session and no Claude job remain, after reversing everything.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { paths: govPaths, loadConfig } = require('./config');
const S = require('./state');
const P = require('./policy');
const Q = require('./queue');
const { derive } = require('./sample');
const libraries = require('./libraries');
const { createAdapter } = require('./adapters');

function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return '0.0.0'; }
}

function log(p, msg) {
  try { fs.mkdirSync(p.logs, { recursive: true }); fs.appendFileSync(p.log, `${new Date().toISOString()} [${process.pid}] ${msg}\n`); } catch {}
}

function gitInfo(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return { exists: false };
  const g = (args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  return { exists: true, branch: g(['rev-parse', '--abbrev-ref', 'HEAD']), head: g(['rev-parse', 'HEAD']) };
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

async function main() {
  const p = govPaths();
  const cfg = loadConfig(p);
  if (!cfg.enabled) return;
  const adapter = createAdapter(process.platform, cfg);
  if (!adapter) return;
  const version = pluginVersion();
  const pid = process.pid;

  let got = S.acquireLock(p, { pid, version, now: Date.now() });
  if (!got.ok && got.handover) {
    for (let i = 0; i < 40 && !got.ok; i++) {
      await new Promise((r) => setTimeout(r, 500));
      got = S.acquireLock(p, { pid, version, now: Date.now() });
    }
  }
  if (!got.ok) return;
  const prevState = S.readState(p);
  if (prevState && prevState.newer) { S.releaseLock(p, pid); return; }
  log(p, `start v${version}`);

  try { await adapter.start(); } catch (e) { log(p, `helper failed: ${e.message}`); S.releaseLock(p, pid); return; }

  // Orphan reversal: nothing in a fresh watcher is ours yet.
  let throttles = {};
  for (const t of (prevState && prevState.throttles) || []) {
    try { await adapter.revert(t); log(p, `orphan reverted ${t.jobId}`); } catch (e) { log(p, `orphan revert failed ${t.jobId}: ${e.message}`); }
  }
  const st = {
    pid, version, heartbeat: Date.now(), throttles: [], kinds: (prevState && prevState.kinds) || {},
    budget: { baseline: (prevState && prevState.budget && prevState.budget.baseline) || {} },
    prio: {}, tracked: {}, last: {}, queueRunning: {}, notified: {},
  };
  const save = () => {
    S.writeState(p, {
      pid, version, heartbeat: st.heartbeat, throttles: Object.values(throttles), pressure: st.pressure || { priority: [], over: [] },
      priorityBy: st.priorityBy || null, sys: st.sys || {}, kinds: st.kinds, budget: { over: st.budget.over, baseline: st.budget.baseline, mean: st.budget.mean },
      apps: Object.values(st.prio.apps || {}).map((a) => ({ key: a.key, res: a.res, running: a.running })), jobs: Object.values(st.tracked).map((j) => ({ id: j.id, name: j.name, kind: j.kind, heavy: j.heavy, cpuPct: j.cpuPct, memMB: j.memMB })),
      queueRunning: st.queueRunning,
    });
  };
  save();

  let libs = libraries.discover();
  let libsAt = Date.now();
  const signers = new Map();
  const attached = new Set();
  const startedAt = Date.now();
  let prevSample = null;
  let stopping = false;

  const revertAll = async () => {
    for (const t of Object.values(throttles)) { try { await adapter.revert(t); } catch {} }
    throttles = {};
    save();
  };
  const shutdown = async (why) => {
    if (stopping) return; stopping = true;
    log(p, `stop: ${why}`);
    await revertAll();
    await adapter.stop();
    S.releaseLock(p, pid);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const notify = (title, text) => { log(p, `notify: ${title} - ${text}`); return adapter.notify(title, text); };

  for (;;) {
    const tickStart = Date.now();
    try {
      const control = S.readJson(p.control, {});
      if (!S.heartbeat(p, pid, version, tickStart)) { log(p, 'lock lost'); await adapter.stop(); process.exit(0); }
      if (S.handoverRequested(p, version, tickStart)) return shutdown('handover to newer version');
      if (control.stop && control.at > startedAt) return shutdown('stop requested');
      if (!adapter.alive) {
        // Helper died: it reverted its own throttles. Restart, re-revert (idempotent), re-plan.
        await adapter.start();
        for (const t of Object.values(throttles)) { try { await adapter.revert({ ...t, everPaused: true }); } catch {} }
        throttles = {};
      }
      const c = loadConfig(p);
      if (!c.enabled) return shutdown('disabled');
      if (Date.now() - libsAt > 30 * 60000) { libs = libraries.discover(); libsAt = Date.now(); }

      const raw = await adapter.sample();
      const now = raw.ts || Date.now();
      const sm = derive(prevSample, raw);
      prevSample = sm;
      const procs = sm.procs;
      const byPid = new Map(procs.map((x) => [x.pid, x]));

      // Sessions: attach new ones, drop ended ones.
      const sessions = S.readDir(p.sessions);
      const claudeRoots = procs.filter((x) => P.isClaudeRoot(x));
      let liveSessions = 0;
      for (const { file, data } of sessions) {
        let claude = null;
        for (let cur = byPid.get(data.hookPpid), i = 0; cur && i < 20; cur = byPid.get(cur.ppid), i++) if (P.isClaudeRoot(cur)) { claude = cur; break; }
        const targets = claude ? [claude] : claudeRoots.filter((x) => x.startMs <= (data.startedAt || now) + 5000);
        if (!targets.length && now - (data.startedAt || 0) > 60000) { S.removeFile(file); continue; }
        liveSessions++;
        if (!attached.has(data.sessionId)) {
          try { await adapter.attach(data.sessionId, targets.map((x) => ({ pid: x.pid, startMs: x.startMs }))); attached.add(data.sessionId); } catch (e) { log(p, `attach failed: ${e.message}`); }
        }
      }
      const sessionStarts = sessions.map((x) => x.data.startedAt).filter(Number.isFinite);

      const jobPids = Object.values(sm.jobPids).flat();
      const queueRoots = Object.values(st.queueRunning).map((q) => q.pid);
      const attributed = P.attributedPids(procs, { jobPids, extraRoots: queueRoots });
      const markers = {};
      for (const { file, data } of S.readDir(p.inflight)) markers[path.basename(file, '.json')] = data;
      const activeServices = P.activeServiceNames(c.claudeServices, markers, now, c.selfLoopMs);

      // OS check: signer only for loaded candidates under %SystemRoot% / Defender.
      const sysRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
      const need = [];
      for (const x of procs) {
        if (!x.path || signers.has(x.path) || attributed.has(x.pid)) continue;
        const lp = x.path.toLowerCase();
        if ((lp.startsWith(sysRoot) || lp.includes('windows defender')) && P.loadedResources(x, c.foreign).length) need.push(x.path);
      }
      if (need.length) {
        try { const r = await adapter.signers([...new Set(need)].slice(0, 20)); for (const [k, v] of Object.entries(r || {})) signers.set(k, v); } catch {}
      }
      const env = { platform: process.platform, systemRoot: process.env.SystemRoot };
      const selfPids = new Set(adapter.selfPids);
      const classes = new Map();
      for (const x of procs) {
        const known = x.path ? signers.get(x.path) : undefined;
        const lp = String(x.path || '').toLowerCase();
        // Unverified exe under %SystemRoot%: treated as OS until its signer is known (never priority).
        const osFlag = x.path && known === undefined && lp.startsWith(sysRoot) ? true : P.isOsProcess({ ...x, signer: known }, env);
        classes.set(x.pid, P.classify({ ...x, os: osFlag }, { selfPids, attributed, sessionStarts, graceMs: c.infraGraceMs, activeServices }));
      }

      // Foreground tool calls (PreToolUse writes, PostToolUse clears; 6 h safety expiry).
      const fgRecs = [];
      for (const { file, data } of S.readDir(p.foreground)) {
        if (now - (data.startedAt || 0) > 6 * 3600000) S.removeFile(file); else fgRecs.push(data);
      }
      const jobs = P.groupJobs(procs, classes, sm.listening);
      const prevTracked = st.tracked;
      st.tracked = P.trackJobs(prevTracked, jobs, now, c, { diskBusy: Boolean(st.budget.over && st.budget.over.disk), foreground: fgRecs });
      // Learn expected peak MB per command kind from finished jobs.
      for (const [id, j] of Object.entries(prevTracked)) {
        if (st.tracked[id]) continue;
        const kind = P.commandKind(j.cmd);
        if (kind && j.peakMB) st.kinds[kind] = { peakMB: Math.round(Math.max(j.peakMB, ((st.kinds[kind] && st.kinds[kind].peakMB) || 0) * 0.8)) };
      }

      const learned = S.readJson(p.learned, {});
      const foreign = procs.filter((x) => classes.get(x.pid) === 'foreign');
      const fg = sm.fg && classes.get(sm.fg.pid) === 'foreign' ? sm.fg : null;
      const before = new Set(P.pressureOf(st.prio, st.budget).priority);
      st.prio = P.updatePriority(st.prio, foreign, now, {
        cfg: c, libraryRoots: libs.roots, libraryDirs: libs.dirs, libraryExes: new Set(libs.exes.map((e) => e.toLowerCase())),
        learned, manual: Boolean(control.manual), foreground: fg,
      });
      for (const a of st.prio.newlyLearned) {
        learned[a.key] = { name: a.name, resources: a.resources, learnedAt: a.learnedAt };
        S.writeJson(p.learned, learned);
        await notify('Claude yields to ' + a.name, `Claude's heavy jobs now give way to ${a.name}. Wrong? Run: node "${path.join(__dirname, 'cli.js')}" not-priority "${a.key}"`);
      }
      st.budget = P.updateBudget(st.budget, sm.sys, now, c);
      const pressure = P.pressureOf(st.prio, st.budget);
      st.pressure = pressure;
      st.priorityBy = st.prio.allBy || Object.values(st.prio.active)[0] || null;
      st.sys = { freeMB: sm.sys.freeMB, totalMB: sm.sys.totalMB, cpuPct: sm.sys.cpuPct, gpuPct: sm.sys.gpuPct, diskMs: sm.sys.diskMs };

      // Priority started on GPU/RAM: unload models a Claude request loaded.
      const nowPrio = new Set(pressure.priority);
      if (['gpu', 'ram'].some((r) => nowPrio.has(r) && !before.has(r))) {
        const m = markers['local-llm'];
        if (m && (m.active || now - (m.endedAt || 0) < 30 * 60000)) unloadOllama(c.ollamaUrl).catch(() => {});
      }

      // Plan and apply — record first, then act.
      const current = {};
      for (const [id, t] of Object.entries(throttles)) current[id] = { level: t.level, resources: t.resources };
      const { desired, last } = P.plan(st.tracked, current, pressure, now, c, st.last);
      st.last = last;
      for (const id of Object.keys(throttles)) {
        if (desired[id]) continue;
        const t = throttles[id];
        if (st.tracked[id]) { try { await adapter.revert(t); log(p, `released ${id}`); } catch (e) { log(p, `release failed ${id}: ${e.message}`); continue; } }
        delete throttles[id];
        save();
      }
      for (const [id, d] of Object.entries(desired)) {
        const j = st.tracked[id];
        const old = throttles[id];
        const newPids = old ? j.pids.filter((x) => !old.pids.some((o) => o.pid === x.pid)) : j.pids;
        if (old && old.level === d.level && !newPids.length) continue;
        const entry = {
          jobId: id, level: d.level, resources: d.resources, kind: j.kind, name: j.name, pids: j.pids,
          appliedAt: (old && old.appliedAt) || now, everPaused: Boolean((old && old.everPaused) || d.level >= 2),
          requeue: j.gpu && j.kind === 'generator', by: st.priorityBy,
        };
        throttles[id] = entry;
        save(); // BEFORE the OS call
        try { await adapter.apply(entry); log(p, `level ${d.level} ${id} (${j.kind}, ${j.name}) for ${d.resources.join(',')}`); } catch (e) { log(p, `apply failed ${id}: ${e.message}`); }
        if (d.level >= 2 && !st.notified[id]) st.notified[id] = { pausedAt: now };
      }
      for (const [id, n] of Object.entries(st.notified)) {
        if (!throttles[id]) { delete st.notified[id]; continue; }
        if (!n.sent && now - n.pausedAt >= c.starvationMs) { n.sent = true; await notify('Claude job waiting', `${throttles[id].name} has been paused for 30 min because of ${P.appLabel(st.priorityBy || 'budget')}.`); }
      }

      // Queue: expire, starvation notice, drift-checked run when nothing presses.
      const entries = Q.list(p.queue);
      for (const e of entries) {
        if (Q.isExpired(e, now, c)) { Q.remove(p.queue, e.id); log(p, `queue expired ${e.id}`); continue; }
        if (Q.starving(e, now, c)) { e.starvationNotified = true; Q.save(p.queue, e); await notify('Claude job waiting', `"${e.command.slice(0, 60)}" has waited 30 min for ${P.appLabel(st.priorityBy || 'free resources')}.`); }
      }
      for (const [id, q] of Object.entries(st.queueRunning)) {
        if (!byPid.has(q.pid)) { delete st.queueRunning[id]; Q.remove(p.queue, id); log(p, `queue done ${id}`); }
      }
      const noPressure = !pressure.priority.length && !pressure.over.length;
      if (noPressure && !Object.keys(st.queueRunning).length) {
        const e = Q.pickNext(Q.list(p.queue), now, c);
        if (e && P.admit({ command: e.command, now, state: { heartbeat: now, pressure, sys: st.sys }, kinds: st.kinds, cfg: c }).decision === 'allow') {
          const drift = Q.driftCheck(e, gitInfo(e.cwd));
          const logFile = Q.logFile(p.queue, e.id);
          fs.mkdirSync(path.dirname(logFile), { recursive: true });
          if (!drift.ok) {
            fs.appendFileSync(logFile, `skipped: ${drift.reason}\n`);
            Q.remove(p.queue, e.id); log(p, `queue skipped ${e.id}: ${drift.reason}`);
          } else {
            const out = fs.openSync(logFile, 'a');
            const shell = e.shell === 'powershell' ? ['powershell.exe', ['-NoProfile', '-Command', e.command]] : ['bash', ['-c', e.command]];
            const child = spawn(shell[0], shell[1], { cwd: e.cwd, detached: true, stdio: ['ignore', out, out], windowsHide: true });
            child.on('error', (err) => { try { fs.appendFileSync(logFile, `spawn failed: ${err.message}\n`); } catch {} });
            child.unref();
            fs.closeSync(out);
            st.queueRunning[e.id] = { pid: child.pid, startedAt: now };
            e.status = 'running'; Q.save(p.queue, e);
            log(p, `queue run ${e.id} pid ${child.pid}`);
          }
        }
      }

      // Reservations expire on their own.
      for (const { file, data } of S.readDir(p.reservations)) if (!(data.expiresAt > now)) S.removeFile(file);

      st.heartbeat = Date.now();
      save();

      const claudeJobs = Object.keys(st.tracked).length;
      if (!liveSessions && !claudeJobs && !Object.keys(throttles).length && !Object.keys(st.queueRunning).length && now - startedAt > 60000) {
        return shutdown('no session and no Claude job left');
      }
    } catch (e) {
      log(p, `tick error: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    }
    const wait = Math.max(250, cfg.tickMs - (Date.now() - tickStart));
    await new Promise((r) => setTimeout(r, wait));
  }
}

if (require.main === module) {
  main().catch((e) => { try { log(govPaths(), `fatal: ${e.message}`); } catch {} process.exit(1); });
}

module.exports = { main, gitInfo };
