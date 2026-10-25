#!/usr/bin/env node
/**
 * @hook pre.frustrated.readonly
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @feature frustrated-mode (alpha)
 * @matcher Edit|Write|NotebookEdit|MultiEdit|Bash|PowerShell|Workflow|mcp__.*(ship|github|issue).*
 * @description Read-only guard of a frustrated analysis. While the session's
 *   marker is armed (2 h expiry, armed by `scripts/frustrated-guard.js arm`),
 *   deny (exit 2) changes to the app's source and config: edits outside the
 *   temp dir, `.claude/` state and test artifacts, shell commands that are not
 *   read-only, a test/lint run or a plugin state script, any Workflow, and
 *   mutating ship / GitHub MCP tools. Subagent calls carry the parent's
 *   session_id, so analysts are covered too. Rules: lib/frustrated-guard.js.
 *
 *   The hook also applies `frustrated-guard.js arm|disarm` itself with the
 *   payload's session_id, so arming works where the Bash tool has no session
 *   id in its environment. Only the main thread may arm or disarm; a
 *   subagent's disarm call is denied.
 *
 *   Silent no-op unless featureAllowed('frustrated-mode') — checked before any
 *   I/O. Unarmed sessions: one read of the marker, exit 0. An internal error
 *   never blocks.
 */

if (require.main === module) {
  try {
    if (!require('../lib/features').featureAllowed('frustrated-mode')) process.exit(0);
  } catch { process.exit(0); }
  require('../lib/plugin-guard');
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { inputData += d; });
  process.stdin.on('end', () => {
    let out = null;
    try {
      const g = require('../lib/frustrated-guard');
      const hook = require('../lib/hook-input').parseHookInput(inputData);
      out = g.hookDecision(hook);
      if (out.block) process.stderr.write(g.denyText(out.reason));
    } catch (e) {
      process.stderr.write(`[pre.frustrated.readonly] off — ${e && e.message ? e.message : e}\n`);
      process.exit(0);
    }
    process.exit(out && out.block ? 2 : 0);
  });
}
