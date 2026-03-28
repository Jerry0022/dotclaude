#!/usr/bin/env node
/**
 * @hook ss.branches.check
 * @version 0.2.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Check for stale uncommitted/unpushed changes at session start.
 *   Filters out active worktree branches to avoid false positives.
 *   Silent when clean. Outputs structured CTAs when issues are found.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

/**
 * Get branches currently checked out in worktrees (excluding main working tree).
 */
function getWorktreeBranches(dir) {
  const raw = run('git worktree list --porcelain', dir);
  if (!raw) return new Set();

  const branches = new Set();
  let isMain = true; // first worktree entry is the main working tree
  for (const line of raw.split('\n')) {
    const m = line.match(/^branch\s+refs\/heads\/(.+)/);
    if (m) {
      if (!isMain) branches.add(m[1]);
      isMain = false;
    }
    if (line === '') isMain = false; // blank line separates worktree entries
  }
  return branches;
}

function checkRepo(dir) {
  const issues = [];
  const worktreeBranches = getWorktreeBranches(dir);

  // Uncommitted files (only on current branch, not affected by worktrees)
  const status = run('git status --porcelain', dir);
  if (status) {
    const lines = status.split('\n').filter(Boolean);
    issues.push({
      type: 'uncommitted',
      count: lines.length,
      label: `${lines.length} uncommitted file(s)`,
    });
  }

  // Unpushed commits — exclude active worktree branches
  const unpushed = run('git log --branches --not --remotes --oneline --decorate', dir);
  if (unpushed) {
    const lines = unpushed.split('\n').filter(Boolean);
    const staleLines = lines.filter(line => {
      // Lines look like: abc1234 (branch-name) message  or  abc1234 message
      const branchMatch = line.match(/\(([^)]+)\)/);
      if (!branchMatch) return true; // no decoration — include it
      const refs = branchMatch[1].split(',').map(r => r.trim().replace(/^HEAD -> /, ''));
      // Exclude if ALL refs belong to active worktrees
      return !refs.every(ref => worktreeBranches.has(ref));
    });
    if (staleLines.length > 0) {
      issues.push({
        type: 'unpushed',
        count: staleLines.length,
        label: `${staleLines.length} unpushed commit(s)`,
      });
    }
  }

  // Stashes
  const stashes = run('git stash list', dir);
  if (stashes) {
    const lines = stashes.split('\n').filter(Boolean);
    issues.push({
      type: 'stash',
      count: lines.length,
      label: `${lines.length} stash entr${lines.length === 1 ? 'y' : 'ies'}`,
    });
  }

  return issues;
}

// Determine repos to check
const cwd = process.cwd();
const repos = [{ label: 'current repo', dir: cwd }];

// Optional additional repos from reference.md
const refPath = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude', 'scheduled-tasks', 'stale-changes-check', 'reference.md'
);
if (fs.existsSync(refPath)) {
  const content = fs.readFileSync(refPath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(/^-\s+(.+)/);
    if (!m) continue;
    const raw = m[1].trim().replace(/^~/, process.env.HOME || process.env.USERPROFILE || '~');
    const resolved = path.resolve(raw);
    if (resolved !== cwd && fs.existsSync(resolved)) {
      repos.push({ label: path.basename(resolved), dir: resolved });
    }
  }
}

// Collect issues
const dirty = [];
for (const repo of repos) {
  const issues = checkRepo(repo.dir);
  if (issues.length > 0) {
    dirty.push({ label: repo.label, issues });
  }
}

if (dirty.length === 0) {
  process.exit(0);
}

// Build structured output with CTAs
const out = ['Stale changes found at session start. Show the user this summary as-is:'];
out.push('');
for (const r of dirty) {
  out.push(`**${r.label}**`);
  for (const issue of r.issues) {
    switch (issue.type) {
      case 'uncommitted':
      case 'unpushed':
        out.push(`- ${issue.label} → run \`/ship\` to commit, push & create PR`);
        break;
      case 'stash':
        out.push(`- ${issue.label} → review with \`git stash list\`, then \`git stash pop\` or \`git stash drop\``);
        break;
    }
  }
  out.push('');
}

process.stdout.write(out.join('\n'));
