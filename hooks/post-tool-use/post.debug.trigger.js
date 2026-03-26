#!/usr/bin/env node
/**
 * @hook post.debug.trigger
 * @version 0.1.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After 2+ consecutive Bash failures: recommend the debug flow.
 *   Tracks consecutive failures via a temp file. Resets on success.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const COUNTER_FILE = path.join(os.tmpdir(), `dotclaude-devops-bash-failures-${process.ppid}`);

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

  // Check tool result for failure indicators
  const result = hook.tool_result || '';
  const exitCode = hook.exit_code;

  // Determine if this was a failure
  const isFailed = exitCode !== undefined && exitCode !== 0;

  if (!isFailed) {
    // Success — reset counter
    try { fs.unlinkSync(COUNTER_FILE); } catch {}
    process.exit(0);
  }

  // Failure — increment counter
  let failures = 0;
  try {
    failures = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8'), 10) || 0;
  } catch {}
  failures++;
  try { fs.writeFileSync(COUNTER_FILE, failures.toString()); } catch {}

  if (failures >= 2) {
    // Recommend debug flow via stdout
    process.stdout.write(
      `Repeated Bash failure detected (${failures} consecutive). ` +
      'Consider running the debug flow: check recent git changes, ' +
      'read error logs, and perform root-cause analysis per ' +
      'skills/debug/SKILL.md before retrying.\n'
    );
    // Reset counter after recommendation to avoid spamming
    try { fs.unlinkSync(COUNTER_FILE); } catch {}
  }
});
