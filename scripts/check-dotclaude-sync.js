#!/usr/bin/env node
/**
 * Bidirectional sync check for dotclaude repo ↔ ~/.claude/ files.
 * Runs as a SessionStart hook.
 *
 * Direction 1 — Repo → Local (auto-update):
 *   If the repo has newer commits than last sync, pull and copy tracked files
 *   to ~/.claude/. If a file was also changed locally (conflict), warn instead
 *   of overwriting.
 *
 * Direction 2 — Local → Repo (warn):
 *   If ~/.claude/ files differ from repo, warn to run /ship-dotclaude.
 *
 * Also checks the current project repo for stale uncommitted/unpushed work.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const REPO_PATH_FILE = path.join(CLAUDE_HOME, 'scripts', 'dotclaude-repo-path');
const SYNC_STATE_FILE = path.join(CLAUDE_HOME, 'scripts', '.dotclaude-sync-state.json');

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
  'scripts/sweep-branches.js',
  'plugins/blocklist.json'
];

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000, shell: true, stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch {
    return '';
  }
}

function getRepoPath() {
  try {
    let p = fs.readFileSync(REPO_PATH_FILE, 'utf8').trim();
    if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
      p = p[1].toUpperCase() + ':' + p.slice(2).replace(/\//g, '\\');
    }
    return p;
  } catch {
    return null;
  }
}

function readFileNormalized(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

function filesIdentical(a, b) {
  const contentA = readFileNormalized(a);
  const contentB = readFileNormalized(b);
  if (contentA === null || contentB === null) return false;
  return contentA === contentB;
}

function readSyncState() {
  try {
    return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
  } catch {
    return { lastPulledCommit: null };
  }
}

function writeSyncState(state) {
  try {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  } catch { /* ignore write errors */ }
}

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

// ── Main ────────────────────────────────────────────────────────────────────

const repoPath = getRepoPath();
if (!repoPath || !fs.existsSync(repoPath)) {
  process.exit(0);
}

const warnings = [];
const updates = [];
const conflicts = [];

// ─── Direction 1: Repo → Local (auto-update) ───────────────────────────────

// Fetch latest from remote (fast, no merge)
run(`git -C "${repoPath}" fetch origin main --quiet`);

// Check if remote has new commits since our last pull
const localHead = run(`git -C "${repoPath}" rev-parse HEAD`);
const remoteHead = run(`git -C "${repoPath}" rev-parse origin/main`);
const syncState = readSyncState();

if (remoteHead && remoteHead !== localHead) {
  // Remote is ahead of local repo — pull first
  const pullResult = run(`git -C "${repoPath}" pull origin main --ff-only`);
  if (pullResult.includes('Already up to date') || pullResult.includes('Fast-forward') || pullResult) {
    // Pull succeeded or was already up to date
  } else {
    warnings.push('dotclaude repo: git pull failed — local repo may have diverged.');
  }
}

// Now compare repo files against ~/.claude/ files
// Determine which files the repo has that are newer than local
const currentRepoHead = run(`git -C "${repoPath}" rev-parse HEAD`);

