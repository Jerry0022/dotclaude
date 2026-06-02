#!/usr/bin/env node
/**
 * @hook ss.git.sync
 * @version 0.2.0
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

// The cron prompt must NOT bake in a version-specific path. An in-session ship
// rebuilds the plugin cache under a fresh version dir and removes the old one
// (ss.plugin.update.rebuildCache), so an embedded `.../devops/<version>/...`
// path dangles and the cron then fails MODULE_NOT_FOUND every interval.
// In the versioned cache layout (.../devops/<version>/hooks/session-start),
// emit a command that resolves the script from the current version dir at
// cron-run time — the rebuild leaves exactly one version dir, so a glob +
// head -1 is unambiguous; fall back to the literal path if the glob is empty.
// In a dev/marketplace checkout there is no version dir → use the literal path.
const versionDir = path.resolve(__dirname, '../..');
const isCacheLayout = /^\d+\.\d+\.\d+/.test(path.basename(versionDir));
const versionsParent = path.dirname(versionDir).replace(/\\/g, '/');
const runScript = isCacheLayout
  ? `f="$(ls -d "${versionsParent}"/*/scripts/git-sync.js 2>/dev/null | head -1)"; [ -z "$f" ] && f="${scriptPath}"; node "$f"`
  : `node "${scriptPath}"`;

process.stdout.write(
  `Register a recurring git-sync cron job for this session. ` +
  `Call CronCreate with cron "*/10 * * * *" (recurring: true) ` +
  `and prompt: 'Silently run via Bash: ${runScript}. ` +
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
