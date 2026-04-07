#!/usr/bin/env node
/**
 * @hook prompt.git.sync
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Periodic git pull/merge on user prompt — keeps the branch
 *   up-to-date with main AND parent branches during long sessions.
 *   Supports full branch hierarchy: for feat/auth/sub, merges main,
 *   then feat, then feat/auth into the current branch.
 *   Conflict resolution: auto-resolves with --ours before aborting.
 *   Throttled to run at most every 15 minutes.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const THROTTLE_FILE = path.join(os.tmpdir(), `dotclaude-devops-git-sync-${process.ppid}`);
const THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

// Throttle — skip if last sync was recent
try {
  if (fs.existsSync(THROTTLE_FILE)) {
    const lastSync = parseInt(fs.readFileSync(THROTTLE_FILE, 'utf8'), 10);
    if (Date.now() - lastSync < THROTTLE_MS) {
      process.exit(0);
    }
  }
} catch {}

// Update throttle timestamp immediately
try { fs.writeFileSync(THROTTLE_FILE, Date.now().toString()); } catch {}

const cwd = process.cwd();
const MAIN = 'main';

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
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

const remote = git('remote');
if (!remote) process.exit(0);
const origin = remote.split('\n')[0];

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch || branch === MAIN) process.exit(0);

// Build parent chain from branch name hierarchy.
// For "feat/auth/login" → [main, feat, feat/auth]
function getParentChain(branchName) {
  const parts = branchName.split('/');
  const parents = [MAIN];
  for (let i = 1; i < parts.length; i++) {
    parents.push(parts.slice(0, i).join('/'));
  }
  return parents;
}

// Try merging source into HEAD. On conflict, auto-resolve with --ours
// (keep current branch's version). Only abort if resolution fails.
function tryMerge(source) {
  const behind = git(`rev-list --count HEAD..${source}`);
  if (!behind || parseInt(behind) === 0) return null; // already up to date

  const count = parseInt(behind);

  // Normal merge
  if (git(`merge ${source} --no-edit --quiet`) !== null) {
    return { source, commits: count };
  }

  // Merge conflicted — try to auto-resolve each file with --ours
  const conflictOutput = git('diff --name-only --diff-filter=U');
  if (!conflictOutput) {
    // No conflict markers but merge still failed → unknown error, abort
    git('merge --abort');
    return { source, commits: count, failed: true };
  }

  const files = conflictOutput.split('\n').filter(Boolean);

  for (const file of files) {
    if (git(`checkout --ours -- "${file}"`) === null) {
      git('merge --abort');
      return { source, commits: count, failed: true };
    }
    git(`add -- "${file}"`);
  }

  // Complete the merge with resolved files
  if (git('commit --no-edit') !== null) {
    return { source, commits: count, autoResolved: files };
  }

  git('merge --abort');
  return { source, commits: count, failed: true };
}

// Fetch main
if (git(`fetch ${origin} ${MAIN} --quiet`) === null) {
  process.exit(0);
}
git(`fetch ${origin} ${MAIN}:${MAIN} --quiet`);

// Build parent chain, fetch each from origin, keep only existing branches
const parents = getParentChain(branch).filter(p => {
  if (p === MAIN) return true;
  // Fetch and update local ref from origin (fast-forward)
  git(`fetch ${origin} ${p}:${p} --quiet`);
  return git(`rev-parse --verify ${p}`) !== null;
});

// Merge each parent into current branch (root → closest parent)
const messages = [];
for (const parent of parents) {
  const result = tryMerge(parent);
  if (!result) continue;

  if (result.failed) {
    messages.push(`✗ ${parent} → ${branch}: Konflikt, nicht lösbar`);
  } else if (result.autoResolved) {
    messages.push(
      `⚠ ${parent} → ${branch}: ${result.commits} commit(s), ` +
      `${result.autoResolved.length} Konflikt(e) auto-resolved (--ours)`
    );
  } else {
    messages.push(`✓ ${parent} → ${branch}: ${result.commits} commit(s)`);
  }
}

if (messages.length) {
  process.stderr.write(`[prompt.git.sync] ${messages.join(' | ')}\n`);
}
