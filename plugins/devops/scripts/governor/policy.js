/**
 * @module governor/policy
 * @description Pure decision logic of the Claude load governor — no I/O, no
 *   clock, no OS calls. Every function takes plain data and `now` and returns
 *   plain data (policy.test.js).
 *
 *   Pipeline per tick (watcher.js):
 *     attributedPids → classify → groupJobs → trackJobs (heavy, kind)
 *     updatePriority (foreign CPU/GPU/disk load, decay, foreground-all,
 *     learning, manual) + updateBudget (80/65 hysteresis, smoothing; disk:
 *     active time AND slow) → plan (newest yields first; each job relaxes on
 *     its own once its resources were not pressed for relaxMs) → culprits
 *   PreToolUse: classifyCommand + admit.
 */
'use strict';

const RESOURCES = Object.freeze(['cpu', 'gpu', 'disk', 'ram']);
// Foreign apps earn priority on these only: RAM is a system-pressure signal (80 % rule), never a priority trigger.
const PRIORITY_TRIGGERS = Object.freeze(['cpu', 'gpu', 'disk']);
const LEVEL = Object.freeze({ NONE: 0, CAP: 1, PAUSE: 2 });

// ---------------------------------------------------------------------------
// OS exclusion
// ---------------------------------------------------------------------------

// Processes whose image path a normal user cannot read — recognised by name only when the path is unknown.
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
 * Windows: anything under %SystemRoot% or Defender's folders (no signature
 * lookup: an unknown exe there counts as OS — it never gets priority, it is
 * never throttled, it still counts toward the 80 % rule).
 * @param {{pid:number, ppid?:number, name?:string, path?:string|null, kernel?:boolean, cgroup?:string}} p
 * @param {{platform:string, systemRoot?:string}} env
 */
function isOsProcess(p, env) {
  const name = String(p.name || '').toLowerCase();
  if (env.platform === 'win32') {
    if (p.pid === 0 || p.pid === 4) return true;
    if (!p.path) return WIN_OS_NAMES.has(name);
    const file = lowerSlash(p.path);
    const root = lowerSlash(env.systemRoot || 'C:\\Windows').replace(/\\+$/, '') + '\\';
    return file.startsWith(root) || /\\(windows defender|microsoft\\windows defender)\\/.test(file);
  }
  if (env.platform === 'linux') {
    if (p.kernel || p.pid === 2 || p.ppid === 2) return true;
    const cg = String(p.cgroup || '');
    return cg === '/system.slice' || cg.startsWith('/system.slice/') || cg.startsWith('/init.scope');
  }
  if (env.platform === 'darwin') {
    if (p.pid === 0 || p.pid === 1) return true;
    return /^\/(System|usr\/libexec)\//.test(String(p.path || ''));
  }
  return false;
}

// ---------------------------------------------------------------------------
// App identity (top-level folder, not exe)
// ---------------------------------------------------------------------------

function splitPath(p) { return String(p || '').split(/[\\/]+/).filter(Boolean); }

/**
 * The folder an app is remembered by: a known single-game folder, the game
 * folder directly below a library root, the vendor folder below Program Files
 * (one level deeper for container folders) / Applications / opt, else the
 * exe's directory. Lower-case, forward slashes.
 */
