/**
 * @module mcp-heartbeat
 * @version 0.1.0
 * @description Best-effort liveness probe for the plugin's MCP servers, read
 *   from the PID file each server writes on boot (mcp-server/lib/heartbeat.js).
 *
 *   Hooks cannot see Claude Code's client-side MCP connection state, so this
 *   is a proxy: a live PID means SOME session has the server up, a missing or
 *   dead PID means nobody does. The false-negative window is a server that is
 *   still booting; the false-positive is a neighbouring session's server. Both
 *   are acceptable for what this feeds — the ORDER of fallback instructions in
 *   the completion-card reminders (#371), never a hard gate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'dotclaude-mcp-';

function pidFileFor(serverName) {
  return path.join(os.tmpdir(), `${PREFIX}${serverName}.pid`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/**
 * @param {string} serverName — e.g. 'dotclaude-completion'
 * @returns {boolean} true when a PID file exists and its process answers.
 */
function isMcpServerAlive(serverName) {
  try {
    const pid = parseInt(fs.readFileSync(pidFileFor(serverName), 'utf8'), 10);
    return Number.isFinite(pid) && pid > 0 && isProcessAlive(pid);
  } catch {
    return false;
  }
}

module.exports = { PREFIX, pidFileFor, isProcessAlive, isMcpServerAlive };
