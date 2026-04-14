#!/usr/bin/env node
/**
 * @hook ss.git.sync
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Registers a recurring git sync cron job (every 10 minutes).
 *   The cron runs scripts/git-sync.js to fetch remote main and merge
 *   the parent chain into the current worktree branch.
 *   One-time registration — the cron persists for the session lifetime.
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

// Only register in a git repo on a non-main branch with a remote
if (git('rev-parse --is-inside-work-tree') !== 'true') process.exit(0);
if (!git('remote')) process.exit(0);

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch || branch === 'main') process.exit(0);

// Resolve absolute path to the shared sync script (forward slashes for bash)
const scriptPath = path.resolve(__dirname, '../../scripts/git-sync.js').replace(/\\/g, '/');

process.stdout.write(
  `Register a recurring git-sync cron job for this session. ` +
  `Call CronCreate with cron "*/10 * * * *" (recurring: true) ` +
  `and prompt: 'Silently run via Bash: node "${scriptPath}". ` +
  `If output contains ⚠ (merge conflicts detected), YOU MUST resolve the conflicts — do not just report them. ` +
  `Follow this procedure: ` +
  `(1) Extract the source branch from the ⚠ line (format: "⚠ <source> → <target>: ..."). ` +
  `(2) Re-run the merge: git merge <extracted-source> --no-edit. ` +
  `(3) For each conflicted file: read the file with conflict markers, read both sides via git diff :1:<file> :2:<file> (ours) and git diff :1:<file> :3:<file> (theirs). ` +
  `(4) Classify each conflict hunk per deep-knowledge/merge-safety.md Step 3 (complementary, redundant, superseding, technical, design, delete-vs-modify). ` +
  `(5) Edit each conflicted file to contain the semantically correct merged result — keep both sides when complementary, pick the better option for technical choices. ` +
  `(6) Only ask the user (via AskUserQuestion) for mutually exclusive design decisions (e.g. both sides changed the same value to different things). ` +
  `(7) Stage resolved files: git add <file>. Complete the merge: git commit --no-edit. ` +
  `(8) Verify: read the merged files and check for logical consistency (e.g. changed function signatures with stale callers). ` +
  `If output contains ✗ (unresolvable errors), inform the user. ` +
  `If no conflict markers (only ✓), produce no output.'\n`
);
