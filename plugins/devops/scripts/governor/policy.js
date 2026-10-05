/**
 * @module governor/policy
 * @description Pure decision logic of the Claude load governor — no I/O, no
 *   clock, no OS calls. Every function takes plain data and `now` and returns
 *   plain data, so each rule is unit-tested in isolation (policy.test.js).
 *
 *   Pipeline per tick (watcher.js):
 *     attributedPids → classify → groupJobs → trackJobs (heavy, kind)
 *     updatePriority (foreign load per resource, decay, foreground-all,
 *     learning, manual) + updateBudget (80/65 hysteresis, smoothing)
 *     → plan (newest yields first, relax one step per relaxMs)
 *   PreToolUse: admit (slot / reservation / defer).
 */
'use strict';

const RESOURCES = Object.freeze(['cpu', 'gpu', 'disk', 'ram']);
const LEVEL = Object.freeze({ NONE: 0, CAP: 1, PAUSE: 2 });

// ---------------------------------------------------------------------------
// OS exclusion
// ---------------------------------------------------------------------------

// Processes whose image path a normal user cannot read (protected/system) —
// recognised by name only when the path is unknown.
const WIN_OS_NAMES = new Set([
  'system', 'idle', 'system idle process', 'registry', 'memory compression', 'secure system', 'smss.exe',
  'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'lsaiso.exe', 'svchost.exe',
  'dwm.exe', 'fontdrvhost.exe', 'msmpeng.exe', 'mpdefendercoreservice.exe', 'nissrv.exe', 'securityhealthservice.exe',
  'audiodg.exe', 'searchindexer.exe', 'tiworker.exe', 'trustedinstaller.exe', 'wmiprvse.exe', 'spoolsv.exe',
  'mousocoreworker.exe', 'sgrmbroker.exe', 'vmmem', 'vmmemwsl', 'vmcompute.exe', 'wudfhost.exe', 'dashost.exe',
  'conhost.exe', 'ctfmon.exe', 'sihost.exe', 'taskhostw.exe', 'runtimebroker.exe', 'explorer.exe',
]);

