#!/usr/bin/env node
/**
 * @hook post.flow.debug
 * @version 0.4.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After 2+ consecutive Bash failures: recommend the flow skill.
 *   Tracks consecutive failures via a temp file. Resets on success.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { sessionFile, writeSessionFile } = require('../lib/session-id');

// Read hook input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (toolName !== 'Bash') {
    process.exit(0);
  }

  const counterFile = sessionFile('dotclaude-devops-bash-failures', hook.session_id);

  // Check tool result for failure indicators
  const exitCode = hook.exit_code;
  const isFailed = exitCode !== undefined && exitCode !== 0;

  if (!isFailed) {
    // Success — reset counter
    try { fs.unlinkSync(counterFile); } catch {}
    process.exit(0);
  }

  // Failure — increment counter
  let failures = 0;
  try {
    failures = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
  } catch {}
  failures++;
  try { writeSessionFile(counterFile, failures.toString()); } catch {}

  if (failures >= 2) {
    process.stdout.write(
      `Repeated Bash failure detected (${failures} consecutive). ` +
      'Consider running /flow: check recent git changes, ' +
      'read error logs, and perform root-cause analysis per ' +
      'skills/flow/SKILL.md before retrying. ' +
      'Alternative: /codex:rescue to delegate investigation to Codex ' +
      '(requires codex-plugin-cc).\n'
    );
    try { fs.unlinkSync(counterFile); } catch {}
  }
});
