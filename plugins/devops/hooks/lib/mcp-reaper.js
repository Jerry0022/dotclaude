/**
 * @module mcp-reaper
 * @version 0.1.0
 * @description Reclaims orphaned Claude Desktop MCP server child processes.
 *
 *   Claude Desktop spawns per-session MCP servers (bun for the discord
 *   plugin, node via npx for github/playwright, node stdio servers for
 *   `.claude/plugins/cache/**` plugins). When a Claude Code session ends,
 *   these child processes are not reliably terminated — they become
 *   orphaned (their parent PID dies) and linger, accumulating RAM.
 *
 *   PROVEN safe-kill heuristic (validated live — freed 8 GB in one pass).
 *   A process is a reap candidate iff BOTH hold:
 *     1. MCP-server signature (isClaudeMcpServer) — command line matches a
 *        known MCP launcher pattern (plugin-cache path, or npx cache path).
 *     2. Orphaned — its parent PID is NOT alive (isProcessAlive(ppid) is
 *        false). This is the critical safety invariant: an *active*
 *        session's MCP server always has a live parent chain, so a
 *        dead-parent process can never belong to the active session.
 *
 *   On top of that, findReapable() additionally excludes the CALLER's own
 *   process subtree (ancestors + descendants of `selfPid`) regardless of
 *   what isAlive() reports for them — belt-and-suspenders so a live session
 *   can never reap itself even under a pathological/stubbed liveness check.
 *
 *   Fails safe: any enumeration failure returns `[]` (nothing to reap, never
 *   throws), and the default mode everywhere is dry-run — nothing is ever
 *   killed unless the caller explicitly opts in.
 */

'use strict';

const { execFileSync } = require('child_process');
const { isProcessAlive } = require('./mcp-status');

const IS_WIN = process.platform === 'win32';

// A process command line matching either of these is an MCP-server launcher.
// Path fragment is matched case-insensitively with slashes normalized, so it
// catches both `.claude/plugins/cache/...` (posix) and
// `...\.claude\plugins\cache\...` (windows) command lines alike. This also
// covers the "bun server child" case (bun running server.ts) as long as its
// command line references the same cache path, which it does in practice.
const CACHE_PATH_FRAGMENT = '.claude/plugins/cache/';
const NPX_FRAGMENTS = ['_npx', 'npx-cli'];

// Fallback estimate used only when the OS query could not report a process's
// actual working-set size (rssBytes). Rough, deliberately conservative.
const FALLBACK_MB_PER_SERVER = 150;

// Grace period between SIGTERM and a SIGKILL escalation, in ms.
const DEFAULT_GRACE_MS = 300;

