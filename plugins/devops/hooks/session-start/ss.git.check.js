#!/usr/bin/env node
/**
 * @hook ss.git.check
 * @version 0.4.0
 * @event SessionStart
 * @plugin devops
 * @description Check for stale changes AND workspace setup issues at session
 *   start. Filters out active worktree branches to avoid false positives.
 *   Silent when clean. Outputs structured CTAs when issues are found.
 *
 *   Workspace check (current repo only):
 *     - On main/master without worktree → high-priority warning, suggests
 *       worktree + feature branch (or ship-first if uncommitted exist).
 *     - Not in worktree on feature branch → mild suggestion to isolate.
 *     - In worktree on main → silent (prompt.worktree.branch-guard handles).
 *
 *   Bypass for workspace check (stale check still runs):
 *     - DEVOPS_ALLOW_MAIN=1 in environment
 *     - .claude/.ship-in-progress sentinel exists (ship pipeline active)
 */

require('../lib/plugin-guard');
const { isActive: sentinelActive } = require('../lib/ship-sentinel');

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

/**
 * Detect whether `dir` is a linked worktree (not the main working tree).
 */
function isLinkedWorktree(dir) {
  const gitDir = run('git rev-parse --git-dir', dir);
  const commonDir = run('git rev-parse --git-common-dir', dir);
  if (!gitDir || !commonDir) return false;
  return path.resolve(dir, gitDir) !== path.resolve(dir, commonDir);
}

function checkRepo(dir) {
  const issues = [];
  const inWorktree = isLinkedWorktree(dir);
  const worktreeBranches = getWorktreeBranches(dir);

  // Fetch remote refs so unpushed detection is accurate.
  // Without this, commits already merged via GitHub PRs appear "unpushed"
  // because local refs/remotes/* are stale.
  run('git fetch --quiet', dir);

  // Uncommitted files (scoped to this worktree automatically by git)
  const status = run('git status --porcelain', dir);
  if (status) {
    const lines = status.split('\n').filter(Boolean);
    issues.push({
      type: 'uncommitted',
      count: lines.length,
      label: `${lines.length} uncommitted file(s)`,
    });
  }

  // Unpushed commits
  // In a linked worktree: only check the current branch (HEAD), not --branches.
  // --branches is repo-wide and shows all local branches' unpushed commits,
  // which are irrelevant noise in a worktree context.
  const logTarget = inWorktree ? 'HEAD' : '--branches';
  const unpushed = run(`git log ${logTarget} --not --remotes --oneline --decorate`, dir);
  if (unpushed) {
    const lines = unpushed.split('\n').filter(Boolean);
    if (inWorktree) {
      // In a worktree all returned commits belong to the current branch
      if (lines.length > 0) {
        issues.push({
          type: 'unpushed',
          count: lines.length,
          label: `${lines.length} unpushed commit(s)`,
        });
      }
    } else {
      // In main working tree: exclude active worktree branches as before
      const staleLines = lines.filter(line => {
        const branchMatch = line.match(/\(([^)]+)\)/);
        if (!branchMatch) return true;
        const refs = branchMatch[1].split(',').map(r => r.trim().replace(/^HEAD -> /, ''));
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
  }

  // Stashes — repo-wide, skip in worktree context (not actionable there)
  if (!inWorktree) {
    const stashes = run('git stash list', dir);
    if (stashes) {
      const lines = stashes.split('\n').filter(Boolean);
      issues.push({
        type: 'stash',
        count: lines.length,
        label: `${lines.length} stash entr${lines.length === 1 ? 'y' : 'ies'}`,
      });
    }
  }

  return issues;
}

function currentBranch(dir) {
  return run('git symbolic-ref --quiet --short HEAD', dir);
}

function checkWorkspace(dir) {
  if (process.env.DEVOPS_ALLOW_MAIN === '1') return null;
  if (sentinelActive(dir)) return null;
  const branch = currentBranch(dir);
  if (!branch) return null;
  const inWorktree = isLinkedWorktree(dir);
  if (inWorktree) return null;
  const onMain = branch === 'main' || branch === 'master';
  return {
    type: onMain ? 'on-main-no-worktree' : 'no-worktree',
    branch,
    severity: onMain ? 'high' : 'low',
  };
}

// ---------------------------------------------------------------------------
// Cleanup stale session temp files (older than 24h)
// ---------------------------------------------------------------------------
const os = require('os');
try {
  const tmpDir = os.tmpdir();
  const PREFIX = 'dotclaude-devops-';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  const entries = fs.readdirSync(tmpDir).filter(f => f.startsWith(PREFIX));
  for (const entry of entries) {
    try {
      const full = path.join(tmpDir, entry);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(full);
      }
    } catch {}
  }
} catch {}

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
    dirty.push({ label: repo.label, dir: repo.dir, issues });
  }
}

