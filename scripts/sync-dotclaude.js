#!/usr/bin/env node
/**
 * Claude Code SessionStart Hook — Dotclaude Repo Sync
 *
 * Checks if ~/.claude/ (the dotclaude git repo) is behind origin/main.
 * If so, pulls latest changes so every session uses the current global config.
 *
 * Runs silently on success. Reports only when updates were pulled or errors occurred.
 */

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const DOTCLAUDE = path.join(os.homedir(), '.claude');

function git(cmd) {
  return execSync(`git -C "${DOTCLAUDE}" ${cmd}`, {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

try {
  // Verify it's a git repo
  git('rev-parse --git-dir');

  // Fetch latest from origin (quiet, no terminal noise)
  git('fetch origin --quiet');

  // Get current branch
  const branch = git('rev-parse --abbrev-ref HEAD');

  // Check if the remote counterpart exists
  let remoteBranch;
  try {
    remoteBranch = git(`rev-parse --verify origin/${branch}`);
  } catch {
    // No remote branch — nothing to sync
    process.exit(0);
  }

  const localHead = git('rev-parse HEAD');

  if (localHead === remoteBranch) {
    // Already up to date — silent exit
    process.exit(0);
  }

  // Check if local is behind (remote has commits local doesn't)
  const behind = git(`rev-list --count HEAD..origin/${branch}`);
  const ahead = git(`rev-list --count origin/${branch}..HEAD`);

  if (parseInt(behind) > 0 && parseInt(ahead) === 0) {
    // Clean fast-forward pull
    git(`pull --ff-only origin ${branch} --quiet`);
    console.log(`[dotclaude-sync] Updated ~/.claude/ — pulled ${behind} commit(s) from origin/${branch}`);
  } else if (parseInt(behind) > 0 && parseInt(ahead) > 0) {
    // Diverged — don't auto-merge, just warn
    console.log(`[dotclaude-sync] WARNING: ~/.claude/ has diverged from origin/${branch} (${ahead} ahead, ${behind} behind). Manual merge needed.`);
  }
  // If only ahead (local has unpushed commits) — nothing to do, silent exit
} catch (err) {
  // Non-fatal — don't block session start
  console.error(`[dotclaude-sync] Could not sync ~/.claude/: ${err.message}`);
}
