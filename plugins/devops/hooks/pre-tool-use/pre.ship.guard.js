#!/usr/bin/env node
/**
 * @hook pre.ship.guard
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @description Block manual PR creation/merging via Bash.
 *   These operations MUST go through /devops-ship MCP tools.
 *   Detects: gh pr create, gh pr merge, gh api .../pulls/.../merge
 *   Does NOT block: git push (needed for branch work before shipping).
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

  const cmd = (hook.tool_input || {}).command || '';

  const blocked = BLOCKED_PATTERNS.some(re => re.test(cmd));
  if (!blocked) process.exit(0);

  process.stderr.write(
    'BLOCKED: Manual PR creation/merging detected. ' +
    'Use /devops-ship for shipping. ' +
    'The ship pipeline ensures build-ID, safety checks, version bumps, and proper completion cards.\n'
  );
  process.exit(2);
});
