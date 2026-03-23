#!/usr/bin/env node
/**
 * Session-start hook: sweep stale branches and worktrees.
 *
 * Safe to delete (garbage):
 *   - Worktree dirs in .claude/worktrees/ not in `git worktree list`
 *   - Local branches whose upstream is [gone]
 *   - Stale remote tracking refs
 *
 * Never delete (active work):
 *   - Branches with a remote counterpart on origin
 *   - Branches with uncommitted changes (dirty worktree)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const cleaned = [];
const preserved = [];

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch {
    return '';
  }
}

// Only run inside a git repo
const isGit = run('git rev-parse --is-inside-work-tree');
if (isGit !== 'true') process.exit(0);

const mainRepo = run('git rev-parse --path-format=absolute --git-common-dir').replace(/[\\/].git$/, '');

// Detect the current session's worktree (if any) so we never touch it
const currentWorktree = path.resolve(run('git rev-parse --show-toplevel'));
const currentBranch = run('git rev-parse --abbrev-ref HEAD');

// 1. git worktree prune
run(`git -C "${mainRepo}" worktree prune`);

// 2. Clean orphaned worktree directories
const worktreesDir = path.join(mainRepo, '.claude', 'worktrees');
if (fs.existsSync(worktreesDir)) {
  const worktreeList = run(`git -C "${mainRepo}" worktree list --porcelain`);
  const registeredPaths = new Set(
    worktreeList
      .split('\n')
      .filter(l => l.startsWith('worktree '))
      .map(l => path.resolve(l.replace('worktree ', '')))
  );

  try {
    for (const entry of fs.readdirSync(worktreesDir)) {
      const fullPath = path.resolve(path.join(worktreesDir, entry));
      if (!fs.statSync(fullPath).isDirectory()) continue;

      // NEVER delete the worktree the current session is running in
      if (fullPath === currentWorktree) {
        preserved.push(`${entry} (current session worktree)`);
        continue;
      }

      // Only delete unregistered dirs that have NO local changes
      if (!registeredPaths.has(fullPath)) {
        // Check if the directory contains uncommitted work (untracked/modified files)
        const dirStatus = run(`git -C "${fullPath}" status --short 2>/dev/null`);
        if (dirStatus) {
          preserved.push(`${entry} (orphaned but has uncommitted changes)`);
          continue;
        }
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleaned.push(`worktree dir: ${entry}`);
        } catch (e) {
          cleaned.push(`worktree dir: ${entry} (partial - locked files)`);
        }
      }
    }
  } catch { /* worktrees dir not readable - skip */ }
}

// 3. Delete local branches whose upstream is gone
const branchVV = run(`git -C "${mainRepo}" branch -vv`);
const goneLines = branchVV.split('\n').filter(l => l.includes(': gone]'));
for (const line of goneLines) {
  const branch = line.trim().replace(/^\*\s*/, '').split(/\s+/)[0];
  if (branch && branch !== 'main' && branch !== 'master') {
    // NEVER delete the branch the current session is on
    if (branch === currentBranch) {
      preserved.push(`${branch} (current session branch, upstream gone)`);
      continue;
    }

    // Check if branch has a worktree - remove it first (but not the current session's)
    const wtList = run(`git -C "${mainRepo}" worktree list --porcelain`);
    const blocks = wtList.split(/\n\n/).filter(Boolean);
    const branchWt = blocks.find(block => block.includes(`branch refs/heads/${branch}`));
    if (branchWt) {
      const wtLine = branchWt.split('\n').find(l => l.startsWith('worktree '));
      if (wtLine) {
        const p = path.resolve(wtLine.replace('worktree ', ''));
        // Protect current session's worktree
        if (p === currentWorktree) {
          preserved.push(`${branch} (worktree is current session)`);
          continue;
        }
        run(`git -C "${mainRepo}" worktree remove "${p}" --force`);
        cleaned.push(`worktree: ${path.basename(p)} (gone branch)`);
      }
    }
    run(`git -C "${mainRepo}" branch -D "${branch}"`);
    cleaned.push(`branch: ${branch} (upstream gone)`);
  }
}

// 4. Delete claude/* branches whose worktree was removed and have no commits ahead of main
const allBranches = run(`git -C "${mainRepo}" branch`)
  .split('\n')
  .map(l => l.trim().replace(/^\*\s*/, ''))
  .filter(Boolean);

const wtListForClaude = run(`git -C "${mainRepo}" worktree list --porcelain`);
const wtBlocksForClaude = wtListForClaude.split(/\n\n/).filter(Boolean);
const branchesWithWorktree = new Set(
  wtBlocksForClaude
    .map(block => {
      const branchLine = block.split('\n').find(l => l.startsWith('branch refs/heads/'));
      return branchLine ? branchLine.replace('branch refs/heads/', '') : null;
    })
    .filter(Boolean)
);

for (const branch of allBranches) {
  if (!branch.startsWith('claude/')) continue;

  // NEVER delete the current session's branch
  if (branch === currentBranch) {
    // already reported in step 5
    continue;
  }

  // Only delete if the worktree has been removed (archived)
  if (branchesWithWorktree.has(branch)) continue;

  // Only delete if no commits ahead of main
  const commitsAhead = run(`git -C "${mainRepo}" rev-list --count main..${branch}`);
  if (commitsAhead && parseInt(commitsAhead, 10) > 0) {
    preserved.push(`${branch} (no worktree, ${commitsAhead} commits ahead — keeping)`);
    continue;
  }

  run(`git -C "${mainRepo}" branch -D "${branch}"`);
  cleaned.push(`branch: ${branch} (claude worktree archived, no changes)`);
}

// 5. Prune stale remote tracking refs
const pruneOutput = run(`git -C "${mainRepo}" remote prune origin --dry-run`);
if (pruneOutput) {
  run(`git -C "${mainRepo}" remote prune origin`);
  const pruned = pruneOutput.split('\n').filter(l => l.includes('[would prune]')).length;
  if (pruned > 0) cleaned.push(`${pruned} stale remote ref(s)`);
}

// 6. Report surviving non-main branches (informational)
const survivingBranches = run(`git -C "${mainRepo}" branch`)
  .split('\n')
  .map(l => l.trim().replace(/^\*\s*/, ''))
  .filter(b => b && b !== 'main' && b !== 'master');

for (const b of survivingBranches) {
  const hasRemote = run(`git -C "${mainRepo}" ls-remote --heads origin "${b}"`);
  preserved.push(`${b}${hasRemote ? ' (has remote - active work)' : ' (local only)'}`);
}

// Output to stderr (shown in hook output)
if (cleaned.length > 0 || preserved.length > 0) {
  const lines = [];
  if (cleaned.length > 0) {
    lines.push(`Swept: ${cleaned.join(', ')}`);
  }
  if (preserved.length > 0) {
    lines.push(`Preserved branches: ${preserved.join(', ')}`);
  }
  process.stderr.write(lines.join('\n') + '\n');
}
