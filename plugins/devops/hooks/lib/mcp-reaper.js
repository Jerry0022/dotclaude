/**
 * @module mcp-reaper
 * @version 0.2.0
 * @description Reclaims orphaned Claude Desktop MCP server child processes.
 *
 *   Claude Desktop spawns per-session MCP servers (bun for the discord
 *   plugin, node via npx for github/playwright, node stdio servers for
 *   `.claude/plugins/cache/**` plugins). When a Claude Code session ends,
 *   these child processes are not reliably terminated — they become
 *   orphaned (their parent PID dies) and linger, accumulating RAM.
 *
 *   WINDOWS ONLY. The dead-parent orphan signal only means anything on
 *   Windows: a Windows child process's ParentProcessId is a historical
 *   "creator PID" that is never rewritten once the parent exits, and
 *   Windows does not reparent orphans to any other process. On POSIX,
 *   orphaned children are reparented to a live PID 1 (init/systemd), so a
 *   dead-parent check would never fire and would be actively misleading if
 *   implemented naively. findReapable() therefore returns `[]` on any
 *   non-win32 platform — a documented no-op, not "not yet implemented".
 *
 *   A process is a reap candidate iff ALL of the following hold:
 *     1. MCP-server signature (isClaudeMcpServer) — command line matches a
 *        known MCP launcher pattern: a `.claude/plugins/cache/` path, or an
 *        npx-cache marker (`_npx`/`npx-cli`) COMBINED with the token `mcp`
 *        (so a bare `npx vite`/`npx tsx` never matches).
 *     2. Orphaned — its parent PID is NOT alive (isProcessAlive(ppid) is
 *        false).
 *     3. Outside the live-Claude census (liveClaudeExclusion) — NOT itself,
 *        and NOT a structural descendant (in the current process-table
 *        snapshot), of any currently-live process named `claude`/
 *        `claude.exe`, or whose command contains `claude-code`. This is the
 *        PRIMARY safety net: in real deployment the reaper runs as a
 *        hook/scheduled-task CHILD of `claude.exe`, so a live session's own
 *        MCP servers are typically COUSINS of the reaper (children of the
 *        same shared claude.exe), not its ancestors/descendants — a
 *        self-pid-only exclusion can never protect a cousin. Over-inclusion
 *        here (e.g. Desktop renderer processes) is intentional and safe.
 *        FAIL-SAFE GATE: if the census cannot be built (no live Claude-like
 *        process found anywhere in the snapshot) findReapable() returns
 *        `[]` unconditionally — an empty census means "protection unknown",
 *        never "nothing to protect".
 *     4. Outside the caller's own process subtree (computeSelfSubtree) — an
 *        ADDITIONAL, narrower belt on top of the census: protects the
 *        reaper's own direct ancestor/descendant chain even in the rare
 *        case where that chain isn't itself recognized as "claude-like" by
 *        the census's naming heuristics.
 *     5. Not the reaper's own running process (ownProcessSignature) —
 *        independent of `selfPid`: the reaper's own script, once installed,
 *        lives under `.claude/plugins/cache/**` and would otherwise
 *        self-match the MCP-cache signature.
 *
 *   TOCTOU: reap() re-validates every candidate against a FRESH process
 *   snapshot immediately before each SIGTERM and again before any SIGKILL
 *   escalation (revalidateCandidate). A pid that got reused for something
 *   else between the scan and the kill is skipped, never touched.
 *
 *   Fails safe end-to-end: any enumeration failure returns `[]` (nothing to
 *   reap, never throws), an unbuildable census refuses to produce
 *   candidates, a TOCTOU mismatch skips instead of killing, and the default
 *   mode everywhere is dry-run — nothing is ever killed unless the caller
 *   explicitly opts in.
 */

'use strict';

const { execFileSync } = require('child_process');
const { isProcessAlive } = require('./mcp-status');

const IS_WIN = process.platform === 'win32';