const workspace = checkWorkspace(cwd);

if (dirty.length === 0 && !workspace) {
  process.exit(0);
}

// Build structured output with CTAs
const out = [];

if (workspace) {
  const stagedTypes = new Set(['uncommitted', 'unpushed']);
  const currentDirty = dirty.find(d => d.dir === cwd);
  const pendingIssues = currentDirty
    ? currentDirty.issues.filter(i => stagedTypes.has(i.type))
    : [];
  const hasChanges = pendingIssues.length > 0;

  out.push('Workspace check at session start. Show this summary AS-IS and call AskUserQuestion as the FIRST action of this turn:');
  out.push('');
  out.push('**Workspace setup**');
  if (workspace.severity === 'high') {
    out.push(`- ⚠ On \`${workspace.branch}\` in repo root (not in a worktree) — write ops will be blocked by pre.main.guard / pre.edit.branch`);
  } else {
    out.push(`- On \`${workspace.branch}\` in repo root (not in a worktree)`);
  }
  if (hasChanges) {
    out.push(`- Pending: ${pendingIssues.map(i => i.label).join(', ')}`);
  }
  out.push('');
  out.push('Ask the user (in their language) via AskUserQuestion. Suggested options:');
  out.push('  - Worktree + Feature-Branch anlegen (recommended)');
  if (hasChanges) {
    out.push(`  - Erst Changes auf \`${workspace.branch}\` shippen, dann Worktree anlegen`);
    out.push('  - Changes mitnehmen in neuen Worktree (git stash → create → pop)');
  }
  out.push('  - Hier bleiben (bypass: DEVOPS_ALLOW_MAIN=1 für diese Session)');
  out.push('');
  out.push('Resolution per option:');
  out.push('  - Worktree+branch: `git worktree add ../<feature> -b claude/<feature>` then cd there');
  out.push('  - Ship-first: invoke /devops-ship, then create worktree');
  out.push('  - Take-along: `git stash`, create worktree, `cd <worktree>`, `git stash pop`');
  out.push('  - Stay: set env `DEVOPS_ALLOW_MAIN=1` for this session');
  out.push('');
}

const staleHeaderShown = !workspace && dirty.length > 0;
if (staleHeaderShown) {
  out.push('Stale changes found at session start. Show the user this summary as-is:');
  out.push('');
}

for (const r of dirty) {
  const lines = [];
  for (const issue of r.issues) {
    if (workspace && r.dir === cwd
        && (issue.type === 'uncommitted' || issue.type === 'unpushed')) {
      continue;
    }
    switch (issue.type) {
      case 'uncommitted':
      case 'unpushed':
        lines.push(`- ${issue.label} → run \`/devops-ship\` to commit, push & create PR`);
        break;
      case 'stash':
        lines.push(`- ${issue.label} → review with \`git stash list\`, then \`git stash pop\` or \`git stash drop\``);
        break;
    }
  }
  if (lines.length > 0) {
    const header = workspace && r.dir === cwd
      ? 'Additional in current repo:'
      : `**${r.label}**`;
    out.push(header);
    out.push(...lines);
    out.push('');
  }
}

if (out.length === 0) process.exit(0);

process.stdout.write(out.join('\n'));
