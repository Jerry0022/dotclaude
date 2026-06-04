#!/usr/bin/env node
/**
 * @hook prompt.worktree.branch-guard
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Prevents working without a dedicated branch inside a linked
 *   worktree. Only fires when the session is inside a git worktree (.git is a
 *   file, not a directory). Outputs a BLOCKING instruction telling Claude to
 *   create a new branch first when the worktree sits on:
 *     - main or master (shared mainline), OR
 *     - a detached HEAD (no branch at all — `--abbrev-ref HEAD` returns "HEAD").
 *   Does nothing if not in a worktree — the user intentionally works on main.
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

// Only run in a git repo
if (git('rev-parse --is-inside-work-tree') !== 'true') {
  process.exit(0);
}

// Check if this is a linked worktree (not the main working tree).
// In a linked worktree, --git-dir and --git-common-dir resolve to
// different paths (git-dir points into .git/worktrees/<name>).
const gitDir = git('rev-parse --git-dir');
const commonDir = git('rev-parse --git-common-dir');
if (!gitDir || !commonDir) process.exit(0);

const isLinkedWorktree =
  path.resolve(cwd, gitDir) !== path.resolve(cwd, commonDir);

if (!isLinkedWorktree) {
  // Not in a worktree — user intentionally works on main. Do nothing.
  process.exit(0);
}

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch) process.exit(0);

// "HEAD" from --abbrev-ref means a detached HEAD: the worktree is on a
// commit/tag, not a branch — so commits would be unreachable once HEAD moves.
const isDetached = branch === 'HEAD';
const isMainline = branch === 'main' || branch === 'master';

if (isMainline || isDetached) {
  const worktreeName = path.basename(cwd);
  const where = isDetached
    ? 'in a detached HEAD (no branch)'
    : `on branch "${branch}"`;
  process.stdout.write(
    `BLOCKING — You are in a worktree but ${where}. ` +
    `Create a new branch BEFORE doing any work: ` +
    `git checkout -b claude/${worktreeName}`
  );
}