if (currentRepoHead && currentRepoHead !== syncState.lastPulledCommit) {
  // Repo has changed since last sync — check each tracked file
  for (const rel of TRACKED_FILES) {
    const repoFile = path.join(repoPath, rel);
    const liveFile = path.join(CLAUDE_HOME, rel);

    if (!fs.existsSync(repoFile)) continue;

    if (!fs.existsSync(liveFile)) {
      // Repo has a file that local doesn't — copy it
      copyFile(repoFile, liveFile);
      updates.push(rel + ' (new from repo)');
      continue;
    }

    if (filesIdentical(repoFile, liveFile)) continue;

    // Files differ — was repo or local changed?
    // Check if the repo file changed in commits since last sync
    const lastSyncCommit = syncState.lastPulledCommit || '';
    let repoFileChanged = true;
    if (lastSyncCommit) {
      const repoChangedFiles = run(`git -C "${repoPath}" diff --name-only ${lastSyncCommit}..HEAD`);
      repoFileChanged = repoChangedFiles.split('\n').includes(rel);
    }

    if (!repoFileChanged) {
      // Repo file didn't change — local was modified → local→repo drift (Direction 2)
      // Don't touch it, warn below in Direction 2
      continue;
    }

    // Repo file changed. Check if local also changed (conflict).
    // We detect local changes by comparing local against the LAST synced repo version.
    // If we have the last synced commit, check what repo looked like then.
    let localAlsoChanged = false;
    if (lastSyncCommit) {
      const oldRepoContent = run(`git -C "${repoPath}" show ${lastSyncCommit}:${rel} 2>/dev/null`);
      const liveContent = readFileNormalized(liveFile);
      if (oldRepoContent && liveContent !== null) {
        // If local differs from the old repo version, local was also modified
        localAlsoChanged = liveContent !== oldRepoContent.replace(/\r\n/g, '\n');
      }
    }

    if (localAlsoChanged) {
      // Both repo and local changed — conflict, don't overwrite
      conflicts.push(rel);
    } else {
      // Only repo changed — safe to auto-update
      copyFile(repoFile, liveFile);
      updates.push(rel);
    }
  }

  // Update sync state
  writeSyncState({ lastPulledCommit: currentRepoHead, lastSyncedAt: new Date().toISOString() });
}

// Report repo→local updates
if (updates.length > 0) {
  warnings.push(`Auto-updated from dotclaude repo:`);
  updates.forEach(f => warnings.push(`  ✅ ${f}`));
}
if (conflicts.length > 0) {
  warnings.push(`Conflicts (both local and repo changed — manual decision needed):`);
  conflicts.forEach(f => warnings.push(`  ⚠️ ${f}`));
  warnings.push(`Review these files and decide: keep local (then /ship-dotclaude) or accept repo version.`);
}

// ─── Direction 2: Local → Repo (warn to ship) ──────────────────────────────

const drifted = [];
for (const rel of TRACKED_FILES) {
  const liveFile = path.join(CLAUDE_HOME, rel);
  const repoFile = path.join(repoPath, rel);
  if (fs.existsSync(liveFile) && fs.existsSync(repoFile)) {
    if (!filesIdentical(liveFile, repoFile)) {
      drifted.push(rel);
    }
  } else if (fs.existsSync(liveFile) && !fs.existsSync(repoFile)) {
    drifted.push(rel + ' (new)');
  }
}

if (drifted.length > 0) {
  warnings.push(`Local config files differ from dotclaude repo:`);
  drifted.forEach(f => warnings.push(`  - ${f}`));
  warnings.push(`Run /ship-dotclaude to sync.`);
}

// ─── Repo health checks ────────────────────────────────────────────────────

const repoStatus = run(`git -C "${repoPath}" status --porcelain`);
if (repoStatus) {
  warnings.push(`dotclaude repo has uncommitted changes:`);
  repoStatus.split('\n').slice(0, 5).forEach(l => warnings.push(`  ${l}`));
  warnings.push(`Run /ship-dotclaude to commit and push.`);
}

const unpushed = run(`git -C "${repoPath}" log @{u}..HEAD --oneline`);
if (unpushed) {
  warnings.push(`dotclaude repo has unpushed commits:`);
  unpushed.split('\n').slice(0, 3).forEach(l => warnings.push(`  ${l}`));
  warnings.push(`Run /ship-dotclaude to push.`);
}

// ─── Current project repo health ────────────────────────────────────────────

const cwd = process.cwd();
if (cwd !== repoPath) {
  try {
    const projectRoot = run('git rev-parse --show-toplevel', { cwd });
    if (projectRoot) {
      const projStatus = run('git status --porcelain', { cwd: projectRoot });
      const projUnpushed = run('git log @{u}..HEAD --oneline', { cwd: projectRoot });
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

// ─── Output ─────────────────────────────────────────────────────────────────

if (warnings.length > 0) {
  console.error('');
  console.error('dotclaude sync check:');
  console.error('─'.repeat(50));
  warnings.forEach(w => console.error(w));
  console.error('─'.repeat(50));
  console.error('');
}

process.exit(0);
