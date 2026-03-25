#!/usr/bin/env node
/**
 * Claude Code PreToolUse Hook — Periodic Dotclaude Auto-Sync
 *
 * Runs as a PreToolUse hook (attached to Read) to periodically check if
 * ~/.claude/ is behind origin/main and pull updates automatically.
 *
 * Uses a timestamp file for throttling — only checks every 30 minutes.
 * This ensures that when a team member pushes config changes, the other
 * developer picks them up without restarting their session.
 *
 * Non-blocking: never prevents the tool from executing (always exits 0).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOTCLAUDE = path.join(os.homedir(), '.claude');
const THROTTLE_FILE = path.join(os.tmpdir(), 'auto-sync-dotclaude-last');
const THROTTLE_MS = 30 * 60 * 1000; // 30 minutes

// Throttle check — skip if last sync was recent
try {
  if (fs.existsSync(THROTTLE_FILE)) {
    const lastSync = parseInt(fs.readFileSync(THROTTLE_FILE, 'utf8'), 10);
    if (Date.now() - lastSync < THROTTLE_MS) {
      process.exit(0); // Too soon, skip
    }
  }
} catch {
  // If we can't read the file, proceed with sync
}

// Update throttle timestamp immediately (even if sync fails, wait before retrying)
fs.writeFileSync(THROTTLE_FILE, Date.now().toString());

function git(cmd) {
  return execSync(`git -C "${DOTCLAUDE}" ${cmd}`, {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

try {
  // Verify it's a git repo
  git('rev-parse --git-dir');

  // Fetch latest (quiet, fast)
  git('fetch origin --quiet');

  // Get current branch
  const branch = git('rev-parse --abbrev-ref HEAD');

  // Check remote counterpart
  let remoteBranch;
  try {
    remoteBranch = git(`rev-parse --verify origin/${branch}`);
  } catch {
    process.exit(0); // No remote branch
  }

  const localHead = git('rev-parse HEAD');
  if (localHead === remoteBranch) {
    process.exit(0); // Already up to date
  }

  const behind = git(`rev-list --count HEAD..origin/${branch}`);
  const ahead = git(`rev-list --count origin/${branch}..HEAD`);

  if (parseInt(behind) > 0 && parseInt(ahead) === 0) {
    // Safe fast-forward pull
    git(`pull --ff-only origin ${branch} --quiet`);
    process.stderr.write(
      `[auto-sync] Dotclaude updated — ${behind} new commit(s) pulled. ` +
      `Skills and deep-knowledge will use the latest version.\n`
    );
  } else if (parseInt(behind) > 0 && parseInt(ahead) > 0) {
    process.stderr.write(
      `[auto-sync] WARNING: ~/.claude/ has diverged from origin/${branch} ` +
      `(${ahead} ahead, ${behind} behind). Manual merge needed.\n`
    );
  }
} catch (err) {
  // Non-fatal — don't block any tool execution
  // Silently fail — the SessionStart hook will catch persistent issues
}
