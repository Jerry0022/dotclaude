#!/usr/bin/env node
/**
 * @hook pre.ship.guard
 * @version 0.3.0
 * @event PreToolUse
 * @plugin devops
 * @description Block manual PR creation/merging via Bash.
 *   These operations MUST go through /devops-ship MCP tools.
 *   Detects: gh pr create, gh pr merge, gh api .../pulls/.../merge
 *   Does NOT block: git push (needed for branch work before shipping).
 *   Does NOT block: MCP tool calls (tool_name !== "Bash") — the ship pipeline
 *   itself uses execFileSync which doesn't go through Bash hooks, but Claude
 *   may retry failed MCP calls via Bash as a fallback. This guard only fires
 *   on Bash tool invocations.
 */

require('../lib/plugin-guard');

const BLOCKED_PATTERNS = [
  /gh\s+pr\s+create/,
  /gh\s+pr\s+merge/,
  /gh\s+api\s+.*pulls.*\/merge/,
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // Only guard Bash tool calls — MCP tools (ship_release etc.) are pipeline-internal
  const toolName = hook.tool_name || '';
  if (toolName !== 'Bash') process.exit(0);

  const cmd = (hook.tool_input || {}).command || '';

  const blocked = BLOCKED_PATTERNS.some(re => re.test(cmd));
  if (!blocked) process.exit(0);

  process.stderr.write(
    'BLOCKED: Manual PR creation/merging detected. ' +
    'Use /devops-ship for shipping. ' +
    'The ship pipeline ensures build-ID, safety checks, version bumps, and proper completion cards.\n' +
    '\n' +
    'If ship_* MCP tools appear missing: they are likely DEFERRED, not unregistered. ' +
    'Load their schemas via ToolSearch before calling:\n' +
    '  ToolSearch({ query: "select:mcp__plugin_devops_dotclaude-ship__ship_preflight,' +
    'mcp__plugin_devops_dotclaude-ship__ship_build,' +
    'mcp__plugin_devops_dotclaude-ship__ship_version_bump,' +
    'mcp__plugin_devops_dotclaude-ship__ship_release,' +
    'mcp__plugin_devops_dotclaude-ship__ship_cleanup", max_results: 5 })\n' +
    'See {PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md for details.\n'
  );
  process.exit(2);
});
