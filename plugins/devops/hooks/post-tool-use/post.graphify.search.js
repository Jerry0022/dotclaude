#!/usr/bin/env node
/**
 * @hook post.graphify.search
 * @version 0.3.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Grep|Glob
 * @description Telemetry only: record every Grep/Glob that actually RAN
 *   (`search_ran`) with its result size, so the graphify metrics file carries
 *   what raw searches cost in context and how much of that is `broad` (no
 *   `path`). Also records `outputMode`, `pathKind` ('none'|'dir'|'file' —
 *   cheap statSync only, via `hooks/lib/graph-nudge.pathKindFor`) and
 *   `eligible` (a semantic, graph-scoped Grep — the kind a `graphify query`
 *   could have covered), so `scripts/graphify-audit.js` can show what such
 *   searches actually cost. Never blocks, never prints, injects nothing.
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
