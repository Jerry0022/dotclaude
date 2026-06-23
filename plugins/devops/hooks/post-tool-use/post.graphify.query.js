#!/usr/bin/env node
/**
 * @hook post.graphify.query
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Bash
 * @description When Claude runs `graphify query ...`, record a per-session flag
 *   so the PreToolUse graphify-gate relents for the rest of the session — Claude
 *   has consulted the graph, so it should not be re-blocked on every broad
 *   search. Purely a state write; never blocks.
 */

require('../lib/plugin-guard');

const gstate = require('../lib/graphify-state');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }
  if ((hook.tool_name || '') !== 'Bash') process.exit(0);
  const cmd = (hook.tool_input && hook.tool_input.command) || '';
  if (gstate.isGraphifyQueryCommand(cmd)) {
    gstate.markQueryDone(hook.session_id || hook.sessionId || 'nosid', process.cwd());
  }
  process.exit(0);
});
