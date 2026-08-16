#!/usr/bin/env node
/**
 * @hook ss.git.sync
 * @version 1.0.0
 * @event SessionStart
 * @plugin devops
 * @description Starts ONE detached background git sync for this worktree.
 *   Produces no output — ever. Whatever the sync finds is picked up by
 *   prompt.git.sync on the next user turn.
 *
 *   BREAKING (v1.0.0): no longer registers a ten-minute CronCreate job.
 *   A cron tick is a full Claude turn — inline Bash call, a model reply, and
 *   completion/stop hooks to suppress afterwards — fired every ten minutes for
 *   a fetch+merge that is silent in the overwhelming majority of ticks. The
 *   sync needs no model unless a conflict is genuinely ambiguous, so it now
 *   runs as a detached child process (see hooks/lib/git-sync-bg.js) and only
 *   surfaces in chat when it actually merged something or hit a conflict.
 *   In-session recurrence is covered by stop.git.sync (throttled, per Stop).
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const { claimSyncSlot, startBackgroundSync } = require('../lib/git-sync-bg');

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

// Only sync in a git repo on a non-main branch with a remote
if (git('rev-parse --is-inside-work-tree') !== 'true') process.exit(0);
if (!git('remote')) process.exit(0);

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch || branch === 'main') process.exit(0);

// Throttle is worktree-scoped, so reopening Claude five times in ten minutes
// (or running two sessions on the same worktree) still yields one sync.
if (!claimSyncSlot(cwd)) process.exit(0);

startBackgroundSync(cwd);
process.exit(0);
