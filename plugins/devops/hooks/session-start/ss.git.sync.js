#!/usr/bin/env node
/**
 * @hook ss.git.sync
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Registers a recurring git sync cron job (every 10 minutes).
 *   The cron runs scripts/git-sync.js to fetch remote main and merge
 *   the parent chain into the current worktree branch.
 *   One-time registration — the cron persists for the session lifetime.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const path = require('path');

const cwd = process.cwd();

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// Only register in a git repo on a non-main branch with a remote
if (git('rev-parse --is-inside-work-tree') !== 'true') process.exit(0);
if (!git('remote')) process.exit(0);

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch || branch === 'main') process.exit(0);

// Resolve absolute path to the shared sync script (forward slashes for bash)
const scriptPath = path.resolve(__dirname, '../../scripts/git-sync.js').replace(/\\/g, '/');

process.stdout.write(
  `Register a recurring git-sync cron job for this session. ` +
  `Call CronCreate with cron "*/10 * * * *" (recurring: true) ` +
  `and prompt: 'Silently run via Bash: node "${scriptPath}". ` +
  `Only mention output to the user if there are unresolvable merge conflicts (lines containing ✗). ` +
  `Otherwise do not produce any output.'\n`
);
