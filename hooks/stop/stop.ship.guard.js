#!/usr/bin/env node
/**
 * @hook stop.ship.guard
 * @version 0.1.0
 * @event Stop
 * @plugin dotclaude-dev-ops
 * @description Warn about uncommitted changes when Claude finishes a response.
 *   Suggests WIP commit if dirty state is detected. Non-blocking (exit 0).
 */

require('../lib/plugin-guard');

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

// Only run in a git repo
if (git('rev-parse --is-inside-work-tree') !== 'true') {
  process.exit(0);
}

// Check for dirty state
const status = git('status --porcelain');
if (!status) {
  process.exit(0); // Clean — nothing to warn about
}

const lines = status.split('\n').filter(Boolean);
const branch = git('rev-parse --abbrev-ref HEAD') || 'unknown';

// Check if we're on a feature branch (not main)
const isFeatureBranch = branch !== 'main' && branch !== 'master';

// Check if changes are pushed
let unpushed = 0;
if (isFeatureBranch) {
  const count = git('rev-list --count @{upstream}..HEAD 2>/dev/null');
  if (count !== null) unpushed = parseInt(count) || 0;
}

// Output warning via stdout (injected into Claude's context)
const warnings = [];
warnings.push(
  `Uncommitted changes detected on branch \`${branch}\` (${lines.length} files).`
);

if (isFeatureBranch && (lines.length > 0 || unpushed > 0)) {
  warnings.push(
    'Consider a WIP commit + push to preserve work:',
    '  git add <files> && git commit -m "wip(scope): save progress" && git push'
  );
}

if (unpushed > 0) {
  warnings.push(`${unpushed} local commit(s) not yet pushed to remote.`);
}

process.stdout.write(warnings.join('\n') + '\n');
