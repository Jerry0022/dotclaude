#!/usr/bin/env node
/**
 * @hook pre.main.guard
 * @version 0.3.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
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
 *
 *   The remedy depends on where the block happens (lib/branch-fix.js): in
 *   the repo's MAIN checkout — possibly shared by several sessions — the
 *   session moves into its own worktree instead of switching the shared
 *   checkout's branch; in a linked worktree `git switch -c` stays the fix.
 *
 *   Every git probe goes through lib/git-timeout.js's gitOut — GIT_TIMEOUT_MS
 *   per call; before, these calls had no timeout at all. A failed or hung
 *   probe reads as "not a repo" / "no branch" / "no origin", as a failure
 *   always did.
 */

// A lib that fails to load (half-written during a plugin update, version skew)
// makes this hook a silent no-op instead of a hook error on every Bash call
// (AUD-028).
let gitOut, sentinelActive, isLinkedWorktree, branchFix, BYPASS, gitCommandRe, matchesGitCommand, WORD_END;
try {
  require('../lib/plugin-guard');
  ({ gitCommandRe, matchesGitCommand, WORD_END } = require('../lib/ship-guard-match'));
  ({ gitOut } = require('../lib/git-timeout'));
  ({ isActive: sentinelActive } = require('../lib/ship-sentinel'));
  ({ isLinkedWorktree } = require('../lib/project-root'));
  ({ branchFix, BYPASS } = require('../lib/branch-fix'));
} catch (err) {
  // Silent to the user and the model (exit 0), but not traceless: the line
  // lands in the hook log, so a persistent load error can be found (AUD-068).
  process.stderr.write(`[pre.main.guard] off — a lib failed to load: ${(err && err.message) || err}\n`);
  process.exit(0);
}

// Matched at every command position of the (quote-masked) command, so a
// chained `git add -A && git commit`, `git -C <dir> commit` and
// `git -c k=v commit` are caught; a commit message or echo that merely
// mentions "git commit" is not (lib/ship-guard-match.js).
const WRITE_PATTERNS = [
  'commit', 'merge', 'rebase', 'cherry-pick', 'revert', String.raw`reset\s+--hard`,
  'apply', 'am', 'push', 'restore', String.raw`checkout\s+(?:--ours|--theirs|--patch|-p)`,
  'clean', String.raw`stash\s+(?:pop|drop|apply|clear)`, 'update-ref',
].map(rest => gitCommandRe(rest + WORD_END));
WRITE_PATTERNS.push(gitCommandRe(String.raw`checkout(?:\s+[^\n;&|]*)?\s--(?=\s)`));

function currentBranch(cwd) {
  return gitOut(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

function isGitRepo(cwd) {
  return gitOut(cwd, ['rev-parse', '--is-inside-work-tree']) !== null;
}

/**
 * Does this repo have an `origin` remote?
 *
 * The block itself stays correct without one — "don't work directly on main"
 * is about branch hygiene, not about the remote. But the SUGGESTED FIX was
 * `git fetch origin && git switch -c <topic> origin/main`, which in a
 * local-only repo fails twice over ("'origin' does not appear to be a git
 * repository", then "invalid reference: origin/main"). The user was left
 * blocked with an escape hatch that could not be executed.
 */
function hasRemote(cwd) {
  return gitOut(cwd, ['remote', 'get-url', 'origin']) !== null;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const tool = hook.tool_name || '';
  if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);

  const cmd = (hook.tool_input || {}).command || '';
  if (!cmd) process.exit(0);

  if (!matchesGitCommand(cmd, WRITE_PATTERNS)) process.exit(0);

  const cwd = hook.cwd || process.cwd();

  if (process.env.DEVOPS_ALLOW_MAIN === '1') process.exit(0);
  if (!isGitRepo(cwd)) process.exit(0);
  if (sentinelActive(cwd)) process.exit(0);

  const branch = currentBranch(cwd);
  if (!branch) process.exit(0);
  if (branch !== 'main' && branch !== 'master') process.exit(0);

  // Without an origin the remote-based fix is not executable — offer the
  // local-only equivalent instead of a command that is guaranteed to fail.
  const remote = hasRemote(cwd);
  const rule = remote
    ? `Never commit/merge/push directly on ${branch}. Work on a branch derived from origin/${branch} and land via /do-ship.`
    : `Never commit directly on ${branch}. Work on a feature branch and land it via /do-ship.`;
  const top = gitOut(cwd, ['rev-parse', '--show-toplevel']);
  const fix = branchFix({
    branch,
    remote,
    // Unknown top level → treat as the shared main checkout: the safe remedy.
    mainCheckout: !(top && isLinkedWorktree(top)),
    subagent: Boolean(hook.agent_id),
  });

  process.stderr.write(
    `[pre.main.guard] BLOCKED: Write operation on local '${branch}' is not allowed.\n` +
    `[pre.main.guard] Rule: ${rule}\n` +
    fix.map(l => `[pre.main.guard] ${l}\n`).join('') +
    `[pre.main.guard] ${BYPASS}\n`
  );
  process.exit(2);
});
