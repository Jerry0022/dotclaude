/**
 * @module mcp-status
 * @version 0.2.0
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

// Liveness is read by ONE module (per-process heartbeat files + the legacy
// single file) — see mcp-heartbeat.js.
const { pidFileFor, isProcessAlive, isMcpServerAlive } = require('./mcp-heartbeat');

/**
 * Is the named MCP server reporting alive via a heartbeat PID file?
 * False when no heartbeat file names a live process.
 * @param {string} serverName  e.g. "dotclaude-ship"
 * @returns {boolean}
 */
function isServerAlive(serverName) {
  return isMcpServerAlive(serverName);
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
