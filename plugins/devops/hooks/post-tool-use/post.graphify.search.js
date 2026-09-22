#!/usr/bin/env node
/**
 * @hook post.graphify.search
 * @version 0.2.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Grep|Glob
 * @description Telemetry only: record every Grep/Glob that actually RAN
 *   (`search_ran`) with its result size, so the graphify metrics file carries
 *   the denominator the gate lacked — what raw searches cost in context, and
 *   how much of that is `broad` (no `path`, i.e. gate-eligible). Also records
 *   `outputMode`, `pathKind` ('none'|'dir'|'file' — cheap statSync only, via
 *   `hooks/lib/graph-nudge.pathKindFor`) and `eligible` (whether the PreToolUse
 *   gate would have treated this exact search as answerable from the graph),
 *   so `scripts/graphify-audit.js` can estimate the median cost of an
 *   ELIGIBLE search per project — the baseline the gate's savings are measured
 *   against. Fail-silent, never blocks, never prints.
 */

require('../lib/plugin-guard');

const metrics = require('../lib/graphify-metrics');
let graphNudge = null;
try { graphNudge = require('../lib/graph-nudge'); } catch { /* eligible/pathKind degrade to unknown */ }

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
  const cwd = process.cwd();
  let pathKind = 'none';
  let eligible = false;
  try {
    if (graphNudge) {
      pathKind = graphNudge.pathKindFor(input.path, cwd);
      eligible = graphNudge.isEligibleSearch(toolName, input, cwd);
    }
  } catch { /* leave defaults */ }
  metrics.record('search_ran', {
    tool: toolName,
    broad: !input.path,
    pattern: String(input.pattern || '').slice(0, 120),
    responseChars: metrics.responseChars(hook.tool_response),
    outputMode: input.output_mode || '',
    pathKind,
    eligible,
  }, { cwd, sid });
  process.exit(0);
});
