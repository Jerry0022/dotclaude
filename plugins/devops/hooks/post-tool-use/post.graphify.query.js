#!/usr/bin/env node
/**
 * @hook post.graphify.query
 * @version 0.3.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description When Claude runs `graphify query ...`, record a per-session flag
 *   so the PreToolUse graphify-gate relents for the rest of the session — Claude
 *   has consulted the graph, so it should not be re-blocked on every broad
 *   search. Also records a `query_ran` telemetry event (hooks/lib/
 *   graphify-metrics) carrying `responseChars` — the numerator AND the cost
 *   side of the query-adoption metric (real `graphify query` runs vs. gate
 *   fires, and what those answers weigh in context). Listens on PowerShell as
 *   well as Bash: Desktop-app sessions default to PowerShell, and with a
 *   Bash-only matcher every one of their queries went unrecorded and the gate
 *   never relented (measured: 4 of 7 queries in a month). Purely a state
 *   write + metrics append; never blocks.
 */

require('../lib/plugin-guard');

const gstate = require('../lib/graphify-state');
const metrics = require('../lib/graphify-metrics');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }
  const toolName = hook.tool_name || '';
  if (!SHELL_TOOLS.has(toolName)) process.exit(0);
  const cmd = (hook.tool_input && hook.tool_input.command) || '';
  if (gstate.isGraphifyQueryCommand(cmd)) {
    const sid = hook.session_id || hook.sessionId || 'nosid';
    gstate.markQueryDone(sid, process.cwd());
    metrics.record('query_ran', { tool: toolName, responseChars: metrics.responseChars(hook.tool_response) }, { cwd: process.cwd(), sid });
  }
  process.exit(0);
});