// A process command line matching either of these is an MCP-server launcher
// signature. Path fragment is matched case-insensitively with slashes
// normalized, so it catches both `.claude/plugins/cache/...` (posix) and
// `...\.claude\plugins\cache\...` (windows) command lines alike.
const CACHE_PATH_FRAGMENT = '.claude/plugins/cache/';
// An npx-cache marker ALONE is not enough (any `npx <tool>` would match) —
// it must be combined with the `mcp` token so bare dev-tool npx invocations
// (`npx vite`, `npx tsx`, ...) are never flagged.
const NPX_FRAGMENTS = ['_npx', 'npx-cli'];
const MCP_TOKEN = 'mcp';

// A currently-live process is considered a "live Claude root" for census
// purposes when its name is exactly one of these...
const CLAUDE_NAMES = new Set(['claude', 'claude.exe']);
// ...or its command line contains this substring (catches the CLI running
// under a generic `node`/`node.exe` process name).
const CLAUDE_COMMAND_FRAGMENT = 'claude-code';

// Fallback estimate used only when the OS query could not report a process's
// actual working-set size (rssBytes). Rough, deliberately conservative.
const FALLBACK_MB_PER_SERVER = 150;

// Grace period between SIGTERM and a SIGKILL escalation, in ms.
const DEFAULT_GRACE_MS = 300;

function normalizeSlashes(str) {
  return String(str || '').replace(/\\/g, '/');
}

