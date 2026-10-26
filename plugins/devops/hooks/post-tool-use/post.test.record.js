#!/usr/bin/env node
/**
 * @hook post.test.record
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Records a green FULL vitest run Claude made by hand (`npm test`,
 *   `npx vitest run`, no file filter) for the current git tree, so ship_build and
 *   the release merge gate (findFullGreen) reuse it instead of running the suite
 *   again. A failing command fires PostToolUseFailure, not this hook; an
 *   interrupt or non-zero exit code in the response also records nothing.
 *   The full-suite command must END the `&&` chain (`cd x && npm test`): then
 *   success means the suite passed on the tree as it is now. Chains with
 *   `||`, `;` or `|` record nothing. Reuse stays exact (identical tree hash).
 *   Recording is delegated to ship/test-record-cli.js `record-now`; any error
 *   fails open and silent.
 */

require('../lib/plugin-guard');

const path = require('path');
const { trailingFullSuite } = require('../lib/full-suite-cmd');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const CLI = path.join(__dirname, '..', '..', 'mcp-server', 'ship', 'test-record-cli.js');

/**
 * @param {object} hook parsed payload
 * @param {{spawn?: Function}} [deps] test seam (spawnSync-like)
 * @returns {{cwd: string, cmd: string}|null} what was handed to the recorder
 */
function main(hook, deps = {}) {
  if (!hook || !SHELL_TOOLS.has(hook.tool_name)) return null;
  const t = trailingFullSuite(String((hook.tool_input || {}).command || ''));
  if (!t) return null;
  const { normalizeToolResponse } = require('../lib/browsertest-guard');
  const r = normalizeToolResponse(hook.tool_response);
  if (r.interrupted || (r.exitCode !== null && r.exitCode !== 0)) return null;
  const base = typeof hook.cwd === 'string' && hook.cwd ? hook.cwd : process.cwd();
  const cwd = t.cdTo ? path.resolve(base, t.cdTo) : base;
  const spawn = deps.spawn || require('child_process').spawnSync;
  spawn(process.execPath, [CLI, 'record-now', '--cwd', cwd, '--cmd', t.segment],
    { cwd, timeout: 30000, windowsHide: true, stdio: 'ignore' });
  return { cwd, cmd: t.segment };
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PostToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main, CLI };
