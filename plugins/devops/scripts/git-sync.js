#!/usr/bin/env node
/**
 * @script git-sync
 * @version 0.2.0
 * @plugin devops
 * @description Core git sync logic — fetch remote, merge parent chain into
 *   current branch. Supports branch hierarchy (feat/auth/login merges
 *   main → feat → feat/auth). Conflicts are NEVER auto-resolved —
 *   merge is aborted and the user is warned to rebase manually.
 *   Standalone: called by prompt.git.sync hook and session-start cron.
 */

const { execSync } = require('child_process');

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

// Try merging source into HEAD. On conflict, ABORT and warn —
// never auto-resolve to prevent silent overwrites of parallel work.
function tryMerge(source) {
  const behind = git(`rev-list --count HEAD..${source}`);
  if (!behind || parseInt(behind) === 0) return null; // already up to date

  const count = parseInt(behind);

  // Normal merge (clean — no conflicts)
  if (git(`merge ${source} --no-edit --quiet`) !== null) {
    return { source, commits: count };
  }

  // Merge conflicted — collect info, then ABORT. Never auto-resolve.
  const conflictOutput = git('diff --name-only --diff-filter=U');
  git('merge --abort');

  const files = conflictOutput ? conflictOutput.split('\n').filter(Boolean) : [];
  return { source, commits: count, conflict: true, files };
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

  if (result.conflict) {
    messages.push(
      `✗ ${parent} → ${branch}: ${result.files.length} file(s) in conflict — ` +
      `merge aborted. Rebase before shipping: git rebase origin/${parent}\n` +
      `  Conflicting: ${result.files.join(', ')}`
    );
  } else {
    messages.push(`✓ ${parent} → ${branch}: ${result.commits} commit(s)`);
  }
}

if (messages.length) {
  process.stdout.write(`[git-sync] ${messages.join(' | ')}\n`);
}
