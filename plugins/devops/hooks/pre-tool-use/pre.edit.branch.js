#!/usr/bin/env node
/**
 * @hook pre.edit.branch
 * @version 0.1.1
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
 *     - Target path is outside the repo working tree (e.g. ~/.claude/**)
 *
 *   Every git probe goes through lib/git-timeout.js's gitOut — GIT_TIMEOUT_MS
 *   per call; before, these calls had no timeout at all. A failed or hung
 *   probe reads as "not a repo" / "no branch" / "no origin", as a failure
 *   always did.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { gitOut } = require('../lib/git-timeout');
const { isActive: sentinelActive } = require('../lib/ship-sentinel');

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

function isInside(repoRoot, target) {
  if (!repoRoot || !target) return false;
  try {
    const realRoot = canonicalize(repoRoot) || repoRoot;
    const absTarget = path.resolve(target);
    // Target may not exist yet (Write creates new files) — canonicalize the
    // closest existing ancestor instead, so a symlinked parent is resolved.
    let probe = absTarget;
    let realTarget = canonicalize(probe);
    while (!realTarget && probe !== path.dirname(probe)) {
      probe = path.dirname(probe);
      realTarget = canonicalize(probe);
      if (realTarget) {
        realTarget = path.join(realTarget, path.relative(probe, absTarget));
        break;
      }
    }
    if (!realTarget) realTarget = absTarget;
    const rel = path.relative(realRoot, realTarget);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
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

  const toolName = hook.tool_name || '';
  if (!['Edit', 'Write', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const target = extractTargetPath(toolName, hook.tool_input || {});
  if (!target) process.exit(0);

  const cwd = hook.cwd || process.cwd();

  if (process.env.DEVOPS_ALLOW_MAIN === '1') process.exit(0);

  const repoRoot = gitTopLevel(cwd);
  if (!repoRoot) process.exit(0);

  if (!isInside(repoRoot, target)) process.exit(0);

  if (sentinelActive(repoRoot)) process.exit(0);

  const branch = currentBranch(repoRoot);
  if (!branch) process.exit(0);
  if (branch !== 'main' && branch !== 'master') process.exit(0);

  const remote = hasRemote(repoRoot);
  const rule = remote
    ? `New work always happens on a branch derived from origin/${branch}.`
    : `New work always happens on a feature branch.`;
  const fix = remote
    ? `git fetch origin && git switch -c <feat/topic> origin/${branch}  — then retry the edit.`
    : `git switch -c <feat/topic>  — no origin remote, so this branches from local ${branch}. Then retry the edit.`;

  process.stderr.write(
    `BLOCKED: Editing files on local '${branch}' is not allowed.\n` +
    `Rule: ${rule}\n` +
    `Fix: ${fix}\n` +
    `Bypass (only if the user explicitly asked to edit ${branch}): set env DEVOPS_ALLOW_MAIN=1 for this single action.\n`
  );
  process.exit(2);
});