function normalizedCommand(proc) {
  return normalizeSlashes(proc && proc.command).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Process enumeration — cross-platform, fails safe (returns [] on any error)
// ---------------------------------------------------------------------------

/**
 * Parse the raw stdout of the PowerShell `ConvertTo-Json` pipeline into a
 * normalized process list. Pure function (no process I/O) so the
 * "single result → object, not array" ConvertTo-Json quirk is directly
 * unit-testable without shelling out.
 * @param {string} jsonText
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function parseWin32ProcessJson(jsonText) {
  const trimmed = String(jsonText || '').trim();
  if (!trimmed) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  // ConvertTo-Json emits a bare object (not a 1-element array) when exactly
  // one result comes through the pipeline — normalize both shapes.
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
}

/**
 * Parse `wmic process ... /format:csv` output. `wmic` does not quote fields,
 * so a CommandLine containing commas is ambiguous — resolved by taking the
 * last 4 columns positionally (Name, ParentProcessId, ProcessId,
 * WorkingSetSize are always plain tokens/numbers) and treating everything
 * between the leading Node column and those 4 as the CommandLine, however
 * many embedded commas it contains. Pure function, unit-testable.
 * @param {string} csvText
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function parseWmicCsv(csvText) {
  const procs = [];
  for (const rawLine of String(csvText || '').split(/\r?\n/)) {
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
}

/**
 * Best-effort fallback process listing via `wmic` (older Windows / when the
 * PowerShell CIM path fails for any reason). Never throws.
 * @returns {Array<{pid:number, ppid:number, name:string, command:string, rssBytes:number}>}
 */
function listProcessesWindowsWmic() {
  try {
    const out = execFileSync(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize', '/format:csv'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 20 * 1024 * 1024 }
    );
    return parseWmicCsv(out);
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
    return parseWin32ProcessJson(out);
  } catch {
    return listProcessesWindowsWmic();
  }
}

/**
 * Enumerate processes on macOS/Linux via `ps -eo pid=,ppid=,rss=,comm=,args=`.
 * Never throws. NOTE: findReapable() ignores this platform's dead-parent
 * signal entirely (see module header) — this is kept for listProcesses()
 * completeness / potential future signature-only tooling, not for reaping.
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
 * status or census membership. Never reaps based on this alone; see
 * findReapable().
 * @param {{command?: string}} proc
 * @returns {boolean}
 */
function isClaudeMcpServer(proc) {
  const cmd = normalizedCommand(proc);
  if (!cmd) return false;
  if (cmd.includes(CACHE_PATH_FRAGMENT)) return true;
  const hasNpxMarker = NPX_FRAGMENTS.some((frag) => cmd.includes(frag));
  return hasNpxMarker && cmd.includes(MCP_TOKEN);
}

// ---------------------------------------------------------------------------
// Own-process guard (R7) — independent of selfPid
// ---------------------------------------------------------------------------

/**
 * Normalized signature of the currently-running script (process.argv[1]),
 * used to guarantee the reaper never flags its own process, independent of
 * whether `selfPid` was threaded through correctly. Matters because once
 * installed, the reaper's own script lives under `.claude/plugins/cache/**`
 * and would otherwise self-match isClaudeMcpServer().
 * @returns {string} normalized, lowercased path fragment (possibly empty)
 */
function ownProcessSignature() {
  const argvPath = process.argv && process.argv[1];
  return normalizeSlashes(argvPath).toLowerCase();
}

// ---------------------------------------------------------------------------
// Live-Claude census (R2/R3) — the primary safety net
// ---------------------------------------------------------------------------

function isLiveClaudeRoot(proc, isAlive) {
  if (!proc) return false;
  const name = String(proc.name || '').toLowerCase();
  const cmd = normalizedCommand(proc);
  const looksLikeClaude = CLAUDE_NAMES.has(name) || cmd.includes(CLAUDE_COMMAND_FRAGMENT);
  if (!looksLikeClaude) return false;
  return isAlive(proc.pid);
}

/**
 * Build the set of pids that belong to any LIVE Claude session: every live
 * process named `claude`/`claude.exe` or whose command contains
 * `claude-code`, PLUS the full descendant subtree of each (walking the ppid
 * graph within the current snapshot). This is the primary protection
 * against reaping a live session's own MCP servers — in real deployment
 * they are children of the shared `claude.exe` (Desktop) or the `claude`
 * CLI process, NOT of the reaper itself, so a self-pid-only exclusion is
 * not enough (see computeSelfSubtree for the additional, narrower belt).
 *
 * Over-inclusion is intentional and safe: Claude Desktop's renderer
 * processes and any other descendant also end up protected.
 *
 * @param {Array<{pid:number, ppid:number, name:string, command:string}>} procs
 * @param {(pid:number)=>boolean} isAlive
 * @returns {Set<number>} empty when no live Claude root was found. Callers
 *   MUST treat an empty result as "protection unknown, refuse to act",
 *   never as "nothing to protect" — see findReapable's fail-safe gate.
 */
function liveClaudeExclusion(procs, isAlive) {
  if (!Array.isArray(procs) || !procs.length) return new Set();

  const childrenOf = new Map();
  for (const p of procs) {
    const list = childrenOf.get(p.ppid) || [];
    list.push(p.pid);
    childrenOf.set(p.ppid, list);
  }

  const roots = procs.filter((p) => isLiveClaudeRoot(p, isAlive));
  const census = new Set();
  for (const root of roots) {
    if (census.has(root.pid)) continue;
    census.add(root.pid);
    const queue = [...(childrenOf.get(root.pid) || [])];
    while (queue.length) {
      const pid = queue.shift();
      if (census.has(pid)) continue;
      census.add(pid);
      for (const child of childrenOf.get(pid) || []) queue.push(child);
    }
  }
  return census;
}

// ---------------------------------------------------------------------------
// Self-subtree computation — additional belt on top of the census
// ---------------------------------------------------------------------------

/**
 * Compute the set of pids that must never be considered for reaping because
 * they are the caller's own subtree: `selfPid` itself, every ancestor of
 * `selfPid` reachable within `procs`, and every descendant of `selfPid`
 * reachable within `procs`. Bounded against ppid-graph cycles.
 *
 * This is an ADDITIONAL, narrower safety net on top of liveClaudeExclusion —
 * it protects the reaper's own direct lineage even in the (unlikely) case
 * that lineage isn't itself recognized as "claude-like" by the census's
 * naming heuristics.
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
 * Find reap candidates within a given process list. WINDOWS ONLY — returns
 * `[]` unconditionally on any other platform (see module header, R6).
 *
 * Applies, in order: the live-Claude census (with its own fail-safe gate),
 * the caller's self-subtree, the own-process guard, the MCP signature, and
 * the dead-parent check. Fail-safe by construction — anything not proven
 * signature-matched, orphaned, AND outside every protected set is left
 * alone.
 * @param {Array<{pid:number, ppid:number, name:string, command:string, rssBytes?:number}>} procs
 * @param {{selfPid?: number, isAlive?: (pid:number)=>boolean, platform?: string, ownSignature?: string}} [opts]
 * @returns {Array<{pid:number, ppid:number, name:string, reason:string, rssBytes:number}>}
 */
function findReapable(procs, opts = {}) {
  if (!Array.isArray(procs) || !procs.length) return [];

  const platform = opts.platform || process.platform;
  if (platform !== 'win32') return []; // R6: orphan detection is Windows-only

  const selfPid = Number.isInteger(opts.selfPid) ? opts.selfPid : process.pid;
  const isAlive = typeof opts.isAlive === 'function' ? opts.isAlive : isProcessAlive;
  const ownSig = normalizeSlashes(
    typeof opts.ownSignature === 'string' ? opts.ownSignature : ownProcessSignature()
  ).toLowerCase();

  const census = liveClaudeExclusion(procs, isAlive);
  if (census.size === 0) {
    // Fail-safe (R2): we could not prove ANY live Claude session exists to
    // protect. Refuse to produce candidates at all rather than risk having
    // excluded nothing. An empty census means "unknown", never "safe".
    return [];
  }

  const selfSubtree = computeSelfSubtree(procs, selfPid);

  const out = [];
  for (const proc of procs) {
    if (census.has(proc.pid) || selfSubtree.has(proc.pid)) continue;
    const cmd = normalizedCommand(proc);
    if (ownSig && cmd.includes(ownSig)) continue; // R7: never flag our own running script
    if (!isClaudeMcpServer(proc)) continue;
    if (isAlive(proc.ppid)) continue; // parent alive → not orphaned → skip
    out.push({
      pid: proc.pid,
      ppid: proc.ppid,
      name: proc.name || '',
      reason: 'orphaned-mcp-server (dead parent + mcp-signature match, outside live-Claude census)',
      rssBytes: Number(proc.rssBytes) || 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// TOCTOU re-validation (R4)
// ---------------------------------------------------------------------------

/**
 * Re-validate a single candidate pid against a FRESH process snapshot,
 * immediately before it is signaled. Re-runs every condition that made it a
 * candidate in the first place (signature, dead parent, census, self-
 * subtree, own-process) against current data — never trusts the snapshot
 * the original candidate list was built from. Called before both the
 * SIGTERM and the SIGKILL escalation so a pid reused for something else
 * between the scan and the kill is never touched.
 * @param {number} pid
 * @param {{listProcs: Function, isAlive: Function, selfPid: number, platform?: string, ownSignature?: string}} opts
 * @returns {{ok: boolean, reason?: string}}
 */
function revalidateCandidate(pid, opts) {
  const { listProcs, isAlive, selfPid, platform = process.platform, ownSignature } = opts;
  if (platform !== 'win32') return { ok: false, reason: 'non-windows' };

  const freshProcs = listProcs();
  if (!Array.isArray(freshProcs) || !freshProcs.length) {
    return { ok: false, reason: 'no-fresh-snapshot' };
  }

  const proc = freshProcs.find((p) => p.pid === pid);
  if (!proc) return { ok: false, reason: 'pid-not-found' };

  const ownSig = normalizeSlashes(
    typeof ownSignature === 'string' ? ownSignature : ownProcessSignature()
  ).toLowerCase();
  const cmd = normalizedCommand(proc);
  if (ownSig && cmd.includes(ownSig)) return { ok: false, reason: 'self-process' };

  if (!isClaudeMcpServer(proc)) return { ok: false, reason: 'signature-mismatch' };
  if (isAlive(proc.ppid)) return { ok: false, reason: 'parent-now-alive' };

  const census = liveClaudeExclusion(freshProcs, isAlive);
  if (census.size === 0) return { ok: false, reason: 'census-unbuildable' };
  if (census.has(pid)) return { ok: false, reason: 'now-in-live-claude-census' };

  const selfSubtree = computeSelfSubtree(freshProcs, selfPid);
  if (selfSubtree.has(pid)) return { ok: false, reason: 'now-in-self-subtree' };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reap execution
// ---------------------------------------------------------------------------

/**
 * Kill one candidate: TOCTOU re-check, then SIGTERM; if it survives a short
 * grace period, TOCTOU re-check again, then SIGKILL. On Windows both
 * signals hard-terminate — that's acceptable. Every kill attempt is guarded
 * in try/catch; a failure is reported via the returned `error`, never
 * thrown. A failed re-check reports via `skipped` and never signals.
 * @param {{pid:number}} candidate
 * @param {{isAlive:Function, graceMs:number, listProcs:Function, selfPid:number, platform?:string, ownSignature?:string}} opts
 * @returns {Promise<{killed:boolean, error:{pid:number, stage:string, error:string}|null, skipped:{pid:number, stage:string, reason:string}|null}>}
 */
async function killCandidate(candidate, opts) {
  const { isAlive, graceMs, listProcs, selfPid, platform, ownSignature } = opts;
  const revalOpts = { listProcs, isAlive, selfPid, platform, ownSignature };

  const preTerm = revalidateCandidate(candidate.pid, revalOpts);
  if (!preTerm.ok) {
    return { killed: false, error: null, skipped: { pid: candidate.pid, stage: 'pre-SIGTERM', reason: preTerm.reason } };
  }

  try {
    process.kill(candidate.pid, 'SIGTERM');
  } catch (err) {
    return { killed: false, error: { pid: candidate.pid, stage: 'SIGTERM', error: err.message }, skipped: null };
  }

  if (graceMs > 0) await sleep(graceMs);

  if (!isAlive(candidate.pid)) {
    return { killed: true, error: null, skipped: null };
  }

  const preKill = revalidateCandidate(candidate.pid, revalOpts);
  if (!preKill.ok) {
    return { killed: false, error: null, skipped: { pid: candidate.pid, stage: 'pre-SIGKILL', reason: preKill.reason } };
  }

  try {
    process.kill(candidate.pid, 'SIGKILL');
  } catch (err) {
    return { killed: false, error: { pid: candidate.pid, stage: 'SIGKILL', error: err.message }, skipped: null };
  }

  return { killed: true, error: null, skipped: null };
}

/**
 * Scan for orphaned MCP-server processes and, unless `dryRun`, terminate
 * them. Default is dry-run — kill only when explicitly asked. Windows only
 * (see findReapable / module header) — a no-op elsewhere.
 * @param {{
 *   dryRun?: boolean,
 *   selfPid?: number,
 *   graceMs?: number,
 *   isAlive?: (pid:number)=>boolean,
 *   listProcs?: () => Array<object>,
 *   platform?: string,
 *   ownSignature?: string,
 *   logger?: {log: Function},
 * }} [opts]
 * @returns {Promise<{scanned:number, candidates:Array, killed:number[], errors:Array, skipped:Array, freedEstimateMb:number}>}
 */
async function reap(opts = {}) {
  const {
    dryRun = true,
    selfPid = process.pid,
    graceMs = DEFAULT_GRACE_MS,
    isAlive = isProcessAlive,
    listProcs = listProcesses,
    platform = process.platform,
    ownSignature,
    logger,
  } = opts;

  const procs = listProcs();
  const candidates = findReapable(procs, { selfPid, isAlive, platform, ownSignature });
  const killed = [];
  const errors = [];
  const skipped = [];

  if (!dryRun) {
    for (const candidate of candidates) {
      const result = await killCandidate(candidate, { isAlive, graceMs, listProcs, selfPid, platform, ownSignature });
      if (result.killed) killed.push(candidate.pid);
      if (result.error) errors.push(result.error);
      if (result.skipped) skipped.push(result.skipped);
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
      `killed=${killed.length} skipped=${skipped.length} dryRun=${dryRun}`
    );
  }

  return { scanned: procs.length, candidates, killed, errors, skipped, freedEstimateMb };
}

module.exports = {
  listProcesses,
  parseWin32ProcessJson,
  parseWmicCsv,
  isClaudeMcpServer,
  ownProcessSignature,
  liveClaudeExclusion,
  computeSelfSubtree,
  findReapable,
  reap,
};
