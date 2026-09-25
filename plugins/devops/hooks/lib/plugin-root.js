/**
 * @module plugin-root
 * @version 0.1.0
 * @plugin devops
 * @description The absolute devops plugin root, and the one sentence that
 *   hands it to the model.
 *
 *   Skills, agents and deep-knowledge docs name plugin files as
 *   `{PLUGIN_ROOT}/deep-knowledge/<file>`. That placeholder is plugin prose,
 *   not `${CLAUDE_PLUGIN_ROOT}`, so Claude Code never substitutes it, and
 *   `$CLAUDE_PLUGIN_ROOT` is set only in hook and MCP processes, never in the
 *   Bash tool. A subagent had no way to resolve it and fell back to
 *   `find / -maxdepth 6 -iname ui-defaults.md`, a whole-machine crawl that
 *   outlived the agent once the Bash timeout backgrounded it (2026-09-24).
 *   Every hook that points the model at a plugin file uses this module, so the
 *   model always gets a literal path.
 */

const path = require('path');

/**
 * Absolute plugin root with forward slashes. Hooks run with
 * CLAUDE_PLUGIN_ROOT set; the fallback is this file's own install location.
 * @returns {string}
 */
function pluginRoot() {
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
  return toSlash(root);
}

/** @param {string} p */
function toSlash(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * Absolute path of a deep-knowledge doc, forward slashes.
 * @param {string} file e.g. 'ui-defaults.md'
 * @param {string} [root]
 */
function deepKnowledgePath(file, root = pluginRoot()) {
  return `${toSlash(root).replace(/\/+$/, '')}/deep-knowledge/${file}`;
}

/**
 * The context line that resolves `{PLUGIN_ROOT}` for the model.
 * @param {string} [root]
 * @returns {string}
 */
function pluginRootLine(root = pluginRoot()) {
  const r = toSlash(root).replace(/\/+$/, '');
  return (
    `[devops] {PLUGIN_ROOT} = ${r} (the installed devops plugin). ` +
    `Every \`{PLUGIN_ROOT}/…\` path in plugin skills, agents and docs is under it, ` +
    `e.g. ${r}/deep-knowledge/pre-mortem.md. $CLAUDE_PLUGIN_ROOT is NOT set in the Bash tool: use this literal path. ` +
    'Never search the filesystem (find /, a drive root, or the home directory) for plugin files.'
  );
}

module.exports = { pluginRoot, pluginRootLine, deepKnowledgePath, toSlash };
