#!/usr/bin/env node
/**
 * @hook post.graphify.search
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Grep|Glob
 * @description Telemetry only: record every Grep/Glob that actually RAN
 *   (`search_ran`) with its result size, so the graphify metrics file carries
 *   the denominator the gate lacked — what raw searches cost in context, and
 *   how much of that is `broad` (no `path`, i.e. gate-eligible). Without this
 *   the log could count blocks and bypasses but never answer "does the gate
 *   save anything?" (measured over 20 sessions: all Grep/Glob output was 0.03 %
 *   of new input — the audit script `scripts/graphify-audit.js` reads this
 *   stream). Fail-silent, never blocks, never prints.
 */

require('../lib/plugin-guard');

const metrics = require('../lib/graphify-metrics');

const SEARCH_TOOLS = new Set(['Grep', 'Glob']);

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }
  const toolName = hook.tool_name || '';
  if (!SEARCH_TOOLS.has(toolName)) process.exit(0);
  const input = hook.tool_input || {};
  const sid = hook.session_id || hook.sessionId || 'nosid';
  metrics.record('search_ran', {
    tool: toolName,
    broad: !input.path,
    pattern: String(input.pattern || '').slice(0, 120),
    responseChars: metrics.responseChars(hook.tool_response),
  }, { cwd: process.cwd(), sid });
  process.exit(0);
});
