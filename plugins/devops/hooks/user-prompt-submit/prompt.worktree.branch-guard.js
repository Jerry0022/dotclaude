#!/usr/bin/env node
/**
 * @hook prompt.worktree.branch-guard
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Prevents working on main/master inside a linked worktree.
 *   Only fires when the session is inside a git worktree (.git is a file,
 *   not a directory). If the current branch is main or master, outputs a
 *   BLOCKING instruction telling Claude to create a new branch first.
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

if (branch === 'main' || branch === 'master') {
  const worktreeName = path.basename(cwd);
  process.stdout.write(
    `BLOCKING — You are in a worktree but on branch "${branch}". ` +
    `Create a new branch BEFORE doing any work: ` +
    `git checkout -b claude/${worktreeName}`
  );
}
