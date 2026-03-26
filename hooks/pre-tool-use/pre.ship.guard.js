#!/usr/bin/env node
/**
 * @hook pre.ship.guard
 * @version 0.1.0
 * @event PreToolUse
 * @plugin dotclaude-dev-ops
 * @description Block git push when uncommitted or untracked files exist.
 *   Prevents shipping dirty state to remote.
 */

const { execSync } = require('child_process');

const cwd = process.cwd();

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// Read hook input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const cmd = (hook.tool_input && hook.tool_input.command) || '';

  // Only guard git push commands
  if (!/\bgit\s+push\b/.test(cmd)) {
    process.exit(0);
  }

  // Check for dirty state
  const status = git('status --porcelain');
  if (!status) {
    process.exit(0); // Clean — allow push
  }

  const lines = status.split('\n').filter(Boolean);
  const untracked = lines.filter(l => l.startsWith('??'));
  const modified = lines.filter(l => !l.startsWith('??'));

  console.error(`\n⛔ PUSH BLOCKED — dirty working tree`);
  console.error('─'.repeat(50));

  if (modified.length > 0) {
    console.error(`\nUncommitted changes (${modified.length}):`);
    modified.slice(0, 10).forEach(l => console.error(`  ${l}`));
    if (modified.length > 10) console.error(`  ... and ${modified.length - 10} more`);
  }

  if (untracked.length > 0) {
    console.error(`\nUntracked files (${untracked.length}):`);
    untracked.slice(0, 10).forEach(l => console.error(`  ${l}`));
    if (untracked.length > 10) console.error(`  ... and ${untracked.length - 10} more`);
  }

  console.error('─'.repeat(50));
  console.error('Commit or discard changes before pushing.');
  console.error('');
  process.exit(2);
});
