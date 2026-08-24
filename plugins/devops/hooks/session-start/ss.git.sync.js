#!/usr/bin/env node
/**
 * @hook ss.git.sync
 * @version 1.1.0
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

// symbolic-ref, not rev-parse --abbrev-ref: the latter answers the literal
// 'HEAD' on a detached HEAD, which passes the !== 'main' test and burns the
// 30-minute throttle slot on a sync the child then refuses outright. These
// worktrees sit detached between tasks, so that is the common state.
const branch = git('symbolic-ref --quiet --short HEAD');
if (!branch || branch === 'main') process.exit(0);

// A session resumed in the middle of a ship must not merge under the pipeline:
// ship rebases and releases what it just tested, and a background merge commit
// arriving in between changes the tree out from under it.
try {
  if (require('../lib/ship-sentinel').isActive(cwd)) process.exit(0);
} catch { /* sentinel unreadable — proceed */ }

// Throttle is worktree-scoped, so reopening Claude five times in ten minutes
// (or running two sessions on the same worktree) still yields one sync.
if (!claimSyncSlot(cwd)) process.exit(0);

startBackgroundSync(cwd);
process.exit(0);