function appKey(exePath, libraryRoots = [], gameDirs = []) {
  if (!exePath) return null;
  const norm = String(exePath).replace(/\\/g, '/').toLowerCase();
  for (const d of gameDirs) {
    const dir = String(d).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (dir && norm.startsWith(`${dir}/`)) return dir;
  }
  for (const r of libraryRoots) {
    const root = String(r).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') + '/';
    if (norm.startsWith(root)) {
      const rest = norm.slice(root.length);
      if (rest.includes('/')) return root + rest.split('/')[0];
    }
  }
  const deep = norm.match(/^([a-z]:\/program files(?: \(x86\))?\/(?:windowsapps|microsoft|common files)\/[^/]+)\//);
  if (deep) return deep[1];
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

/** True when `key` or `name` matches an entry of a config list (substring of the key, or exact name). */
function listed(list, key, name) {
  const k = String(key || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return (list || []).some((e) => {
    const x = String(e || '').toLowerCase().replace(/\\/g, '/').trim();
    return x && ((k && k.includes(x)) || (n && n === x));
  });
}

// Never learned, never library-started: launchers, browsers, IDEs, chat/Electron hosts.
const NO_LEARN = new Set([
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'epicwebhelper.exe', 'upc.exe', 'ubisoftconnect.exe',
  'uplaywebcore.exe', 'ubisoftgamelauncher.exe', 'battle.net.exe', 'agent.exe', 'eadesktop.exe', 'eabackgroundservice.exe',
  'origin.exe', 'galaxyclient.exe', 'galaxyclient helper.exe', 'xboxpcapp.exe', 'gamingservices.exe', 'xboxapp.exe',
  'chrome.exe', 'msedge.exe', 'msedgewebview2.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'opera_gx.exe', 'vivaldi.exe', 'arc.exe',
  'code.exe', 'cursor.exe', 'windsurf.exe', 'devenv.exe', 'idea64.exe', 'pycharm64.exe', 'webstorm64.exe', 'rider64.exe',
  'clion64.exe', 'goland64.exe', 'zed.exe', 'sublime_text.exe', 'notepad++.exe',
  'discord.exe', 'slack.exe', 'teams.exe', 'ms-teams.exe', 'spotify.exe', 'electron.exe', 'obsidian.exe', 'notion.exe', 'whatsapp.exe',
  'steam', 'chrome', 'firefox', 'code', 'discord', 'slack', 'electron',
]);

// Script runtimes: one app key covers every script they run (often Claude-driven MCP servers or dev tools
// started by a host Claude cannot see through), so their measured load never earns priority.
const RUNTIMES = new Set([
  'node.exe', 'python.exe', 'pythonw.exe', 'py.exe', 'java.exe', 'javaw.exe', 'dotnet.exe', 'deno.exe', 'bun.exe', 'ruby.exe', 'php.exe',
  'node', 'python', 'python3', 'java', 'dotnet', 'deno', 'bun', 'ruby', 'php',
]);

// Background tools: their measured load never earns priority (it counts toward the 80 % budget instead)
// and they are never learned. Exe names, plus every exe whose name contains update/install/setup
// (updaters, installers) and every exe under Program Files\Git (git-bash's bash/sh/ssh) or Unity Hub
// (editor downloads/installers). Extend with cfg.noLearn; drop an app entirely with cfg.neverPriority.
const BACKGROUND = new Set([
  'git.exe', 'git-remote-https.exe', 'git-lfs.exe', 'onedrive.exe', 'onedrive.sync.service.exe', 'filecoauth.exe',
  '7z.exe', '7zg.exe', '7zfm.exe', 'searchindexer.exe', 'searchprotocolhost.exe', 'searchfilterhost.exe',
  'msmpeng.exe', 'mpdefendercoreservice.exe', 'nissrv.exe', 'mssense.exe', 'unity hub.exe', 'git',
]);
const BACKGROUND_KEY = /\/program files(?: \(x86\))?\/(git|unity hub)$/;
const BACKGROUND_NAME = /update|install|setup/;

/** True for a background tool (see BACKGROUND): by exe name, updater/installer name, or app key. */
function isBackgroundTool(key, name) {
  const n = String(name || '').toLowerCase();
  return BACKGROUND.has(n) || BACKGROUND_NAME.test(n) || BACKGROUND_KEY.test(String(key || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * The Claude Code CLI process. The Claude Desktop app (Electron, also
 * `Claude.exe`) is NOT a root: its renderers and GPU process are the user's app.
 */
function isClaudeRoot(p) {
  const cmd = String(p.cmd || '');
  if (/@anthropic-ai[\\/]claude-code[\\/]/i.test(cmd)) return true; // the installed CLI path, not `npm i -g @anthropic-ai/claude-code`
  if (!/^claude(\.exe)?$/i.test(p.name || '')) return false;
  if (/--type=/.test(cmd)) return false;
  return !/[\\/](windowsapps[\\/]claude_|anthropicclaude[\\/])|\/applications\/claude\.app\//i.test(String(p.path || ''));
}

/**
 * The Claude Desktop app (any of its processes, any version): `Claude.exe` under
 * `\WindowsApps\Claude_<version>…` (or AnthropicClaude / Claude.app). Version-agnostic, so an
 * app update never turns the Desktop app into a foreign app.
 */
function isClaudeDesktop(p) {
  if (!/^claude(\.exe)?$/i.test(p.name || '')) return false;
  return /[\\/](windowsapps[\\/]claude_|anthropicclaude[\\/])|\/applications\/claude\.app\//i.test(String(p.path || ''));
}

/**
 * Claude-attributed pids: every Claude Code process (or only the given roots
 * when claudeRoots is false) and all their descendants.
 * A ppid link only counts when the parent started before the child (pid reuse).
 * @returns {Set<number>}
 */
function attributedPids(procs, { extraRoots = [], claudeRoots = true } = {}) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of procs) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const out = new Set();
  const stack = claudeRoots ? procs.filter((p) => isClaudeRoot(p)).map((p) => p.pid) : [];
  for (const r of extraRoots) if (byPid.has(r)) stack.push(r);
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

/**
 * App keys of the programs HOSTING Claude Code — every ancestor of a Claude
 * root (the Desktop app, VS Code, a terminal, an IDE). Every process sharing
 * such a key is the host, not a foreign app: it never gets priority and is
 * never learned (its renderers/GPU process would otherwise make Claude yield
 * to itself).
 * @param {(p:object) => string|null} keyOf
 * @returns {Set<string>}
 */
function hostKeys(procs, keyOf) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out = new Set();
  for (const root of procs.filter((p) => isClaudeRoot(p))) {
    const seen = new Set();
    for (let cur = byPid.get(root.ppid); cur && !seen.has(cur.pid); cur = byPid.get(cur.ppid)) {
      seen.add(cur.pid);
      if (Number.isFinite(cur.startMs) && Number.isFinite(root.startMs) && cur.startMs > root.startMs + 1000) break; // pid reuse
      const k = keyOf(cur);
      if (k) out.add(k);
    }
  }
  return out;
}

/**
 * Pids of the host tree: every process of the Claude Desktop app, every non-OS ancestor of a
 * Claude root (VS Code, a terminal, an IDE — OS processes such as explorer.exe never count, they
 * are everyone's parent) and all their descendants. A process in this tree that is not Claude's own
 * (e.g. a dev server the Desktop app's preview launched) is the host: never priority, never learned.
 * @param {(p:object) => boolean} isOs
 * @returns {Set<number>}
 */
function hostPids(procs, isOs = () => false) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const roots = procs.filter((p) => isClaudeDesktop(p)).map((p) => p.pid);
  for (const root of procs.filter((p) => isClaudeRoot(p))) {
    const seen = new Set();
    for (let cur = byPid.get(root.ppid); cur && !seen.has(cur.pid); cur = byPid.get(cur.ppid)) {
      seen.add(cur.pid);
      if (Number.isFinite(cur.startMs) && Number.isFinite(root.startMs) && cur.startMs > root.startMs + 1000) break; // pid reuse
      if (!isOs(cur)) roots.push(cur.pid);
    }
  }
  return roots.length ? attributedPids(procs, { extraRoots: roots, claudeRoots: false }) : new Set();
}

/** Descendants of each session's claude pid → session id. */
function sessionMap(procs, sessions) {
  const out = new Map();
  for (const [sid, pid] of Object.entries(sessions || {})) {
    for (const d of attributedPids(procs, { extraRoots: [pid], claudeRoots: false })) if (!out.has(d)) out.set(d, sid);
  }
  return out;
}

/** Claude itself, its MCP servers and whatever starts with a session are infrastructure. */
function isInfra(p, { sessionStarts = [], graceMs = 20000 } = {}) {
  if (isClaudeRoot(p)) return true;
  if (/(^|[\s\\/_-])mcp([\s\\/_.-]|$)|mcp-server|mcp_server|modelcontextprotocol/i.test(p.cmd || '')) return true;
  return sessionStarts.some((s) => Number.isFinite(p.startMs) && p.startMs >= s - 5000 && p.startMs <= s + graceMs);
}

/** @returns {'self'|'infra'|'claude'|'service'|'os'|'foreign'} */
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
 * Claude's now — a request is in flight (count > 0, updated < 30 min ago) or
 * ended < selfLoopMs ago. Markers come one file per client process.
 * @param {Record<string, Array<{count?:number, updatedAt?:number, endedAt?:number}>>} markers by inflight name
 */
function activeServiceNames(services, markers, now, selfLoopMs) {
  const out = new Set();
  for (const s of services || []) {
    const live = ((markers && markers[s.inflight]) || []).some((m) => (m.count > 0 && now - (m.updatedAt || 0) < 30 * 60000)
      || (Number.isFinite(m.endedAt) && now - m.endedAt < selfLoopMs));
    if (live) for (const n of s.names || []) out.add(String(n).toLowerCase());
  }
  return out;
}

/** Every service name (lower case) — never learned as a priority app. */
function serviceNames(services) {
  return new Set((services || []).flatMap((s) => s.names || []).map((n) => String(n).toLowerCase()));
}

/**
 * Group Claude processes into jobs: the subtree below the first non-Claude
 * ancestor (the tool call's shell). Loads sum. `sessionOf` maps pid → session.
 * @returns {Map<string, object>}
 */
function groupJobs(procs, classes, listening = new Set(), sessionOf = new Map()) {
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
      j = { id, rootPid: root.pid, startMs: root.startMs || 0, name: root.name, cmd: root.cmd || '', session: sessionOf.get(root.pid) || null, pids: [], cpuPct: 0, gpuPct: 0, ioBps: 0, iops: 0, memMB: 0, listening: false };
      jobs.set(id, j);
    }
    j.pids.push({ pid: p.pid, startMs: p.startMs || 0 });
    j.cpuPct += p.cpuPct || 0;
    j.gpuPct = Math.max(j.gpuPct, p.gpuPct || 0);
    j.ioBps += p.ioBps || 0;
    j.iops += p.iops || 0;
    j.memMB += p.memMB || 0;
    if (listening.has(p.pid)) j.listening = true;
  }
  return jobs;
}

// ---------------------------------------------------------------------------
// Heavy tracking and job kind
// ---------------------------------------------------------------------------

function loadedResources(load, th, { diskBusy = true, ram = true } = {}) {
  const r = [];
  if ((load.cpuPct || 0) > th.cpuPct) r.push('cpu');
  if ((load.gpuPct || 0) > th.gpuPct) r.push('gpu');
  if (diskBusy && ((load.ioBps || 0) > th.diskBps || (load.iops || 0) > (th.diskOps ?? Infinity))) r.push('disk');
  if (ram && (load.memMB || 0) > th.ramMB) r.push('ram');
  return r;
}

/** The foreground record a job belongs to (same session when both are known). */
function foregroundOf(j, records) {
  return (records || []).find((f) => Number.isFinite(f.startedAt) && j.startMs >= f.startedAt - 2000
    && (!j.session || !f.sessionId || f.sessionId === j.session)) || null;
}

/**
 * @param {Record<string,object>} prev tracked jobs of the last tick
 * @param {Map<string,object>} jobs this tick's jobs
 * @param {{diskBusy?:boolean, foreground?:Array<{startedAt:number, sessionId?:string, kind?:string}>}} ctx
 * @returns {Record<string,object>} tracked jobs (dead jobs dropped)
 */
function trackJobs(prev, jobs, now, cfg, ctx = {}) {
  const th = cfg.heavy;
  const out = {};
  for (const j of jobs.values()) {
    const p = (prev && prev[j.id]) || { firstSeen: now, overSince: null, lastOver: null, heavySince: null, res: [], peakMB: 0, gpu: false };
    // "Heavy" is measured on CPU, GPU and disk; RAM only says which pressure the job feeds.
    const loads = loadedResources(j, th, { diskBusy: ctx.diskBusy !== false });
    const over = loads.some((r) => r !== 'ram');
    let overSince = p.overSince;
    let lastOver = p.lastOver;
    if (over) { overSince = overSince ?? now; lastOver = now; } else if (lastOver === null || now - lastOver > th.dipMs) overSince = null;
    const heavyNow = overSince !== null && now - overSince >= th.sustainMs;
    const heavySince = p.heavySince ?? (heavyNow ? now : null);
    const res = Array.from(new Set([...(p.res || []), ...(heavySince !== null ? loads : [])]));
    const gpu = p.gpu || (heavySince !== null && (j.gpuPct || 0) > th.gpuPct);
    const fg = foregroundOf(j, ctx.foreground);
    let kind = 'build';
    // An app the user interacts with (owns the foreground window, or a non-headless browser/IDE/chat
    // process) that Claude happened to launch is the user's now: never throttled.
    if (ctx.userPids && j.pids.some((x) => ctx.userPids.has(x.pid))) kind = 'user-app';
    else if (j.listening) kind = 'server';
    else if (fg) kind = 'foreground';
    else if (heavySince !== null && now - heavySince >= th.generatorMs) kind = 'generator';
    out[j.id] = {
      ...p, id: j.id, rootPid: j.rootPid, startMs: j.startMs, name: j.name, cmd: j.cmd, session: j.session, pids: j.pids,
      cpuPct: j.cpuPct, gpuPct: j.gpuPct, ioBps: j.ioBps, iops: j.iops, memMB: j.memMB,
      overSince, lastOver, heavySince, heavy: heavySince !== null, res, gpu, kind,
      cmdKind: p.cmdKind || (fg && fg.kind) || null,
      peakMB: Math.max(p.peakMB || 0, j.memMB || 0),
    };
  }
  return out;
}

/** Highest level a job may reach: only CPU generators are paused; a user-app is never touched. */
function maxLevel(job) {
  if (job.kind === 'user-app') return LEVEL.NONE;
  return job.kind === 'generator' && !job.gpu ? LEVEL.PAUSE : LEVEL.CAP;
}

// ---------------------------------------------------------------------------
// Foreign priority
// ---------------------------------------------------------------------------

/**
 * @param {{apps?:object}} prev
 * @param {Array<object>} foreign foreign processes with cpuPct/gpuPct/ioBps/path/name
 * @param {object} ctx { cfg, libraryRoots, libraryDirs, libraryExes:Set, learned:{key:{resources}}, manual,
 *   foreground:{pid, fullscreen, idleMs}|null, noLearn:Set(lower names), diskPressed:boolean,
 *   sysUse?:{cpu, gpu} smoothed system usage % — measured load of an unknown app earns priority only at or
 *   above foreign.contendPct (absent = contended) }
 * @returns {{apps:object, active:Record<string,string>, all:boolean, allBy:string|null, newlyLearned:Array}}
 */
function updatePriority(prev, foreign, now, ctx) {
  const cfg = ctx.cfg;
  const f = cfg.foreign;
  const th = { cpuPct: f.cpuPct, gpuPct: f.gpuPct, diskBps: f.diskBps, diskOps: f.diskOps, ramMB: Infinity };
  const prevApps = (prev && prev.apps) || {};
  const learned = ctx.learned || {};
  const libExes = ctx.libraryExes || new Set();
  const libPrefixes = [...(ctx.libraryRoots || []), ...(ctx.libraryDirs || [])].map((r) => lowerSlash(r).replace(/\\+$/, '') + '\\');
  const noLearn = ctx.noLearn || new Set();
  const fgPid = ctx.foreground && ctx.foreground.pid;
  const interactive = Boolean(fgPid && ctx.foreground.idleMs !== undefined && ctx.foreground.idleMs < f.interactiveIdleMs);
  const sysUse = ctx.sysUse || {};
  const contended = (r) => r === 'disk' || !Number.isFinite(sysUse[r]) || sysUse[r] >= f.contendPct;
  const apps = {};
  const newlyLearned = [];
  const seen = new Map();
  for (const p of foreign) {
    const key = appKey(p.path, ctx.libraryRoots, ctx.libraryDirs) || String(p.name || '').toLowerCase();
    if (!key || listed(cfg.neverPriority, key, p.name)) continue;
    const a = seen.get(key) || { key, cpuPct: 0, gpuPct: 0, ioBps: 0, iops: 0, pids: [], name: p.name, launcher: false, library: false, runtime: false };
    const lname = String(p.name || '').toLowerCase();
    a.cpuPct += p.cpuPct || 0;
    a.gpuPct = Math.max(a.gpuPct, p.gpuPct || 0);
    a.ioBps += p.ioBps || 0;
    a.iops += p.iops || 0;
    a.pids.push(p.pid);
    a.launcher = a.launcher || NO_LEARN.has(lname) || noLearn.has(lname) || isBackgroundTool(key, lname) || listed(cfg.noLearn, key, p.name);
    a.runtime = a.runtime || RUNTIMES.has(lname);
    if (!NO_LEARN.has(lname)) a.library = a.library || libPrefixes.some((r) => lowerSlash(p.path).startsWith(r)) || libExes.has(lowerSlash(p.path));
    seen.set(key, a);
  }
  for (const a of seen.values()) {
    const old = prevApps[a.key] || { res: {}, gpuSince: null, lastGpu: null };
    const res = { ...old.res };
    // Disk IO counters include network transfers: disk earns priority only while the disk is actually pressed.
    const loads = loadedResources(a, th, { ram: false, diskBusy: Boolean(ctx.diskPressed) });
    const isFg = Boolean(fgPid && a.pids.includes(fgPid));
    const always = listed(cfg.alwaysPriority, a.key, a.name);
    const known = (a.library || learned[a.key]) && !a.launcher;
    // Measured load of an unknown app counts only while it owns the foreground window and that resource
    // is contended — never for background apps, browsers, chat/IDE hosts, background tools or script
    // runtimes: their load counts toward the 80 % budget instead.
    if (known || (!a.launcher && !a.runtime && isFg)) for (const r of loads) if (known || contended(r)) res[r] = now;
    // Library / learned apps: priority while in the foreground (plus measured load, which decays like any app's).
    if (known && isFg) for (const r of (learned[a.key] && learned[a.key].resources) || PRIORITY_TRIGGERS) res[r] = now;
    if (always) for (const r of PRIORITY_TRIGGERS) res[r] = now;
    // Learning: only a foreground app with GPU load (3D); never launchers, browsers, IDEs or Claude-driven services.
    const canLearn = !known && !always && !a.launcher && !a.runtime && isFg && loads.includes('gpu');
    let gpuSince = old.gpuSince;
    let lastGpu = old.lastGpu;
    if (canLearn) { gpuSince = gpuSince ?? now; lastGpu = now; } else if (lastGpu === null || now - lastGpu > 5000) gpuSince = null;
    const learnAfter = ctx.foreground && ctx.foreground.fullscreen ? f.learnFullscreenMs : f.learnMs;
    let isLearned = Boolean(old.learned);
    if (!isLearned && !known && gpuSince !== null && now - gpuSince >= learnAfter) {
      newlyLearned.push({ key: a.key, name: appLabel(a.key), resources: [...PRIORITY_TRIGGERS], learnedAt: now });
      isLearned = true;
    }
    apps[a.key] = { key: a.key, name: a.name, res, gpuSince, lastGpu, running: true, learned: isLearned, pids: a.pids };
  }
  // Apps that stopped keep their per-resource timestamps until they decay.
  for (const [key, old] of Object.entries(prevApps)) {
    if (apps[key] || listed(cfg.neverPriority, key, old.name)) continue;
    if (Object.values(old.res || {}).some((t) => now - t < f.decayMs)) apps[key] = { ...old, running: false, pids: [], gpuSince: null };
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
  if (!all && interactive) {
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
 * Disk over budget: a DRAM-less NVMe sits near 100 % active time while still responsive, so active
 * time alone never trips it. Over when active >= diskActivePct AND the disk is slow (latency >
 * diskLatencyMs OR queue > diskQueue); ok again once active < diskReleasePct or latency and queue
 * are both below half their thresholds. Without any latency/queue reading, active time decides alone.
 */
function diskOver(was, m, b) {
  if (!Number.isFinite(m.disk)) return false;
  const lat = m.diskMs;
  const q = m.diskQueue;
  const measured = Number.isFinite(lat) || Number.isFinite(q);
  if (!was) return m.disk >= b.diskActivePct && (!measured || lat > b.diskLatencyMs || q > b.diskQueue);
  if (m.disk < b.diskReleasePct) return false;
  return !measured || lat >= b.diskLatencyMs / 2 || q >= b.diskQueue / 2;
}

/**
 * @param {object} prev { window, over }
 * @param {{cpuPct, gpuPct, diskBusyPct, diskMs, diskQueue, totalMB, freeMB, pagesPerSec}} sys
 * CPU/GPU: 80/65 over smoothMs. Disk (busiest physical disk, Task Manager's "Active time") over
 * diskSmoothMs, see diskOver. RAM: free-memory floor over smoothMs, paging over ramSmoothMs (a
 * paging spike never flips RAM over/ok).
 */
function updateBudget(prev, sys, now, cfg) {
  const b = cfg.budget;
  const diskMs = Number.isFinite(sys.diskMs) && sys.diskMs >= 0 && sys.diskMs < 10000 ? sys.diskMs : NaN; // counter wrap → ignore
  const diskWin = b.diskSmoothMs || b.smoothMs;
  const ramWin = b.ramSmoothMs || b.smoothMs;
  const keep = Math.max(b.smoothMs, diskWin, ramWin);
  const entry = {
    ts: now, cpuPct: sys.cpuPct, gpuPct: sys.gpuPct, diskBusyPct: sys.diskBusyPct, diskMs, diskQueue: sys.diskQueue,
    freeMB: sys.freeMB, totalMB: sys.totalMB, pagesPerSec: sys.pagesPerSec,
  };
  const window = [...((prev && prev.window) || []), entry].filter((s) => now - s.ts <= keep);
  const avg = (k, ms) => mean(window.filter((s) => now - s.ts <= ms).map((s) => s[k]));
  const wasOver = (prev && prev.over) || {};
  const ratio = b.lowPct / b.highPct;
  const m = {
    cpu: avg('cpuPct', b.smoothMs),
    gpu: avg('gpuPct', b.smoothMs),
    disk: avg('diskBusyPct', diskWin),
    diskMs: avg('diskMs', diskWin),
    diskQueue: avg('diskQueue', diskWin),
    freeMB: avg('freeMB', b.smoothMs),
    totalMB: avg('totalMB', b.smoothMs),
    pages: avg('pagesPerSec', ramWin),
  };
  const hyst = (was, v) => (Number.isFinite(v) ? (was ? v > b.lowPct : v > b.highPct) : false);
  const over = { cpu: hyst(wasOver.cpu, m.cpu), gpu: hyst(wasOver.gpu, m.gpu), disk: diskOver(wasOver.disk, m, b), ram: false };
  if (Number.isFinite(m.freeMB) && Number.isFinite(m.totalMB) && m.totalMB > 0) {
    const need = Math.max(m.totalMB * b.ramFreePct / 100, b.ramFreeMB);
    const paging = Number.isFinite(m.pages) && m.pages > b.pagingPerSec;
    over.ram = wasOver.ram ? (m.freeMB < need / ratio || paging) : (m.freeMB < need || paging);
  }
  return { window, over, mean: m };
}

// ---------------------------------------------------------------------------
// Step controller
// ---------------------------------------------------------------------------

/**
 * Desired throttle level per job. Priority resources: every heavy job loading
 * them yields at once to its max level. Over-budget only: one step per
 * escalateMs, newest heavy job first. Relief: each throttled job on its own
 * steps down one level once none of its resources was pressed and the job was
 * not changed for relaxMs (last.touched[id]) — per job, so a resource pressed
 * elsewhere or a new throttle on another job never holds every other cap.
 * @returns {{desired:Record<string,{level:number, resources:string[]}>, last:object}}
 */
function plan(jobs, current, pressure, now, cfg, last = {}) {
  const prio = new Set(pressure.priority || []);
  const over = new Set(pressure.over || []);
  const pressured = new Set([...prio, ...over]);
  const desired = {};
  for (const [id, t] of Object.entries(current || {})) if (jobs[id] && maxLevel(jobs[id]) > 0) desired[id] = { level: Math.min(t.level, maxLevel(jobs[id])), resources: [...(t.resources || [])] };
  const next = { escalateAt: last.escalateAt ?? -Infinity, touched: {} };
  const seen = last.touched || {};
  const heavy = Object.values(jobs).filter((j) => j.heavy).sort((a, b) => (b.heavySince - a.heavySince) || (b.startMs - a.startMs));
  const hits = (j, set) => (j.res || []).filter((r) => set.has(r));
  const changed = new Set();
  for (const j of heavy) {
    const r = hits(j, prio);
    if (!r.length) continue;
    const cur = desired[j.id] || { level: 0, resources: [] };
    const target = maxLevel(j);
    if (!target) continue;
    if (cur.level < target) changed.add(j.id);
    desired[j.id] = { level: Math.max(cur.level, target), resources: Array.from(new Set([...cur.resources, ...r])) };
  }
  if (over.size && now - next.escalateAt >= cfg.budget.escalateMs) {
    const j = heavy.find((x) => hits(x, over).length && (desired[x.id]?.level || 0) < maxLevel(x));
    if (j) {
      const cur = desired[j.id] || { level: 0, resources: [] };
      desired[j.id] = { level: cur.level + 1, resources: Array.from(new Set([...cur.resources, ...hits(j, over)])) };
      next.escalateAt = now;
      changed.add(j.id);
    }
  }
  for (const [id, t] of Object.entries(desired)) {
    const since = seen[id];
    if (changed.has(id) || t.resources.some((r) => pressured.has(r)) || !Number.isFinite(since)) next.touched[id] = now;
    else if (now - since >= cfg.budget.relaxMs) { desired[id] = { ...t, level: t.level - 1 }; next.touched[id] = now; }
    else next.touched[id] = since;
  }
  for (const id of Object.keys(desired)) if (desired[id].level <= 0) { delete desired[id]; delete next.touched[id]; }
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
// Culprits (who presses a resource) — for the gate message, `governor wait` and the hog toast
// ---------------------------------------------------------------------------

const LABEL = Object.freeze({ cpu: 'CPU', gpu: 'GPU', disk: 'disk', ram: 'RAM' });
function fmtMB(mb) { return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`; }

/**
 * The dominant consumer of each given resource. A resource under priority names the app that has
 * it; otherwise processes are grouped by class + exe name (Claude's own jobs included, named with
 * their class): cpu = summed CPU %, gpu = highest GPU %, disk = summed IO operations/s, ram =
 * summed working set. The governor itself is skipped.
 * @param {Map<number,string>} classes pid → class
 * @param {Record<string,string>} [prioActive] resource → app key with priority
 * @returns {Record<string,{name:string, cls:string, value:number, text:string}>}
 */
function culprits(procs, classes, resources, prioActive = {}) {
  const groups = new Map();
  for (const p of procs || []) {
    const cls = (classes && classes.get(p.pid)) || 'foreign';
    if (cls === 'self' || p.pid === 0 || /^(system )?idle( process)?$/i.test(p.name || '')) continue; // the idle process is no consumer
    const k = `${cls}|${String(p.name || '?').toLowerCase()}`;
    const g = groups.get(k) || { name: p.name || '?', cls, cpu: 0, gpu: 0, disk: 0, diskBps: 0, ram: 0 };
    g.cpu += p.cpuPct || 0;
    g.gpu = Math.max(g.gpu, p.gpuPct || 0);
    g.disk += p.iops || 0;
    g.diskBps += p.ioBps || 0;
    g.ram += p.memMB || 0;
    groups.set(k, g);
  }
  const out = {};
  for (const r of resources || []) {
    if (prioActive && prioActive[r]) {
      const name = prioActive[r] === 'manual' ? 'manual priority switch' : appLabel(prioActive[r]);
      out[r] = { name, cls: 'priority', value: 0, text: `${LABEL[r] || r}: ${name} has priority` };
      continue;
    }
    let top = null;
    for (const g of groups.values()) if (g[r] > 0 && (!top || g[r] > top[r])) top = g;
    if (!top) continue;
    const v = top[r];
    const val = r === 'ram' ? fmtMB(v) : r === 'disk' ? `${Math.round(v)} IO/s, ${Math.round(top.diskBps / 1048576)} MB/s` : `${Math.round(v)} %`;
    const who = top.cls === 'foreign' ? top.name : `${top.name} (${top.cls})`;
    out[r] = { name: top.name, cls: top.cls, value: Math.round(v * 10) / 10, text: `${LABEL[r] || r}: ${who} ${val}` };
  }
  return out;
}

/**
 * A foreign app worth a toast: the dominant consumer of a resource over budget and itself past a
 * clear bar — CPU/GPU >= 2x the foreign noticeable-load threshold, disk >= foreign.diskOps IO/s,
 * RAM >= 20 % of physical memory.
 */
function isHog(c, r, cfg, totalMB) {
  if (!c || c.cls !== 'foreign') return false;
  const f = cfg.foreign;
  if (r === 'cpu') return c.value >= f.cpuPct * 2;
  if (r === 'gpu') return c.value >= f.gpuPct * 2;
  if (r === 'disk') return c.value >= f.diskOps;
  if (r === 'ram') return Number.isFinite(totalMB) && totalMB > 0 && c.value >= totalMB * 0.2;
  return false;
}

/** What a deferred command waits for: each pressed resource with its culprit (state.culprit), else the reason. */
function pressedText(res, state) {
  const cul = (state && state.culprit) || {};
  const parts = ((res && res.pressed) || []).map((r) => (cul[r] && cul[r].text) || LABEL[r] || r);
  return parts.length ? parts.join('; ') : String((res && res.reason) || '');
}

// ---------------------------------------------------------------------------
// Commands (PreToolUse)
// ---------------------------------------------------------------------------

/** Leading-command token lists of each `;` `&&` `||` `|` `&` / newline segment; quotes and heredoc bodies removed. */
function commandSegments(cmd) {
  let s = String(cmd || '');
  s = s.replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '\n');
  s = s.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');
  const out = [];
  for (const seg of s.split(/\|\||&&|[;|&\n]/)) {
    const t = seg.replace(/^[\s({]+|\$\(/g, ' ').trim().split(/\s+/).filter(Boolean);
    while (t.length && (/^[A-Za-z_]\w*=/.test(t[0]) || ['time', 'exec', 'command', 'env', 'sudo', 'npx', 'bunx', 'pnpx'].includes(t[0].toLowerCase()))) t.shift();
    if (t.length) out.push(t);
  }
  return out;
}

const progOf = (tok) => String(tok).split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
const INFO_FLAGS = new Set(['-version', '--version', '-h', '--help', '-help', 'help', 'version']);
// `-v` means "version" only for these; elsewhere (cargo, ffmpeg, make …) it is verbose/loglevel.
const V_IS_VERSION = new Set(['node', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'python', 'python3', 'py', 'java', 'go']);
const SCRIPT_SUBS = ['test', 'build', 'ci', 'install', 'i', 'rebuild', 'e2e'];

/** Process names that mark a Claude-launched job as the user's interactive app (unless headless). */
function isUserAppProc(p) {
  return NO_LEARN.has(String(p.name || '').toLowerCase()) && !/--headless/.test(String(p.cmd || ''));
}

/** One segment → {kind, gpu, heavy} or null. heavy = generators/containers; builds and tests are not. */
function heavySegment(t) {
  const prog = progOf(t[0]);
  const a1 = (t[1] || '').toLowerCase();
  const a2 = (t[2] || '').toLowerCase();
  const info = t.slice(1).some((x) => INFO_FLAGS.has(x.toLowerCase()) || (x === '-v' && V_IS_VERSION.has(prog)));
  if (info) return null;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) {
    const sub = a1 === 'run' ? a2 : a1;
    const base = sub.split(':')[0]; // npm run test:unit / build:prod
    return SCRIPT_SUBS.includes(base) ? { kind: `${prog} ${base}` } : null;
  }
  if (['vitest', 'jest', 'mocha', 'playwright', 'cypress', 'tsc', 'webpack', 'turbo', 'nx', 'pytest', 'tox', 'nox', 'make', 'ninja', 'msbuild', 'bazel'].includes(prog)) return { kind: prog };
  if ((prog === 'vite' || prog === 'next') && a1 === 'build') return { kind: `${prog} build` };
  if (prog === 'cmake' && t.includes('--build')) return { kind: 'cmake' };
  if (['cargo', 'go', 'dotnet', 'mvn', 'mvnw', 'gradle', 'gradlew', 'swift', 'zig'].includes(prog)
    && ['build', 'test', 'run', 'install', 'publish', 'bench', 'package', 'verify', 'compile'].includes(a1)) return { kind: `${prog} ${a1}` };
  if (prog === 'docker' && (['build', 'run', 'buildx'].includes(a1) || (a1 === 'compose' && ['up', 'build'].includes(a2)))) return { kind: 'docker', heavy: true };
  if (prog === 'docker-compose' && ['up', 'build'].includes(a1)) return { kind: 'docker', heavy: true };
  if (['ffmpeg', 'blender', 'handbrakecli', 'whisper', 'llama-cli'].includes(prog) && t.length > 1) return { kind: prog, gpu: true, heavy: true };
  if (prog === 'ollama' && ['run', 'pull', 'create'].includes(a1)) return { kind: 'ollama', gpu: true, heavy: true };
  if (/^(python3?|py)$/.test(prog) && /(train|finetune|fine_tune|render|generate|benchmark)/i.test(t[1] || '')) return { kind: 'python generator', gpu: true, heavy: true };
  return null;
}

const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd']);

function escapeSegment(t) {
  const prog = progOf(t[0]);
  if (prog === 'wsl') {
    // A workload (`wsl -e make`, `wsl make`, `wsl -- npm test`), not management (`wsl --list`, `--shutdown`).
    for (let i = 1; i < t.length; i++) {
      const a = t[i].toLowerCase();
      if (a === '-e' || a === '--exec' || a === '--') return true;
      if (WSL_VALUE_FLAGS.has(a)) { i++; continue; }
      if (!a.startsWith('-')) return true;
    }
    return false;
  }
  if (prog === 'schtasks') return t.some((x) => /^[/-](create|run)$/i.test(x));
  if (prog === 'systemd-run') return true;
  if (prog === 'sc' && (t[1] || '').toLowerCase() === 'create') return true;
  return prog === 'start-process' && t.some((x) => /^-verb$/i.test(x));
}

/**
 * @returns {{kind:string|null, escape:boolean, resources:string[]}} resources the command would load
 */
// Shell wrappers whose quoted argument is itself a command line: bash -c "…", cmd /c "…", pwsh -Command "…".
const WRAPPER = /(?:^|[\s;&|(])(?:bash|sh|zsh|cmd|pwsh|powershell)(?:\.exe)?\s+(?:-l\s+|-NoProfile\s+|-NonInteractive\s+)*(?:-c|\/c|-Command)\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/gi;

function innerCommands(cmd, depth = 0) {
  const out = [];
  if (depth > 2) return out;
  // matchAll clones the regex: the recursion cannot reset the outer scan (a shared lastIndex looped forever).
  for (const m of String(cmd || '').matchAll(WRAPPER)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? '';
    if (inner) out.push(inner, ...innerCommands(inner, depth + 1));
  }
  return out;
}

function classifyCommand(cmd) {
  let hit = null;
  let escape = false;
  for (const line of [cmd, ...innerCommands(cmd)]) {
    for (const t of commandSegments(line)) {
      if (!hit) hit = heavySegment(t);
      escape = escape || escapeSegment(t);
    }
  }
  const resources = hit ? (hit.gpu ? ['cpu', 'gpu', 'disk', 'ram'] : ['cpu', 'disk', 'ram']) : escape ? [...RESOURCES] : [];
  return { kind: hit ? hit.kind : null, heavy: Boolean(hit && hit.heavy), escape, resources };
}

function commandKind(cmd) { return classifyCommand(cmd).kind; }

/**
 * Admission. Fail open: no or stale watcher state → allow. Generators, containers
 * and escapes defer while a resource they load is pressed; builds, tests and
 * browser checks never wait for pressure (the watcher caps them only if they
 * turn heavy). Any known kind defers when free RAM < expected + headroom.
 * @returns {{decision:'allow'|'defer', reason:string, kind:string|null, resources:string[]}}
 */
function admit({ command, now, state, kinds = {}, cfg }) {
  const c = classifyCommand(command);
  const base = { kind: c.kind, resources: c.resources };
  if (!c.kind && !c.escape) return { decision: 'allow', reason: 'light', ...base };
  const hb = state && Number.isFinite(state.heartbeat) ? state.heartbeat : null;
  if (hb === null || now - hb >= cfg.admission.staleMs) return { decision: 'allow', reason: 'watcher-absent', ...base };
  const p = state.pressure || {};
  const pressed = !(c.heavy || c.escape) ? [] : c.resources.filter((r) => (p.priority || []).includes(r) || (p.over || []).includes(r));
  if (pressed.length) {
    const byPrio = pressed.some((r) => (p.priority || []).includes(r));
    return { decision: 'defer', reason: byPrio ? `priority:${state.priorityBy || 'app'}` : `budget:${pressed.join(',')}`, pressed, ...base };
  }
  if (!c.kind) return { decision: 'allow', reason: 'escape-no-pressure', ...base };
  const expected = (kinds[c.kind] && kinds[c.kind].peakMB) || cfg.admission.defaultMB;
  const free = state.sys && Number.isFinite(state.sys.freeMB) ? state.sys.freeMB : Infinity;
  if (free < expected + cfg.admission.headroomMB) return { decision: 'defer', reason: 'ram', pressed: ['ram'], ...base };
  return { decision: 'allow', reason: 'slot', ...base };
}

module.exports = {
  RESOURCES, PRIORITY_TRIGGERS, LEVEL, WIN_OS_NAMES, NO_LEARN, RUNTIMES, BACKGROUND,
  isOsProcess, appKey, appLabel, listed, isBackgroundTool,
  isClaudeRoot, isClaudeDesktop, attributedPids, hostKeys, hostPids, sessionMap, isInfra, classify, activeServiceNames, serviceNames, groupJobs,
  loadedResources, trackJobs, maxLevel, isUserAppProc,
  updatePriority, updateBudget, diskOver, plan, pressureOf, culprits, isHog, pressedText,
  commandSegments, classifyCommand, commandKind, admit,
};
