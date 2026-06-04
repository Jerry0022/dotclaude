#!/usr/bin/env node
/**
 * @hook pre.ship.guard
 * @version 0.4.0
 * @event PreToolUse
 * @plugin devops
 * @description Block manual PR creation/merging via Bash.
 *   These operations MUST go through /devops-ship MCP tools.
 *   Detects: gh pr create, gh pr merge, gh api .../pulls/.../merge
 *   Does NOT block: git push (needed for branch work before shipping).
 *   Does NOT block: MCP tool calls (tool_name !== "Bash").
 *
 *   #198 fixes:
 *     - Matching is delegated to lib/ship-guard-match, which strips quoted text
 *       and anchors to command position — so the guard no longer false-positives
 *       on "gh pr create" appearing inside an issue body / commit message.
 *     - The block message no longer unconditionally asserts "likely DEFERRED".
 *       It probes the ship server's heartbeat: if alive → the tools are merely
 *       deferred (ToolSearch them); if not alive → it may be genuinely
 *       unregistered, so it points at the recovery path (restart / cache rebuild).
 *     - Escape hatch: when the ship server is confirmed NOT alive, setting
 *       DOTCLAUDE_ALLOW_MANUAL_SHIP=1 allows a one-off manual ship so a missing
 *       server can no longer hard-deadlock the session. The escape is ignored
 *       when the server IS alive (then there is no deadlock — use the tools).
 */

require('../lib/plugin-guard');

const { isManualShipCommand } = require('../lib/ship-guard-match');
const { isServerAlive } = require('../lib/mcp-status');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // Only guard Bash tool calls — MCP tools (ship_release etc.) are pipeline-internal
  if ((hook.tool_name || '') !== 'Bash') process.exit(0);

  const cmd = (hook.tool_input || {}).command || '';
  if (!isManualShipCommand(cmd)) process.exit(0);

  const shipAlive = isServerAlive('dotclaude-ship');

  // Escape hatch — only when the pipeline server is confirmed absent. Never when
  // it is up: then there is no deadlock to escape, the tools are simply deferred.
  if (!shipAlive && process.env.DOTCLAUDE_ALLOW_MANUAL_SHIP === '1') {
    process.stderr.write(
      'NOTE: dotclaude-ship MCP server is not reporting alive and ' +
      'DOTCLAUDE_ALLOW_MANUAL_SHIP=1 is set — allowing this manual PR command ' +
      'as an explicit, user-authorized recovery escape.\n'
    );
    process.exit(0);
  }

  const lines = [
    'BLOCKED: Manual PR creation/merging detected. Use /devops-ship for shipping.',
    'The ship pipeline ensures build-ID, safety checks, version bumps, and proper completion cards.',
    '',
  ];

  if (shipAlive) {
    lines.push(
      'The dotclaude-ship MCP server IS running — its tools are just DEFERRED, not unregistered.',
      'Load their schemas via ToolSearch before calling:',
    );
  } else {
    lines.push(
      'The dotclaude-ship MCP server is NOT reporting alive (no heartbeat PID).',
      'First try loading the tools via ToolSearch — if it returns matches, they were only deferred:',
    );
  }

  lines.push(
    '  ToolSearch({ query: "select:mcp__plugin_devops_dotclaude-ship__ship_preflight,' +
    'mcp__plugin_devops_dotclaude-ship__ship_build,' +
    'mcp__plugin_devops_dotclaude-ship__ship_version_bump,' +
    'mcp__plugin_devops_dotclaude-ship__ship_release,' +
    'mcp__plugin_devops_dotclaude-ship__ship_cleanup", max_results: 5 })',
  );

  if (!shipAlive) {
    lines.push(
      '',
      'If ToolSearch returns NO matches, the ship server genuinely failed to register.',
      'Recovery: restart Claude Code (MCP servers spawn only at session init; ss.plugin.update',
      'self-heals the cache on the next start). If it persists, run /devops-plugin-update.',
      'Last resort: set DOTCLAUDE_ALLOW_MANUAL_SHIP=1 to allow a one-off manual ship this session.',
    );
  }

  lines.push('See {PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md for details.');

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
});
