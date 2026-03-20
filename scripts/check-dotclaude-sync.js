#!/usr/bin/env node
/**
 * Check if tracked dotclaude files in ~/.claude/ have drifted from the dotclaude repo.
 * Runs as a SessionStart hook — outputs a warning if files are out of sync or
 * if the repo has uncommitted/unpushed changes.
 *
 * Also checks any git repo the current session is in for stale changes
 * (uncommitted or unpushed work with no active worktree sessions).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const REPO_PATH_FILE = path.join(CLAUDE_HOME, 'scripts', 'dotclaude-repo-path');

// Files tracked in dotclaude repo (relative to repo root → relative to ~/.claude/)
const TRACKED_FILES = [
  'CLAUDE.md',
  'commands/refresh-usage.md',
  'skills/commit/SKILL.md',
  'skills/debug/SKILL.md',
  'skills/deep-research/SKILL.md',
  'skills/explain/SKILL.md',
  'skills/youtube-transcript/SKILL.md',
  'scripts/startup-summary.js',
  'scripts/precheck-cost.js',
  'scripts/scrape-usage.js',
  'scripts/check-dotclaude-sync.js',
  'plugins/blocklist.json'
];

function getRepoPath() {
  try {
    return fs.readFileSync(REPO_PATH_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

function filesIdentical(a, b) {
  try {
    return fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
  } catch {
    return false;
  }
}

function gitStatus(repoDir) {
  try {
    const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8', timeout: 5000 });
    return status.trim();
  } catch {
    return null;
  }
}

function gitUnpushed(repoDir) {
  try {
    const result = execSync('git log @{u}..HEAD --oneline 2>/dev/null', { cwd: repoDir, encoding: 'utf8', timeout: 5000 });
    return result.trim();
  } catch {
    return '';
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const repoPath = getRepoPath();
if (!repoPath || !fs.existsSync(repoPath)) {
  // No repo configured — silently skip
  process.exit(0);
}

const warnings = [];

// 1. Check for file drift: ~/.claude/ files differ from repo
const drifted = [];
for (const rel of TRACKED_FILES) {
  const liveFile = path.join(CLAUDE_HOME, rel);
  const repoFile = path.join(repoPath, rel);
  if (fs.existsSync(liveFile) && fs.existsSync(repoFile)) {
    if (!filesIdentical(liveFile, repoFile)) {
      drifted.push(rel);
    }
  } else if (fs.existsSync(liveFile) && !fs.existsSync(repoFile)) {
    // New file in ~/.claude/ not yet in repo
    drifted.push(rel + ' (new)');
  }
}

if (drifted.length > 0) {
  warnings.push(`Global config files changed since last sync:`);
  drifted.forEach(f => warnings.push(`  - ${f}`));
  warnings.push(`Run /ship-dotclaude to commit and push these changes.`);
}

// 2. Check dotclaude repo for uncommitted changes
const status = gitStatus(repoPath);
if (status) {
  warnings.push(`dotclaude repo has uncommitted changes:`);
  status.split('\n').slice(0, 5).forEach(l => warnings.push(`  ${l}`));
  warnings.push(`Run /ship-dotclaude to commit and push.`);
}

// 3. Check dotclaude repo for unpushed commits
const unpushed = gitUnpushed(repoPath);
if (unpushed) {
  warnings.push(`dotclaude repo has unpushed commits:`);
  unpushed.split('\n').slice(0, 3).forEach(l => warnings.push(`  ${l}`));
  warnings.push(`Run /ship-dotclaude to push.`);
}

// 4. Check current project repo for stale changes (if not dotclaude itself)
const cwd = process.cwd();
if (cwd !== repoPath) {
  try {
    const projectRoot = execSync('git rev-parse --show-toplevel 2>/dev/null', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    if (projectRoot) {
      const projStatus = gitStatus(projectRoot);
      const projUnpushed = gitUnpushed(projectRoot);
      // Check if there are active worktree sessions for this project
      const worktreesDir = path.join(projectRoot, '.claude', 'worktrees');
      const hasActiveWorktrees = fs.existsSync(worktreesDir) &&
        fs.readdirSync(worktreesDir).length > 0;

      if (!hasActiveWorktrees) {
        if (projStatus) {
          warnings.push(`Project ${path.basename(projectRoot)} has uncommitted changes.`);
        }
        if (projUnpushed) {
          warnings.push(`Project ${path.basename(projectRoot)} has unpushed commits.`);
        }
      }
    }
  } catch {}
}

// Output warnings
if (warnings.length > 0) {
  console.error('');
  console.error('dotclaude sync check:');
  console.error('─'.repeat(50));
  warnings.forEach(w => console.error(w));
  console.error('─'.repeat(50));
  console.error('');
}

process.exit(0);
