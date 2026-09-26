/**
 * @module mcp-heartbeat
 * @version 0.3.0
 * @description Best-effort liveness probe for the plugin's MCP servers, read
 *   from the PID files each server writes on boot (mcp-server/lib/heartbeat.js).
 *
 *   Hooks cannot see Claude Code's client-side MCP connection state, so this
 *   is a proxy: a live PID means SOME session has the server up, no live PID
 *   means nobody does. The false-negative window is a server that is still
 *   booting; the false-positive is a neighbouring session's server. Both are
 *   acceptable for what this feeds — the ORDER of fallback instructions in the
 *   completion-card reminders (#371) and pre.mcp.health's dead-server block.
 *
 *   Every server process writes its own `dotclaude-mcp-<name>-<pid>.pid`. The
 *   legacy single `dotclaude-mcp-<name>.pid` (one slot shared by every
 *   session, deleted by whichever server exited first → false "dead") is still
 *   read for one release, so a server of an older install counts too.
 *
 *   AUD-C043: servers >= heartbeat.js 0.3.0 write into the subdir
 *   `<tmp>/dotclaude-mcp-heartbeats/` (small, pruned by each server on
 *   start). That dir and the legacy single file are read first; the flat
 *   per-process layout in TEMP itself (one readdir of ~146 k entries) is
 *   only scanned when neither names a live process — kept for one release.
 *   isMcpServerAlive() stops at the first live PID.
 *
 *   Single reader for all hooks: mcp-status.js and pre.mcp.health.js delegate here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'dotclaude-mcp-';
/** Twin of mcp-server/lib/heartbeat.js HEARTBEAT_DIR. */
const HEARTBEAT_DIR = 'dotclaude-mcp-heartbeats';

/** The legacy single PID file (pre-0.194.2 servers). */
function pidFileFor(serverName) {
  return path.join(os.tmpdir(), `${PREFIX}${serverName}.pid`);
}

/** One server process's own PID file (the subdir layout, heartbeat.js >= 0.3.0). */
function processPidFileFor(serverName, pid) {
  return path.join(os.tmpdir(), HEARTBEAT_DIR, `${serverName}-${pid}.pid`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no kill
    return true;
  } catch (err) {
    // EPERM = process exists but we lack permission → alive
    return !!err && err.code === 'EPERM';
  }
}


/** `<head><digits>.pid` → true (plain string checks: names may hold dots). */
function matchesPidFile(fileName, head) {
  if (!fileName.startsWith(head) || !fileName.endsWith('.pid')) return false;
  const digits = fileName.slice(head.length, -4);
  return digits.length > 0 && /^[0-9]+$/.test(digits);
}

function readEntry(file, legacy) {
  try {
    const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return { file, pid: pid > 0 ? pid : null, mtimeMs: fs.statSync(file).mtimeMs, legacy };
  } catch { return null; /* vanished between readdir and read */ }
}

function listPidFiles(folder, head) {
  let names = [];
  try { names = fs.readdirSync(folder); } catch { return []; }
  return names.filter((n) => matchesPidFile(n, head)).map((n) => path.join(folder, n));
}

/**
 * Heartbeat files of a server in scan order: the subdir, the legacy single
 * file, and — only when `opts.stopAtLive` found nothing live in those, or
 * always without it — the flat pre-0.3.0 per-process files in TEMP.
 * @param {string} serverName
 * @param {{ stopAtLive?: boolean }} [opts] stop after the first live entry
 * @returns {Array<{ file: string, pid: number|null, mtimeMs: number, legacy: boolean }>}
 */
function heartbeats(serverName, opts = {}) {
  const dir = os.tmpdir();
  const out = [];
  let live = false;
  const take = (file, legacy) => {
    const e = readEntry(file, legacy);
    if (!e) return false;
    out.push(e);
    if (e.pid && isProcessAlive(e.pid)) live = true;
    return live && opts.stopAtLive;
  };
  for (const f of listPidFiles(path.join(dir, HEARTBEAT_DIR), `${serverName}-`)) {
    if (take(f, false)) return out;
  }
  if (fs.existsSync(pidFileFor(serverName)) && take(pidFileFor(serverName), true)) return out;
  if (live) return out; // the subdir answered — skip the expensive TEMP scan
  for (const f of listPidFiles(dir, `${PREFIX}${serverName}-`)) {
    if (take(f, false)) return out;
  }
  return out;
}

/**
 * @param {string} serverName
 * @returns {{ alive: number[], dead: Array<{ file: string, pid: number|null, legacy: boolean }>, latestLiveMtimeMs: number, any: boolean }}
 */
function heartbeatState(serverName, opts) {
  const all = heartbeats(serverName, opts);
  const alive = [];
  const dead = [];
  let latestLiveMtimeMs = 0;
  for (const h of all) {
    if (h.pid && isProcessAlive(h.pid)) {
      if (!alive.includes(h.pid)) alive.push(h.pid);
      latestLiveMtimeMs = Math.max(latestLiveMtimeMs, h.mtimeMs);
    } else {
      dead.push({ file: h.file, pid: h.pid, legacy: h.legacy });
    }
  }
  return { alive, dead, latestLiveMtimeMs, any: all.length > 0 };
}

/**
 * @param {string} serverName — e.g. 'dotclaude-completion'
 * @returns {boolean} true when any heartbeat file names a process that answers.
 */
function isMcpServerAlive(serverName) {
  return heartbeats(serverName, { stopAtLive: true }).some((h) => h.pid && isProcessAlive(h.pid));
}

module.exports = {
  PREFIX, HEARTBEAT_DIR, pidFileFor, processPidFileFor, isProcessAlive,
  heartbeats, heartbeatState, isMcpServerAlive,
};
