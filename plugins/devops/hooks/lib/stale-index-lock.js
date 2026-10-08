'use strict';
/**
 * @module stale-index-lock
 * @version 0.1.0
 * @plugin devops
 * @description Remove an `index.lock` a killed git process left behind long
 *   ago — and only that one.
 *
 *   git deletes its lock on every exit it gets to run; a process killed
 *   without cleanup (Windows TerminateProcess, a hook timeout) leaves a 0-byte
 *   `index.lock` that fails every later index write in that repo with
 *   "Another git process seems to be running". Observed 2026-10-08 in the
 *   dotclaude marketplace clone: a 2 h old 0-byte lock made every channel-pin
 *   checkout fail while ss.plugin.update reported nothing.
 *
 *   git-sync-recover.releaseKilledIndexLock covers the lock of a merge child
 *   the SAME process just killed (it knows when it started). This module is
 *   for a lock nobody here created, so it asks for stronger evidence instead:
 *     - 0 bytes — git writes the whole new index into the lock just before it
 *       renames it; a lock with content may be mid-commit or a real index;
 *     - older than STALE_LOCK_MIN_AGE_MS — no index write runs that long;
 *     - no running git process that started before the lock was written —
 *       git creates the lock itself, so a git started later cannot own it.
 *       Long-running read-only git processes (fsmonitor daemon, `cat-file
 *       --batch` of an IDE, credential helpers) never take the index lock and
 *       are ignored. When the process list cannot be read, the lock stays.
 *     - unchanged (inode, mtime, size) between the first look and the unlink.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** A 0-byte lock at least this old is a candidate. */
const STALE_LOCK_MIN_AGE_MS = 10 * 60_000;
/** Timestamp slack between a process start and the lock's mtime (ps reports whole seconds). */
const START_SLACK_MS = 2000;
const LIST_TIMEOUT_MS = 10_000;
/** git subcommands that run for a long time but never write the index. */
const NON_INDEX_GIT = /\s(?:fsmonitor--daemon|cat-file|credential(?:-\S+)?)\b/;

/** `[[dd-]hh:]mm:ss` (ps etime) → seconds, or null. */
function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  return (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** `ps -A -o pid=,etime=,args=` → git processes with an absolute start time. */
function parsePs(out, now = Date.now()) {
  const procs = [];
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const argv0 = m[3].split(/\s+/)[0];
    if (path.basename(argv0) !== 'git') continue;
    const secs = parseEtime(m[2]);
    if (secs == null) continue;
    procs.push({ pid: Number(m[1]), start: now - secs * 1000, cmd: m[3] });
  }
  return procs;
}

/** PowerShell's ConvertTo-Json of the git.exe list → processes. */
function parseWinJson(out) {
  const text = String(out).trim();
  if (!text) return [];
  const data = JSON.parse(text);
  return (Array.isArray(data) ? data : [data])
    .filter((p) => p && Number.isFinite(Number(p.start)))
    .map((p) => ({ pid: Number(p.pid), start: Number(p.start), cmd: String(p.cmd || '') }));
}

const WIN_LIST = [
  "$p = @(Get-CimInstance Win32_Process -Filter \"Name='git.exe'\" | ForEach-Object {",
  '[pscustomobject]@{ pid = $_.ProcessId; start = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(); cmd = $_.CommandLine } });',
  'ConvertTo-Json -InputObject $p -Compress',
].join(' ');

/**
 * Every running git process with its start time (ms since epoch), or null
 * when the list cannot be read.
 * @returns {Array<{pid:number, start:number, cmd:string}>|null}
 */
function gitProcesses({ platform = process.platform, now = Date.now() } = {}) {
  try {
    if (platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: LIST_TIMEOUT_MS, windowsHide: true,
      });
      return parseWinJson(out);
    }
    const out = execFileSync('ps', ['-A', '-o', 'pid=,etime=,args='], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: LIST_TIMEOUT_MS,
    });
    return parsePs(out, now);
  } catch {
    return null;
  }
}

/**
 * @param {{gitDir:string, now?:number, minAgeMs?:number, listGitProcesses?:()=>Array<{pid:number,start:number,cmd:string}>|null}} o
 * @returns {{status:'absent'|'removed'|'young'|'nonempty'|'held'|'unknown'|'failed', lock:string, ageMs?:number, pids?:number[], error?:string}}
 *   'held' names the pids that may own it; 'unknown' = process list unreadable.
 */
function releaseStaleIndexLock({ gitDir, now = Date.now(), minAgeMs = STALE_LOCK_MIN_AGE_MS, listGitProcesses = gitProcesses }) {
  const lock = path.join(gitDir, 'index.lock');
  let st;
  try { st = fs.statSync(lock); } catch { return { status: 'absent', lock }; }
  const ageMs = Math.max(0, now - st.mtimeMs);
  if (st.size > 0) return { status: 'nonempty', lock, ageMs };
  if (ageMs < minAgeMs) return { status: 'young', lock, ageMs };

  const procs = listGitProcesses();
  if (!Array.isArray(procs)) return { status: 'unknown', lock, ageMs };
  const holders = procs.filter((p) => p.start <= st.mtimeMs + START_SLACK_MS && !NON_INDEX_GIT.test(` ${p.cmd}`));
  if (holders.length) return { status: 'held', lock, ageMs, pids: holders.map((p) => p.pid) };

  let again;
  try { again = fs.statSync(lock); } catch { return { status: 'absent', lock }; }
  if (again.ino !== st.ino || again.mtimeMs !== st.mtimeMs || again.size !== st.size) {
    return { status: 'held', lock, ageMs, pids: [] };
  }
  try {
    fs.unlinkSync(lock);
    return { status: 'removed', lock, ageMs };
  } catch (e) {
    return { status: 'failed', lock, ageMs, error: (e && e.code) || String(e) };
  }
}

/** One human line for a lock that was NOT removed, or '' when there is nothing to say. */
function describeKeptLock(r) {
  const age = r.ageMs != null ? `${Math.round(r.ageMs / 60_000)} min old` : '';
  switch (r.status) {
    case 'nonempty': return `index.lock left in place (not empty, ${age})`;
    case 'young': return `index.lock left in place (${age}, younger than ${STALE_LOCK_MIN_AGE_MS / 60_000} min)`;
    case 'held':
      return r.pids && r.pids.length
        ? `index.lock left in place (${age}; git process${r.pids.length === 1 ? '' : 'es'} ${r.pids.join(', ')} may own it)`
        : `index.lock left in place (${age}; it changed while checked — a live git owns it)`;
    case 'unknown': return `index.lock left in place (${age}; running git processes could not be listed) — delete ${r.lock} by hand if no git is running`;
    case 'failed': return `index.lock could not be removed (${r.error}) — delete ${r.lock} by hand`;
    default: return '';
  }
}

module.exports = {
  STALE_LOCK_MIN_AGE_MS,
  parseEtime,
  parsePs,
  parseWinJson,
  gitProcesses,
  releaseStaleIndexLock,
  describeKeptLock,
};
