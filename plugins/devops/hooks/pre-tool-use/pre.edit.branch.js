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
let gitOut, sentinelActive, isLinkedWorktree, branchFix;
try {
  require('../lib/plugin-guard');
  ({ gitOut } = require('../lib/git-timeout'));
  ({ isActive: sentinelActive } = require('../lib/ship-sentinel'));
  ({ isLinkedWorktree } = require('../lib/project-root'));
  ({ branchFix } = require('../lib/branch-fix'));
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
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function commonDir(dir) {
  const out = gitOut(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return out ? (canonicalize(out) || path.resolve(out)) : null;
}

/**
 * The work-tree root whose branch decides about `target`, or null when the
 * target is outside this repository. The cwd's tree when the target is in it
 * (the common case: no extra git call); otherwise the target's own tree, if
 * that tree belongs to the same repository (same git common dir).
 */
function targetRoot(cwdRoot, target) {
  try {
    const { real, dir } = realTargetOf(target);
    const ownRoot = dir ? gitTopLevel(dir) : null;
    if (!ownRoot) return null;
    const same = (canonicalize(ownRoot) || ownRoot) === (canonicalize(cwdRoot) || cwdRoot);
    if (same) return isInside(cwdRoot, real) ? { root: cwdRoot, real } : null;
    const a = commonDir(cwdRoot);
    if (!a || a !== commonDir(ownRoot)) return null;
    return { root: ownRoot, real };
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
    relPath: path.relative(canonicalize(repoRoot) || repoRoot, hit.real),
    subagent: Boolean(hook.agent_id),
  });

  process.stderr.write(
    `BLOCKED: Editing files on local '${branch}' is not allowed.\n` +
    `Rule: ${rule}\n` +
    fix.map(l => `${l}\n`).join('') +
    `Bypass (only if the user explicitly asked to edit ${branch}): set env DEVOPS_ALLOW_MAIN=1 for this single action.\n`
  );
  process.exit(2);
});