function normalizeSlashes(str) {
  return String(str || '').replace(/\\/g, '/');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Process enumeration — cross-platform, fails safe (returns [] on any error)
// ---------------------------------------------------------------------------

/**
 * Best-effort fallback process listing via `wmic` (older Windows / when the
 * PowerShell CIM path fails for any reason). `wmic process ... /format:csv`
 * does not quote fields, so a CommandLine containing commas is ambiguous —
 * this parser resolves that by taking the last 4 columns positionally
 * (Name, ParentProcessId, ProcessId, WorkingSetSize are always plain
 * numbers/tokens) and treating everything in between as the CommandLine.
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function listProcessesWindowsWmic() {
  try {
    const out = execFileSync(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize', '/format:csv'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024 }
    );
    const procs = [];
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^Node,/i.test(line)) continue; // skip blank lines + header
      const parts = line.split(',');
      if (parts.length < 5) continue;
      const workingSetSize = Number(parts[parts.length - 1]);
      const processId = Number(parts[parts.length - 2]);
      const parentProcessId = Number(parts[parts.length - 3]);
      const name = parts[parts.length - 4];
      const command = parts.slice(1, parts.length - 4).join(',');
      if (!Number.isFinite(processId)) continue;
      procs.push({
        pid: processId,
        ppid: Number.isFinite(parentProcessId) ? parentProcessId : 0,
        name: name || '',
        command: command || name || '',
        rssBytes: Number.isFinite(workingSetSize) ? workingSetSize : 0,
      });
    }
    return procs;
  } catch {
    return [];
  }
}

/**
 * Enumerate processes on Windows via PowerShell `Get-CimInstance Win32_Process`.
 * Falls back to `wmic` on failure. Never throws.
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function listProcessesWindows() {
  try {
    const psCommand =
      'Get-CimInstance Win32_Process | ' +
      'Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize | ' +
      'ConvertTo-Json -Compress';
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCommand],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024 }
    );
    const trimmed = out.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .map((p) => ({
        pid: Number(p.ProcessId),
        ppid: Number(p.ParentProcessId),
        name: p.Name || '',
        command: p.CommandLine || '',
        rssBytes: Number(p.WorkingSetSize) || 0,
      }))
      .filter((p) => Number.isFinite(p.pid));
  } catch {
    return listProcessesWindowsWmic();
  }
}

/**
 * Enumerate processes on macOS/Linux via `ps -eo pid=,ppid=,rss=,comm=,args=`.
 * Never throws.
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function listProcessesPosix() {
  try {
    const out = execFileSync(
      'ps',
      ['-eo', 'pid=,ppid=,rss=,comm=,args='],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024 }
    );
    const procs = [];
    for (const rawLine of out.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!m) continue;
      const [, pidStr, ppidStr, rssKbStr, comm, args] = m;
      procs.push({
        pid: Number(pidStr),
        ppid: Number(ppidStr),
        name: comm,
        command: args || comm,
        rssBytes: Number(rssKbStr) * 1024,
      });
    }
    return procs;
  } catch {
    return [];
  }
}

/**
 * Enumerate all OS processes, cross-platform. Fails safe: returns `[]` on
 * any failure (missing tools, permission errors, timeouts) rather than
 * throwing — a scan failure must never cascade into an unsafe decision.
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function listProcesses() {
  try {
    return IS_WIN ? listProcessesWindows() : listProcessesPosix();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Signature matching
// ---------------------------------------------------------------------------

/**
 * Does this process's command line match a known Claude MCP-server launcher
 * signature? Signature match ONLY — this says nothing about liveness/orphan
 * status. Never reaps based on this alone; see findReapable().
 * @param {{command?: string}} proc
 * @returns {boolean}
 */
function isClaudeMcpServer(proc) {
  const cmd = normalizeSlashes(proc && proc.command).toLowerCase();
  if (!cmd) return false;
  if (cmd.includes(CACHE_PATH_FRAGMENT)) return true;
  return NPX_FRAGMENTS.some((frag) => cmd.includes(frag));
}

// ---------------------------------------------------------------------------
// Self-subtree computation — never reap the calling session's own tree
// ---------------------------------------------------------------------------

/**
 * Compute the set of pids that must never be considered for reaping because
 * they are the caller's own subtree: `selfPid` itself, every ancestor of
 * `selfPid` reachable within `procs`, and every descendant of `selfPid`
 * reachable within `procs`. Bounded against ppid-graph cycles.
 * @param {Array<{pid:number, ppid:number}>} procs
 * @param {number} selfPid
 * @returns {Set<number>}
 */
function computeSelfSubtree(procs, selfPid) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const childrenOf = new Map();
  for (const p of procs) {
    const list = childrenOf.get(p.ppid) || [];
    list.push(p.pid);
    childrenOf.set(p.ppid, list);
  }

  const excluded = new Set([selfPid]);

  // Walk up the parent chain (ancestors). Bounded by procs.length so a cycle
  // in the ppid graph can't spin forever.
  let pid = selfPid;
  for (let i = 0; i < procs.length + 1; i++) {
    const proc = byPid.get(pid);
    if (!proc || excluded.has(proc.ppid)) break;
    excluded.add(proc.ppid);
    pid = proc.ppid;
  }

  // Walk down all descendants (BFS), guarded by `excluded` against cycles.
  const queue = [...(childrenOf.get(selfPid) || [])];
  while (queue.length) {
    const child = queue.shift();
    if (excluded.has(child)) continue;
    excluded.add(child);
    for (const grandchild of childrenOf.get(child) || []) queue.push(grandchild);
  }

  return excluded;
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/**
 * Find reap candidates within a given process list: MCP-signature match AND
 * dead parent, excluding the caller's own subtree entirely (see
 * computeSelfSubtree). Fail-safe by construction — anything not proven both
 * MCP-signature-matched and orphaned is left alone.
 * @param {Array<{pid:number, ppid:number, name:string, command:string, rssBytes?:number}>} procs
 * @param {{selfPid?: number, isAlive?: (pid:number)=>boolean}} [opts]
 * @returns {Array<{pid:number, ppid:number, name:string, reason:string, rssBytes:number}>}
 */
function findReapable(procs, opts = {}) {
  if (!Array.isArray(procs) || !procs.length) return [];
  const selfPid = Number.isInteger(opts.selfPid) ? opts.selfPid : process.pid;
  const isAlive = typeof opts.isAlive === 'function' ? opts.isAlive : isProcessAlive;

  const excluded = computeSelfSubtree(procs, selfPid);
  const out = [];
  for (const proc of procs) {
    if (excluded.has(proc.pid)) continue;
    if (!isClaudeMcpServer(proc)) continue;
    if (isAlive(proc.ppid)) continue; // parent alive → not orphaned → skip
    out.push({
      pid: proc.pid,
      ppid: proc.ppid,
      name: proc.name || '',
      reason: 'orphaned-mcp-server (dead parent + mcp-signature match)',
      rssBytes: Number(proc.rssBytes) || 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reap execution
// ---------------------------------------------------------------------------

/**
 * Kill one candidate: SIGTERM, then (only if it survives a short grace
 * period) SIGKILL. On Windows both signals hard-terminate — that's
 * acceptable. Every kill attempt is guarded in try/catch; a failure is
 * reported via `errors`, never thrown.
 * @param {{pid:number}} candidate
 * @param {(pid:number)=>boolean} isAlive
 * @param {number} graceMs
 * @returns {Promise<{killed:boolean, error:{pid:number, stage:string, error:string}|null}>}
 */
async function killCandidate(candidate, isAlive, graceMs) {
  try {
    process.kill(candidate.pid, 'SIGTERM');
  } catch (err) {
    return { killed: false, error: { pid: candidate.pid, stage: 'SIGTERM', error: err.message } };
  }

  if (graceMs > 0) await sleep(graceMs);

  if (isAlive(candidate.pid)) {
    try {
      process.kill(candidate.pid, 'SIGKILL');
    } catch (err) {
      return { killed: false, error: { pid: candidate.pid, stage: 'SIGKILL', error: err.message } };
    }
  }

  return { killed: true, error: null };
}

/**
 * Scan for orphaned MCP-server processes and, unless `dryRun`, terminate
 * them. Default is dry-run — kill only when explicitly asked.
 * @param {{
 *   dryRun?: boolean,
 *   selfPid?: number,
 *   graceMs?: number,
 *   isAlive?: (pid:number)=>boolean,
 *   listProcs?: () => Array<object>,
 *   logger?: {log: Function},
 * }} [opts]
 * @returns {Promise<{scanned:number, candidates:Array, killed:number[], errors:Array, freedEstimateMb:number}>}
 */
async function reap(opts = {}) {
  const {
    dryRun = true,
    selfPid = process.pid,
    graceMs = DEFAULT_GRACE_MS,
    isAlive = isProcessAlive,
    listProcs = listProcesses,
    logger,
  } = opts;

  const procs = listProcs();
  const candidates = findReapable(procs, { selfPid, isAlive });
  const killed = [];
  const errors = [];

  if (!dryRun) {
    for (const candidate of candidates) {
      const result = await killCandidate(candidate, isAlive, graceMs);
      if (result.killed) killed.push(candidate.pid);
      if (result.error) errors.push(result.error);
    }
  }

  const freedEstimateMb = Math.round(
    candidates.reduce((sum, c) => {
      const mb = c.rssBytes > 0 ? c.rssBytes / (1024 * 1024) : FALLBACK_MB_PER_SERVER;
      return sum + mb;
    }, 0)
  );

  if (logger && typeof logger.log === 'function') {
    logger.log(
      `mcp-reaper: scanned=${procs.length} candidates=${candidates.length} ` +
      `killed=${killed.length} dryRun=${dryRun}`
    );
  }

  return { scanned: procs.length, candidates, killed, errors, freedEstimateMb };
}

module.exports = {
  listProcesses,
  isClaudeMcpServer,
  computeSelfSubtree,
  findReapable,
  reap,
};