function lowerSlash(p) { return String(p || '').replace(/\//g, '\\').toLowerCase(); }

/**
 * @param {{pid:number, ppid?:number, name?:string, path?:string|null, signer?:string|null, kernel?:boolean, cgroup?:string}} p
 * @param {{platform:string, systemRoot?:string}} env
 */
function isOsProcess(p, env) {
  const name = String(p.name || '').toLowerCase();
  if (env.platform === 'win32') {
    if (p.pid === 0 || p.pid === 4) return true;
    if (!p.path) return WIN_OS_NAMES.has(name);
    const file = lowerSlash(p.path);
    const root = lowerSlash(env.systemRoot || 'C:\\Windows').replace(/\\+$/, '') + '\\';
    const ms = /microsoft/i.test(p.signer || '');
    if (file.startsWith(root)) return ms;
    // Defender lives outside %SystemRoot%.
    if (/\\(windows defender|microsoft\\windows defender)\\/.test(file)) return ms;
    return false;
  }
  if (env.platform === 'linux') {
    if (p.kernel || p.pid === 2 || p.ppid === 2) return true;
    const cg = String(p.cgroup || '');
    return cg === '/system.slice' || cg.startsWith('/system.slice/') || cg.startsWith('/init.scope');
  }
  if (env.platform === 'darwin') {
    if (p.pid === 0 || p.pid === 1) return true;
    const file = String(p.path || '');
    const sysPath = /^\/(System|usr\/libexec|usr\/sbin|sbin)\//.test(file);
    return sysPath && /apple/i.test(p.signer || 'apple');
  }
  return false;
}

// ---------------------------------------------------------------------------
// App identity (top-level folder, not exe)
// ---------------------------------------------------------------------------

function splitPath(p) { return String(p || '').split(/[\\/]+/).filter(Boolean); }

/**
 * The folder an app is remembered by: the game folder directly below a
 * library root, the vendor folder below Program Files / Applications / opt,
 * else the exe's directory. Lower-case, forward slashes.
 */
function appKey(exePath, libraryRoots = []) {
  if (!exePath) return null;
  const norm = String(exePath).replace(/\\/g, '/').toLowerCase();
  for (const r of libraryRoots) {
    const root = String(r).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') + '/';
    if (norm.startsWith(root)) {
      const first = norm.slice(root.length).split('/')[0];
      if (first && norm.slice(root.length).includes('/')) return root + first;
    }
  }
  const m = norm.match(/^([a-z]:\/program files(?: \(x86\))?\/[^/]+)\//)
    || norm.match(/^([a-z]:\/users\/[^/]+\/appdata\/local\/programs\/[^/]+)\//)
    || norm.match(/^(\/applications\/[^/]+?\.app)\//)
    || norm.match(/^(\/opt\/[^/]+)\//)
    || norm.match(/^([a-z]:\/[^/]+)\/[^/]+\.exe$/);
  if (m) return m[1];
  const parts = splitPath(norm);
  parts.pop();
  return (norm.startsWith('/') ? '/' : '') + parts.join('/');
}

function appLabel(key) {
  const parts = splitPath(key);
  return (parts[parts.length - 1] || String(key || '')).replace(/\.app$/, '');
}

/** True when `key` or `name` matches an entry of a config list (substring, case-insensitive). */
function listed(list, key, name) {
  const k = String(key || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return (list || []).some((e) => {
    const x = String(e || '').toLowerCase().replace(/\\/g, '/').trim();
    return x && ((k && k.includes(x)) || (n && n === x));
  });
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

const CLAUDE_NAME = /^claude(\.exe)?$/i;

function isClaudeRoot(p) {
  return CLAUDE_NAME.test(p.name || '') || /@anthropic-ai[\\/]claude-code/i.test(p.cmd || '');
}

/**
 * Claude-attributed pids: every claude process, every extra root (queued jobs
 * the watcher runs), all their descendants, plus the session job members.
 * A ppid link only counts when the parent started before the child (pid reuse).
 * @returns {Set<number>}
 */
function attributedPids(procs, { jobPids = [], extraRoots = [] } = {}) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const out = new Set();
  const stack = procs.filter((p) => isClaudeRoot(p)).map((p) => p.pid);
  for (const r of extraRoots) if (byPid.has(r)) stack.push(r);
  for (const j of jobPids) if (byPid.has(j)) stack.push(j);
  while (stack.length) {
    const pid = stack.pop();
    if (out.has(pid)) continue;
    out.add(pid);
    const parent = byPid.get(pid);
    for (const c of children.get(pid) || []) {
      if (c.pid === pid) continue;
      if (parent && Number.isFinite(parent.startMs) && Number.isFinite(c.startMs) && c.startMs + 1000 < parent.startMs) continue;
      stack.push(c.pid);
    }
  }
  return out;
}

/** Claude itself, its MCP servers and whatever starts with a session are infrastructure. */
function isInfra(p, { sessionStarts = [], graceMs = 20000 } = {}) {
  if (isClaudeRoot(p)) return true;
  if (/(^|[\s\\/_-])mcp([\s\\/_.-]|$)|mcp-server|mcp_server|modelcontextprotocol/i.test(p.cmd || '')) return true;
  return sessionStarts.some((s) => Number.isFinite(p.startMs) && p.startMs >= s - 5000 && p.startMs <= s + graceMs);
}

/**
 * @returns {'self'|'infra'|'claude'|'service'|'os'|'foreign'}
 */
function classify(p, ctx) {
  if (ctx.selfPids && ctx.selfPids.has(p.pid)) return 'self';
  if (ctx.attributed && ctx.attributed.has(p.pid)) {
    return isInfra(p, { sessionStarts: ctx.sessionStarts, graceMs: ctx.graceMs }) ? 'infra' : 'claude';
  }
  if (ctx.activeServices && ctx.activeServices.has(String(p.name || '').toLowerCase())) return 'service';
  if (p.os) return 'os';
  return 'foreign';
}

/**
 * Self-loop guard: names of Claude-driven services whose load counts as
 * Claude's right now (request in flight, or ended < selfLoopMs ago).
 * @param {Array<{names:string[], inflight:string}>} services
 * @param {Record<string,{active?:boolean, endedAt?:number}>} markers by inflight name
 */
function activeServiceNames(services, markers, now, selfLoopMs) {
  const out = new Set();
  for (const s of services || []) {
    const m = markers && markers[s.inflight];
    if (!m) continue;
    const live = m.active === true || (Number.isFinite(m.endedAt) && now - m.endedAt < selfLoopMs);
    if (live) for (const n of s.names || []) out.add(String(n).toLowerCase());
  }
  return out;
}

/**
 * Group Claude processes into jobs: the subtree below the first non-infra
 * ancestor of a Claude root (the tool call's shell, a queued run). Loads sum.
 * @returns {Map<string, object>}
 */
function groupJobs(procs, classes, listening = new Set()) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const jobs = new Map();
  for (const p of procs) {
    if (classes.get(p.pid) !== 'claude') continue;
    let root = p;
    for (let i = 0; i < 64; i++) {
      const parent = byPid.get(root.ppid);
      if (!parent || classes.get(parent.pid) !== 'claude' || parent.pid === root.pid) break;
      if (Number.isFinite(parent.startMs) && Number.isFinite(root.startMs) && root.startMs + 1000 < parent.startMs) break;
      root = parent;
    }
    const id = `${root.pid}@${Math.round(root.startMs || 0)}`;
    let j = jobs.get(id);
    if (!j) {
      j = { id, rootPid: root.pid, startMs: root.startMs || 0, name: root.name, cmd: root.cmd || '', pids: [], cpuPct: 0, gpuPct: 0, ioBps: 0, memMB: 0, listening: false, container: null };
      jobs.set(id, j);
    }
    j.pids.push({ pid: p.pid, startMs: p.startMs || 0 });
    j.cpuPct += p.cpuPct || 0;
    j.gpuPct = Math.max(j.gpuPct, p.gpuPct || 0);
    j.ioBps += p.ioBps || 0;
    j.memMB += p.memMB || 0;
    if (listening.has(p.pid)) j.listening = true;
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Heavy tracking and job kind
// ---------------------------------------------------------------------------

function loadedResources(load, th, diskBusy = true) {
  const r = [];
  if ((load.cpuPct || 0) > th.cpuPct) r.push('cpu');
  if ((load.gpuPct || 0) > th.gpuPct) r.push('gpu');
  if (diskBusy && (load.ioBps || 0) > th.diskBps) r.push('disk');
  if ((load.memMB || 0) > th.ramMB) r.push('ram');
  return r;
}

/**
 * @param {Record<string,object>} prev tracked jobs of the last tick
 * @param {Map<string,object>} jobs this tick's jobs
 * @param {{diskBusy?:boolean, foreground?:Array<{startedAt:number}>}} ctx
 * @returns {Record<string,object>} tracked jobs (dead jobs dropped)
 */
function trackJobs(prev, jobs, now, cfg, ctx = {}) {
  const th = cfg.heavy;
  const out = {};
  for (const j of jobs.values()) {
    const p = (prev && prev[j.id]) || { firstSeen: now, overSince: null, lastOver: null, heavySince: null, res: [], peakMB: 0, gpu: false };
    // "Heavy" is measured on CPU, GPU and disk; RAM only says which pressure the job feeds.
    const loads = loadedResources(j, th, ctx.diskBusy !== false);
    const over = loads.some((r) => r !== 'ram');
    let overSince = p.overSince;
    let lastOver = p.lastOver;
    if (over) { overSince = overSince ?? now; lastOver = now; } else if (lastOver === null || now - lastOver > th.dipMs) overSince = null;
    const heavyNow = overSince !== null && now - overSince >= th.sustainMs;
    const heavySince = p.heavySince ?? (heavyNow ? now : null);
    const res = Array.from(new Set([...(p.res || []), ...(heavySince !== null || heavyNow ? loads : [])]));
    const gpu = p.gpu || (heavySince !== null && (j.gpuPct || 0) > th.gpuPct);
    const fg = (ctx.foreground || []).some((f) => Number.isFinite(f.startedAt) && j.startMs >= f.startedAt - 2000);
    let kind = 'build';
    if (j.listening) kind = 'server';
    else if (fg) kind = 'foreground';
    else if (j.container) kind = heavySince !== null && now - heavySince >= th.generatorMs ? 'generator' : 'container';
    else if (heavySince !== null && now - heavySince >= th.generatorMs) kind = 'generator';
    out[j.id] = {
      ...p, id: j.id, rootPid: j.rootPid, startMs: j.startMs, name: j.name, cmd: j.cmd, pids: j.pids, container: j.container || null,
      cpuPct: j.cpuPct, gpuPct: j.gpuPct, ioBps: j.ioBps, memMB: j.memMB,
      overSince, lastOver, heavySince, heavy: heavySince !== null, res, gpu, kind,
      peakMB: Math.max(p.peakMB || 0, j.memMB || 0),
    };
  }
  return out;
}

/** Highest level a job may reach: only CPU generators are paused. */
function maxLevel(job) {
  if (job.kind === 'generator' && !job.gpu) return LEVEL.PAUSE;
  return LEVEL.CAP;
}

// ---------------------------------------------------------------------------
// Foreign priority
// ---------------------------------------------------------------------------

/**
 * @param {{apps?:object}} prev
 * @param {Array<object>} foreign foreign processes with cpuPct/gpuPct/ioBps/memMB/path/name
 * @param {object} ctx { libraryRoots, libraryExes:Set(lower path), learned:{key:{resources}}, manual:boolean,
 *   foreground:{pid, fullscreen, idleMs}|null, cfg }
 * @returns {{apps:object, active:Record<string,string>, all:boolean, allBy:string|null, newlyLearned:Array}}
 */
function updatePriority(prev, foreign, now, ctx) {
  const cfg = ctx.cfg;
  const f = cfg.foreign;
  const apps = {};
  const prevApps = (prev && prev.apps) || {};
  const learned = ctx.learned || {};
  const libExes = ctx.libraryExes || new Set();
  const newlyLearned = [];
  const seen = new Map();
  for (const p of foreign) {
    const key = appKey(p.path, ctx.libraryRoots) || String(p.name || '').toLowerCase();
    if (!key || listed(cfg.neverPriority, key, p.name)) continue;
    const a = seen.get(key) || { key, cpuPct: 0, gpuPct: 0, ioBps: 0, memMB: 0, pids: [], name: p.name, path: p.path };
    a.cpuPct += p.cpuPct || 0;
    a.gpuPct = Math.max(a.gpuPct, p.gpuPct || 0);
    a.ioBps += p.ioBps || 0;
    a.memMB += p.memMB || 0;
    a.pids.push(p.pid);
    a.fromLibrary = a.fromLibrary || [...(ctx.libraryRoots || []), ...(ctx.libraryDirs || [])].some((r) => lowerSlash(p.path).startsWith(lowerSlash(r).replace(/\\+$/, '') + '\\'))
      || libExes.has(lowerSlash(p.path));
    seen.set(key, a);
  }
  const fgPid = ctx.foreground && ctx.foreground.pid;
  for (const a of seen.values()) {
    const old = prevApps[a.key] || { res: {}, loadSince: null, lastLoad: null };
    const res = { ...old.res };
    const loads = loadedResources(a, { cpuPct: f.cpuPct, gpuPct: f.gpuPct, diskBps: f.diskBps, ramMB: f.ramMB });
    for (const r of loads) res[r] = now;
    const startRes = learned[a.key] ? (learned[a.key].resources || RESOURCES)
      : (a.fromLibrary || listed(cfg.alwaysPriority, a.key, a.name)) ? RESOURCES : null;
    if (startRes) for (const r of startRes) res[r] = now;
    let loadSince = old.loadSince;
    let lastLoad = old.lastLoad;
    if (loads.length) { loadSince = loadSince ?? now; lastLoad = now; } else if (lastLoad === null || now - lastLoad > 5000) loadSince = null;
    const isFg = fgPid && a.pids.includes(fgPid);
    const fullscreen3d = isFg && ctx.foreground.fullscreen && loads.includes('gpu');
    const learnAfter = fullscreen3d ? f.learnFullscreenMs : f.learnMs;
    let isLearned = Boolean(learned[a.key]) || a.fromLibrary;
    if (!isLearned && loadSince !== null && now - loadSince >= learnAfter && !old.learned) {
      newlyLearned.push({ key: a.key, name: appLabel(a.key), resources: Array.from(new Set([...(old.learnRes || []), ...loads])), learnedAt: now });
      isLearned = true;
    }
    apps[a.key] = {
      key: a.key, name: a.name, res, loadSince, lastLoad, running: true, learned: isLearned || old.learned || false,
      learnRes: Array.from(new Set([...(old.learnRes || []), ...loads])), pids: a.pids,
    };
  }
  // Apps that stopped keep their per-resource timestamps until they decay.
  for (const [key, old] of Object.entries(prevApps)) {
    if (apps[key]) continue;
    if (listed(cfg.neverPriority, key, old.name)) continue;
    if (Object.values(old.res || {}).some((t) => now - t < f.decayMs)) apps[key] = { ...old, running: false, pids: [], loadSince: null };
  }
  const active = {};
  for (const a of Object.values(apps)) {
    for (const [r, t] of Object.entries(a.res || {})) {
      if (now - t < f.decayMs && (!active[r] || (apps[active[r]].res[r] || 0) < t)) active[r] = a.key;
    }
  }
  let all = false;
  let allBy = null;
  if (ctx.manual) { all = true; allBy = 'manual'; }
  if (!all && fgPid && ctx.foreground.idleMs !== undefined && ctx.foreground.idleMs < f.interactiveIdleMs) {
    const fgApp = Object.values(apps).find((a) => a.running && a.pids.includes(fgPid));
    if (fgApp && Object.values(fgApp.res).some((t) => now - t < f.decayMs)) { all = true; allBy = fgApp.key; }
  }
  if (all) for (const r of RESOURCES) if (!active[r]) active[r] = allBy;
  return { apps, active, all, allBy, newlyLearned };
}

// ---------------------------------------------------------------------------
// 80 % budget
// ---------------------------------------------------------------------------

function mean(xs) { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; }

/**
 * @param {object} prev { window, over, baseline:{diskMs, samples, since} }
 * @param {{cpuPct, gpuPct, diskMs, diskQueue, totalMB, freeMB, pagesPerSec}} sys
 */
function updateBudget(prev, sys, now, cfg) {
  const b = cfg.budget;
  const window = [...((prev && prev.window) || []), { ts: now, ...sys }].filter((s) => now - s.ts <= b.smoothMs);
  const wasOver = (prev && prev.over) || {};
  const baseline = { ...((prev && prev.baseline) || {}) };
  if (!Number.isFinite(baseline.diskMs)) {
    baseline.since = baseline.since ?? now;
    baseline.samples = [...(baseline.samples || []), sys.diskMs].filter(Number.isFinite).slice(-200);
    if (now - baseline.since >= b.baselineMs && baseline.samples.length) {
      const sorted = [...baseline.samples].sort((x, y) => x - y);
      baseline.diskMs = Math.max(b.minBaselineMs, sorted[Math.floor(sorted.length * 0.2)]);
      delete baseline.samples;
    }
  }
  const ratio = b.lowPct / b.highPct;
  const m = {
    cpu: mean(window.map((s) => s.cpuPct)),
    gpu: mean(window.map((s) => s.gpuPct)),
    diskMs: mean(window.map((s) => s.diskMs)),
    diskQueue: mean(window.map((s) => s.diskQueue)),
    freeMB: mean(window.map((s) => s.freeMB)),
    totalMB: mean(window.map((s) => s.totalMB)),
    pages: mean(window.map((s) => s.pagesPerSec)),
  };
  const hyst = (was, v) => (Number.isFinite(v) ? (was ? v > b.lowPct : v > b.highPct) : false);
  const over = { cpu: hyst(wasOver.cpu, m.cpu), gpu: hyst(wasOver.gpu, m.gpu), disk: false, ram: false };
  const base = Number.isFinite(baseline.diskMs) ? baseline.diskMs : NaN;
  if (Number.isFinite(base) && Number.isFinite(m.diskMs)) {
    const r = m.diskMs / base;
    const q = Number.isFinite(m.diskQueue) ? m.diskQueue : 0;
    over.disk = wasOver.disk ? (r > b.diskLatencyFactor * ratio && q > b.diskQueue * ratio) : (r > b.diskLatencyFactor && q > b.diskQueue);
  }
  if (Number.isFinite(m.freeMB) && Number.isFinite(m.totalMB) && m.totalMB > 0) {
    const need = Math.max(m.totalMB * b.ramFreePct / 100, b.ramFreeMB);
    const paging = Number.isFinite(m.pages) && m.pages > b.pagingPerSec;
    over.ram = wasOver.ram ? (m.freeMB < need / ratio || paging) : (m.freeMB < need || paging);
  }
  return { window, over, baseline, mean: m };
}

// ---------------------------------------------------------------------------
// Step controller
// ---------------------------------------------------------------------------

/**
 * Desired throttle level per job. Priority resources: every heavy job loading
 * them yields at once to its max level. Over-budget only: one step per
 * escalateMs, newest heavy job first. Relax: one step per relaxMs, oldest
 * first (the newest returns last), only after relaxMs without a change.
 * @param {Record<string,object>} jobs tracked jobs (alive)
 * @param {Record<string,{level:number, resources:string[]}>} current throttles by jobId
 * @param {{priority:string[], over:string[]}} pressure
 * @param {{escalateAt?:number, changeAt?:number}} last
 * @returns {{desired:Record<string,{level:number, resources:string[]}>, last:object}}
 */
function plan(jobs, current, pressure, now, cfg, last = {}) {
  const prio = new Set(pressure.priority || []);
  const over = new Set(pressure.over || []);
  const pressured = new Set([...prio, ...over]);
  const desired = {};
  for (const [id, t] of Object.entries(current || {})) if (jobs[id]) desired[id] = { level: t.level, resources: [...(t.resources || [])] };
  const next = { escalateAt: last.escalateAt ?? -Infinity, changeAt: last.changeAt ?? -Infinity };
  const heavy = Object.values(jobs).filter((j) => j.heavy).sort((a, b) => (b.heavySince - a.heavySince) || (b.startMs - a.startMs));
  const hits = (j, set) => (j.res || []).filter((r) => set.has(r));
  let changed = false;
  for (const j of heavy) {
    const r = hits(j, prio);
    if (!r.length) continue;
    const cur = desired[j.id] || { level: 0, resources: [] };
    const target = maxLevel(j);
    if (cur.level < target) { desired[j.id] = { level: target, resources: Array.from(new Set([...cur.resources, ...r])) }; changed = true; }
    else desired[j.id] = { level: cur.level, resources: Array.from(new Set([...cur.resources, ...r])) };
  }
  if (over.size && now - next.escalateAt >= cfg.budget.escalateMs) {
    const j = heavy.find((x) => hits(x, over).length && (desired[x.id]?.level || 0) < maxLevel(x));
    if (j) {
      const cur = desired[j.id] || { level: 0, resources: [] };
      desired[j.id] = { level: cur.level + 1, resources: Array.from(new Set([...cur.resources, ...hits(j, over)])) };
      next.escalateAt = now;
      changed = true;
    }
  }
  if (changed) next.changeAt = now;
  else if (now - next.changeAt >= cfg.budget.relaxMs) {
    const relaxable = Object.entries(desired)
      .filter(([, t]) => t.level > 0 && !t.resources.some((r) => pressured.has(r)))
      .map(([id]) => jobs[id])
      .sort((a, b) => (a.heavySince - b.heavySince) || (a.startMs - b.startMs));
    const j = relaxable[0];
    if (j) {
      desired[j.id] = { ...desired[j.id], level: desired[j.id].level - 1 };
      if (desired[j.id].level === 0) desired[j.id].resources = [];
      next.changeAt = now;
    }
  }
  for (const id of Object.keys(desired)) if (desired[id].level <= 0) delete desired[id];
  return { desired, last: next };
}

/** Pressure on resources: priority (foreign) and over-budget, as sorted lists. */
function pressureOf(priority, budget) {
  return {
    priority: RESOURCES.filter((r) => priority && priority.active && priority.active[r]),
    over: RESOURCES.filter((r) => budget && budget.over && budget.over[r]),
  };
}

// ---------------------------------------------------------------------------
// Orphan reversal
// ---------------------------------------------------------------------------

/**
 * Every recorded throttle is reversed at watcher start; a pid whose start
 * time no longer matches (gone, or reused) is dropped without an OS call.
 * @param {Array<{pids:Array<{pid:number,startMs:number}>}>} throttles
 * @param {Map<number,{startMs:number}>|null} alive null = unknown → revert all (the adapter re-checks identity)
 */
function reversalPlan(throttles, alive) {
  return (throttles || []).map((t) => {
    if (t.container) return { entry: t, action: 'revert', pids: [] };
    const pids = (t.pids || []).filter((p) => {
      if (!alive) return true;
      const cur = alive.get(p.pid);
      return cur && Math.abs((cur.startMs || 0) - (p.startMs || 0)) < 2000;
    });
    return { entry: t, action: pids.length ? 'revert' : 'drop', pids };
  });
}

// ---------------------------------------------------------------------------
// Admission (PreToolUse)
// ---------------------------------------------------------------------------

const HEAVY_CMDS = [
  [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|ci|install|i|rebuild|e2e)\b/i, (m) => `${m[1]} ${m[3]}`.toLowerCase()],
  [/\b(npx\s+)?(vitest|jest|mocha|playwright|cypress|tsc|webpack|vite\s+build|next\s+build|turbo|nx)\b/i, (m) => m[2].toLowerCase().replace(/\s+/g, ' ')],
  [/\b(pytest|tox|nox)\b/i, (m) => m[1].toLowerCase()],
  [/\b(cargo|go|dotnet|mvn|mvnw|gradle|gradlew|swift|zig)\s+(build|test|run|install|publish|bench|package|verify|compile)\b/i, (m) => `${m[1]} ${m[2]}`.toLowerCase()],
  [/\b(make|ninja|cmake\s+--build|msbuild|bazel|meson\s+compile)\b/i, (m) => m[1].toLowerCase().replace(/\s+/g, ' ')],
  [/\bdocker\s+(build|run|compose\s+up|compose\s+build|buildx)\b|\bdocker-compose\s+(up|build)\b/i, () => 'docker'],
  [/\b(ffmpeg|blender|handbrakecli|ollama\s+(run|pull|create)|whisper|llama-cli)\b/i, (m) => m[1].toLowerCase().split(/\s+/)[0]],
  [/\bpython3?\s+\S*(train|finetune|fine_tune|render|generate|benchmark)\S*/i, () => 'python generator'],
];

const ESCAPES = [
  /(^|[\s;&|(])wsl(\.exe)?\s/i, /\bschtasks\b/i, /\bStart-Process\b[^|;]*-Verb\b/i,
  /(^|[\s;&|(])sc(\.exe)?\s+(create|start|config)\b/i, /\bNew-Service\b/i, /\bStart-Service\b/i,
  /\bsystemd-run\b/i, /\bsystemctl\s+(--user\s+)?start\b/i, /\blaunchctl\s+(load|bootstrap|kickstart)\b/i,
  /\bnohup\b/i, /\bsetsid\b/i, /\bdisown\b/i,
];

/** Normalised job kind of a heavy-looking command, else null. */
function commandKind(cmd) {
  const s = String(cmd || '');
  for (const [re, kind] of HEAVY_CMDS) {
    const m = s.match(re);
    if (m) return kind(m);
  }
  return null;
}

function isEscape(cmd) { return ESCAPES.some((re) => re.test(String(cmd || ''))); }

/**
 * @param {object} a
 * @param {string} a.command
 * @param {object|null} a.state watcher state (heartbeat, pressure, sys.freeMB, enabled)
 * @param {Array<{mb:number, expiresAt:number}>} a.reservations
 * @param {Record<string,{peakMB:number}>} a.kinds learned per-kind peaks
 * @returns {{decision:'allow'|'defer', reason:string, kind:string|null, expectedMB:number, reserve:boolean}}
 */
function admit({ command, now, state, reservations = [], kinds = {}, cfg }) {
  const kind = commandKind(command);
  const escape = isEscape(command);
  const none = { kind, expectedMB: 0, reserve: false };
  if (!kind && !escape) return { decision: 'allow', reason: 'light', ...none };
  const hb = state && Number.isFinite(state.heartbeat) ? state.heartbeat : null;
  const alive = hb !== null && now - hb < cfg.admission.staleMs;
  const p = (state && state.pressure) || { priority: [], over: [] };
  const hasPressure = (p.priority || []).length > 0 || (p.over || []).length > 0;
  // Stale state still counts while its pressure could not have decayed yet: uncertain → defer.
  const pressure = hasPressure && (alive || (hb !== null && now - hb < cfg.foreign.decayMs));
  if (pressure) {
    const by = (state && state.priorityBy) || null;
    return { decision: 'defer', reason: alive ? (by ? `priority:${by}` : `budget:${(p.over || []).join(',')}`) : 'uncertain', ...none };
  }
  if (!kind) return { decision: 'allow', reason: 'escape-no-pressure', ...none };
  if (!alive) return { decision: 'allow', reason: 'watcher-absent', ...none };
  const expectedMB = (kinds[kind] && kinds[kind].peakMB) || cfg.admission.defaultMB;
  const reserved = reservations.filter((r) => r.expiresAt > now).reduce((s, r) => s + (r.mb || 0), 0);
  const free = (state.sys && Number.isFinite(state.sys.freeMB) ? state.sys.freeMB : Infinity) - reserved;
  if (free < expectedMB + cfg.admission.headroomMB) return { decision: 'defer', reason: 'ram', kind, expectedMB, reserve: false };
  return { decision: 'allow', reason: 'slot', kind, expectedMB, reserve: true };
}

module.exports = {
  RESOURCES, LEVEL, WIN_OS_NAMES,
  isOsProcess, appKey, appLabel, listed,
  isClaudeRoot, attributedPids, isInfra, classify, activeServiceNames, groupJobs,
  loadedResources, trackJobs, maxLevel,
  updatePriority, updateBudget, plan, pressureOf, reversalPlan,
  commandKind, isEscape, admit,
};
