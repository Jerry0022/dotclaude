#!/usr/bin/env node
/**
 * @hook stop.git.sync
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Throttled background git sync at turn end. Replaces the former
 *   ten-minute git-sync cron as the in-session recurrence mechanism.
 *
 *   Stop is the right moment: the turn is over, so a merge cannot land under a
 *   file the assistant is mid-edit on — the cron could fire at any instant,
 *   including inside a tool call. The child is detached and this hook returns
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

  if (git('rev-parse --is-inside-work-tree') !== 'true') return;
  if (!git('remote')) return;

  const branch = git('rev-parse --abbrev-ref HEAD');
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
