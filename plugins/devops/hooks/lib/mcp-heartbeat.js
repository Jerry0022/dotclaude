/**
 * @module mcp-heartbeat
 * @version 0.2.0
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
 *   Single reader for all hooks: mcp-status.js and pre.mcp.health.js delegate here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'dotclaude-mcp-';

/** The legacy single PID file (pre-0.194.2 servers). */
function pidFileFor(serverName) {
  return path.join(os.tmpdir(), `${PREFIX}${serverName}.pid`);
}

/** One server process's own PID file. */
function processPidFileFor(serverName, pid) {
  return path.join(os.tmpdir(), `${PREFIX}${serverName}-${pid}.pid`);
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

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every heartbeat file of a server — per-process ones plus the legacy file.
 * @param {string} serverName
 * @returns {Array<{ file: string, pid: number|null, mtimeMs: number, legacy: boolean }>}
 */
function heartbeats(serverName) {
  const dir = os.tmpdir();
  const re = new RegExp(`^${escapeRe(PREFIX + serverName)}-(\\d+)\\.pid$`);
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  const read = (file, legacy) => {
    try {
      const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
      out.push({ file, pid: pid > 0 ? pid : null, mtimeMs: fs.statSync(file).mtimeMs, legacy });
    } catch { /* vanished between readdir and read */ }
  };
  for (const n of names) {
    if (re.test(n)) read(path.join(dir, n), false);
  }
  if (names.includes(`${PREFIX}${serverName}.pid`)) read(pidFileFor(serverName), true);
  return out;
}

/**
 * @param {string} serverName
 * @returns {{ alive: number[], dead: Array<{ file: string, pid: number|null, legacy: boolean }>, latestLiveMtimeMs: number, any: boolean }}
 */
function heartbeatState(serverName) {
  const all = heartbeats(serverName);
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
  return heartbeatState(serverName).alive.length > 0;
}

module.exports = {
  PREFIX, pidFileFor, processPidFileFor, isProcessAlive,
  heartbeats, heartbeatState, isMcpServerAlive,
};
