#!/usr/bin/env node
/**
 * @hook pre.main.guard
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash
 * @description Prevent accidental writes on local main/master.
 *
 *   Blocks Bash commands that would mutate main when HEAD is on main/master:
 *     git commit, git merge, git rebase, git cherry-pick,
 *     git push (any form targeting main), git reset --hard,
 *     git revert, git apply, git am
 *
 *   Bypass conditions (any one of them → exit 0):
 *     - Not inside a git repo
 *     - HEAD is NOT main/master
 *     - Sentinel file .claude/.ship-in-progress exists (ship pipeline active)
 *     - DEVOPS_ALLOW_MAIN=1 in environment
 *
 *   Read-only git commands (status, log, diff, fetch, branch listing) pass
 *   through untouched.
 */

require('../lib/plugin-guard');

const { execFileSync } = require('node:child_process');
const { isActive: sentinelActive } = require('../lib/ship-sentinel');

const WRITE_PATTERNS = [
  /^\s*git\s+commit(\s|$)/,
  /^\s*git\s+merge(\s|$)/,
  /^\s*git\s+rebase(\s|$)/,
  /^\s*git\s+cherry-pick(\s|$)/,
  /^\s*git\s+revert(\s|$)/,
  /^\s*git\s+reset\s+--hard(\s|$)/,
  /^\s*git\s+apply(\s|$)/,
  /^\s*git\s+am(\s|$)/,
  /^\s*git\s+push(\s|$)/,
];

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  if ((hook.tool_name || '') !== 'Bash') process.exit(0);

  const cmd = (hook.tool_input || {}).command || '';
  if (!cmd) process.exit(0);

  if (!WRITE_PATTERNS.some(re => re.test(cmd))) process.exit(0);

  const cwd = hook.cwd || process.cwd();

  if (process.env.DEVOPS_ALLOW_MAIN === '1') process.exit(0);
  if (!isGitRepo(cwd)) process.exit(0);
  if (sentinelActive(cwd)) process.exit(0);

  const branch = currentBranch(cwd);
  if (!branch) process.exit(0);
  if (branch !== 'main' && branch !== 'master') process.exit(0);

  process.stderr.write(
    `BLOCKED: Write operation on local '${branch}' is not allowed.\n` +
    `Rule: Never commit/merge/push directly on ${branch}. Work on a branch derived from origin/${branch} and land via /devops-ship.\n` +
    `Fix: git fetch origin && git switch -c <feat/topic> origin/${branch}\n` +
    `Bypass (only if the user explicitly asked to work on ${branch}): set env DEVOPS_ALLOW_MAIN=1 for this single command.\n`
  );
  process.exit(2);
});
