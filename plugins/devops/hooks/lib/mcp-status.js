/**
 * @module mcp-status
 * @version 0.1.0
 * @description Shared helpers for inspecting devops MCP server health, used by
 *   ss.mcp.verify (cache-file presence at session start) and pre.ship.guard
 *   (heartbeat liveness when deciding between "deferred" vs "genuinely absent").
 *
 *   Two independent signals:
 *     - expectedServers()/serverEntryExists(): does the server's entry file exist
 *       in the active install root? Deterministic — predicts whether a server CAN
 *       register. The right signal at SessionStart (servers may not have spawned
 *       yet, so liveness would be racy).
 *     - isServerAlive(): is the heartbeat PID (written by mcp-server/lib/heartbeat.js)
 *       referencing a live process? The right signal mid-session (PreToolUse),
 *       when a server has had the whole session to start.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PID_PREFIX = 'dotclaude-mcp-';

function pidFileFor(serverName) {
  return path.join(os.tmpdir(), `${PID_PREFIX}${serverName}.pid`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no kill
    return true;
  } catch (err) {
    // EPERM = process exists but we lack permission → alive
    return err.code === 'EPERM';
  }
}

/**
 * Is the named MCP server reporting alive via its heartbeat PID file?
 * Returns false when the PID file is absent, unreadable, or the PID is dead.
 * @param {string} serverName  e.g. "dotclaude-ship"
 * @returns {boolean}
 */
function isServerAlive(serverName) {
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidFileFor(serverName), 'utf8').trim(), 10);
  } catch {
    return false;
  }
  if (!pid || Number.isNaN(pid)) return false;
  return isProcessAlive(pid);
}

/**
 * Substitute ${CLAUDE_PLUGIN_ROOT} and ${ENV_VARS} in an .mcp.json arg.
 * Unset env vars are left as-is so the caller can still report a usable path.
 */
function resolveVars(str, pluginRoot) {
  return str
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (m, v) => process.env[v] || m);
}

/**
 * Parse the plugin's .mcp.json and return the declared servers with their
 * resolved entry-file paths.
 * @param {string} pluginRoot  CLAUDE_PLUGIN_ROOT (the active install dir)
 * @returns {Array<{name: string, entry: string|null}>}
 */
function expectedServers(pluginRoot) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.mcp.json'), 'utf8'));
  } catch {
    return [];
  }
  const servers = cfg.mcpServers || {};
  return Object.entries(servers).map(([name, def]) => {
    const args = Array.isArray(def?.args) ? def.args : [];
    const rawEntry = args.find((a) => typeof a === 'string' && a.endsWith('.js'));
    return { name, entry: rawEntry ? resolveVars(rawEntry, pluginRoot) : null };
  });
}

function serverEntryExists(entry) {
  return !!entry && fs.existsSync(entry);
}

module.exports = {
  pidFileFor,
  isProcessAlive,
  isServerAlive,
  resolveVars,
  expectedServers,
  serverEntryExists,
};
