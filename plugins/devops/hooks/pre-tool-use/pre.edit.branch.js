#!/usr/bin/env node
/**
 * @hook pre.edit.branch
 * @version 0.2.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Edit|Write|NotebookEdit
 * @description Prevent Edit/Write tool calls while HEAD is on local main/master.
 *
 *   Policy: new work always happens on a branch derived from origin/main.
 *   Editing files directly on main is almost always an accident.
 *
 *   Bypass conditions (any one of them → exit 0):
 *     - Not inside a git repo
 *     - HEAD is NOT main/master
 *     - Sentinel file .claude/.ship-in-progress exists (ship pipeline active)
 *     - DEVOPS_ALLOW_MAIN=1 in environment
 *     - Target path is outside this repository (e.g. ~/.claude/**, another repo)
 *
 *   The branch checked is the one of the work tree the TARGET lives in, not
 *   the cwd's: a session that moved into its own worktree (EnterWorktree)
 *   may still hold paths into the main checkout, and the cwd-based check let
 *   exactly those edits land on the shared main. A target in another work
 *   tree of the same repository is checked against that tree's branch; a
 *   target in a different repository stays out of scope.
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

const fs = require('fs');
const path = require('path');

// A lib that fails to load (half-written during a plugin update, version skew)
// makes this hook a silent no-op instead of a hook error on every edit
// (AUD-028).
let gitOut, sentinelActive, isLinkedWorktree, findRepoRoot, gitCommonDir, samePath, branchFix, ownWorktreeDecided, BYPASS;
try {
  require('../lib/plugin-guard');
  ({ gitOut } = require('../lib/git-timeout'));
  ({ isActive: sentinelActive } = require('../lib/ship-sentinel'));
  ({ isLinkedWorktree, findRepoRoot, gitCommonDir, samePath } = require('../lib/project-root'));
  ({ branchFix, ownWorktreeDecided, BYPASS } = require('../lib/branch-fix'));
} catch (err) {
  // Silent to the user and the model (exit 0), but not traceless: the line
  // lands in the hook log, so a persistent load error can be found (AUD-068).
  process.stderr.write(`[pre.edit.branch] off — a lib failed to load: ${(err && err.message) || err}\n`);
  process.exit(0);
}

function currentBranch(cwd) {
  return gitOut(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

function gitTopLevel(cwd) {
  return gitOut(cwd, ['rev-parse', '--show-toplevel']);
}

/**
 * Does this repo have an `origin` remote?
 *
 * The block stays correct without one, but the suggested fix did not: in a
 * local-only repo `git fetch origin && git switch -c <topic> origin/main`
 * fails on both halves, so an Edit was refused with an unusable remedy.
 */
function hasRemote(cwd) {
  return gitOut(cwd, ['remote', 'get-url', 'origin']) !== null;
}

function extractTargetPath(toolName, input) {
  if (!input) return null;
  if (toolName === 'Edit' || toolName === 'Write') return input.file_path || null;
  if (toolName === 'NotebookEdit') return input.notebook_path || null;
  return null;
}

function canonicalize(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/** Absolute target with its closest existing ancestor canonicalized (Write may create the file). */
function realTargetOf(target) {
  const absTarget = path.resolve(target);
  let probe = absTarget;
  let real = canonicalize(probe);
  while (!real && probe !== path.dirname(probe)) {
    probe = path.dirname(probe);
    real = canonicalize(probe);
    if (real) return { real: path.join(real, path.relative(probe, absTarget)), dir: real };
  }
  return { real: real || absTarget, dir: real ? path.dirname(real) : null };
}

function isInside(root, realTarget) {
  const realRoot = canonicalize(root) || root;
  const rel = path.relative(realRoot, realTarget);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

const real = (p) => (p && (canonicalize(p) || path.resolve(p))) || null;

/**
 * The work-tree root whose branch decides about `target`, or null when the
 * target is outside this repository: the target's own work tree (fs walk, no
 * git spawn), provided it is the cwd's tree or another work tree of the same
 * repository (same git common dir). A nested linked worktree under the main
 * checkout is thereby judged by its own branch, a main-checkout path from a
 * worktree session by main's.
 */
function targetRoot(cwdRoot, target) {
  try {
    const { real: realTarget, dir } = realTargetOf(target);
    const ownRoot = real(dir && findRepoRoot(dir));
    if (!ownRoot) return null;
    const cwdReal = real(cwdRoot);
    if (samePath(ownRoot, cwdReal)) return isInside(cwdReal, realTarget) ? { root: cwdReal, cwdRoot: cwdReal, real: realTarget } : null;
    const a = real(gitCommonDir(cwdReal));
    const b = real(gitCommonDir(ownRoot));
    if (!a || !b || !samePath(a, b)) return null;
    return { root: ownRoot, cwdRoot: cwdReal, real: realTarget };
  } catch {
    return null;
  }
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (!['Edit', 'Write', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const target = extractTargetPath(toolName, hook.tool_input || {});
  if (!target) process.exit(0);

  const cwd = hook.cwd || process.cwd();

  if (process.env.DEVOPS_ALLOW_MAIN === '1') process.exit(0);

  const cwdRoot = gitTopLevel(cwd);
  if (!cwdRoot) process.exit(0);

  const hit = targetRoot(cwdRoot, target);
  if (!hit) process.exit(0);
  const repoRoot = hit.root;

  if (sentinelActive(repoRoot)) process.exit(0);

  const branch = currentBranch(repoRoot);
  if (!branch) process.exit(0);
  if (branch !== 'main' && branch !== 'master') process.exit(0);

  const remote = hasRemote(repoRoot);
  const mainCheckout = !isLinkedWorktree(repoRoot);
  const rule = remote
    ? `New work always happens on a branch derived from origin/${branch}.`
    : `New work always happens on a feature branch.`;
  const fix = branchFix({
    branch,
    remote,
    mainCheckout,
    relPath: path.relative(repoRoot, hit.real),
    subagent: Boolean(hook.agent_id),
    ownWorktree: ownWorktreeDecided(repoRoot),
    // The target lives in ANOTHER work tree of this repo than the session's
    // own — a moved session holding a main-checkout path, or a path inside
    // another session's worktree.
    elsewhere: samePath(repoRoot, hit.cwdRoot)
      ? null
      : { targetRoot: repoRoot, ownRoot: hit.cwdRoot, ownIsWorktree: isLinkedWorktree(hit.cwdRoot) },
  });

  process.stderr.write(
    `BLOCKED: Editing files on local '${branch}' is not allowed.\n` +
    `Rule: ${rule}\n` +
    fix.map(l => `${l}\n`).join('') +
    `${BYPASS}\n`
  );
  process.exit(2);
});
