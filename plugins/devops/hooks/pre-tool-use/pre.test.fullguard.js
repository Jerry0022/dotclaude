#!/usr/bin/env node
/**
 * @hook pre.test.fullguard
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description While a ship is in progress (the .claude/.ship-in-progress
 *   sentinel exists), refuse a FULL test-suite run by hand: `npm test`,
 *   `npm run test`, `npx vitest run` without file arguments. ship_build runs
 *   the suite once on the tree it ships (and records the green run); a second
 *   hand run on the same tree costs minutes on a loaded machine and proves
 *   nothing new. Filtered runs (`vitest run <files>`, `vitest related`) pass,
 *   as does everything outside a ship. Matching lives in lib/full-suite-cmd.
 *
 *   Bypass: inline `DEVOPS_ALLOW_FULL_SUITE=1` in the command or in the hook
 *   environment (e.g. ship_build named a red suite and you re-run it to debug).
 *   Fails open on any error.
 */

require('../lib/plugin-guard');

const { containsFullSuite } = require('../lib/full-suite-cmd');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const MESSAGE = 'ship_build runs the suite on this tree; a filtered run (vitest run <files>) is fine. ' +
  '(Full-suite runs are blocked while a ship is in progress. Inline DEVOPS_ALLOW_FULL_SUITE=1 overrides.)';

/**
 * @param {object} hook parsed payload
 * @param {{isActive?: (cwd: string) => boolean}} [deps] test seam
 * @returns {{block: string}|null}
 */
function main(hook, deps = {}) {
  if (!hook || !SHELL_TOOLS.has(hook.tool_name)) return null;
  const cmd = String((hook.tool_input || {}).command || '');
  if (!containsFullSuite(cmd)) return null;
  if (process.env.DEVOPS_ALLOW_FULL_SUITE === '1' || /\bDEVOPS_ALLOW_FULL_SUITE=1\b/.test(cmd)) return null;
  const isActive = deps.isActive || require('../lib/ship-sentinel').isActive;
  const cwd = typeof hook.cwd === 'string' && hook.cwd ? hook.cwd : process.cwd();
  if (!isActive(cwd)) return null;
  return { block: MESSAGE };
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PreToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main, MESSAGE };
