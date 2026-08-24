#!/usr/bin/env node
/**
 * @hook stop.git.sync
 * @version 0.2.0
 * @event Stop
 * @plugin devops
 * @description Throttled background git sync at turn end. Replaces the former
 *   ten-minute git-sync cron as the in-session recurrence mechanism.
 *
 *   Stop is the better moment: the turn is over, so the merge does not land in
 *   the middle of a tool call the way the ten-minute cron could. It is not a
 *   guarantee — the child is detached and takes a second or two, so a merge can
 *   still overlap the START of the next turn. What keeps that safe is in
 *   scripts/git-sync.js, not here: it refuses to touch any path with
 *   uncommitted changes, and bails outright on a repo that is mid-merge,
 *   mid-rebase or detached. The child is detached and this hook returns
 *   immediately, so turn end is never delayed by a fetch.
 *
 *   Always exits 0 with no output. A sync that finds something writes a result
 *   file; prompt.git.sync delivers it on the next user turn. Never blocks the
 *   stop (exit 2), never prints — this hook is invisible by construction.
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

function maybeSync() {
  // Cheap gate first: this hook fires on EVERY turn end, and the throttle is a
  // single statSync — the git probes below cost ~100ms each on Windows and are
  // pure waste while the window is closed.
  if (!claimSyncSlot(cwd, { peek: true })) return;

  // A ship spans several turns (approval questions, CI wait), so Stop fires
  // INSIDE the pipeline. A merge commit landing between ship's rebase and its
  // release would mean the tree that was tested is not the tree being shipped.
  try {
    if (require('../lib/ship-sentinel').isActive(cwd)) return;
  } catch { /* sentinel unreadable — a sync is not worth failing turn end over */ }

  if (git('rev-parse --is-inside-work-tree') !== 'true') return;
  if (!git('remote')) return;

  // symbolic-ref, not rev-parse --abbrev-ref: the latter answers the literal
  // 'HEAD' on a detached HEAD, which passes the !== 'main' test and burns the
  // 30-minute throttle slot on a sync the child then refuses outright. These
  // worktrees sit detached between tasks, so that is the common state.
  const branch = git('symbolic-ref --quiet --short HEAD');
  if (!branch || branch === 'main') return;

  // Claim only now that a sync will actually happen.
  if (!claimSyncSlot(cwd)) return;

  startBackgroundSync(cwd);
}

// Drain stdin before working, like every other Stop hook here: Claude Code
// writes the hook payload to this process, and exiting before it is consumed
// gives the writer an EPIPE.
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  try { maybeSync(); } catch { /* a background sync must never break turn end */ }
  process.exit(0);
});
