#!/usr/bin/env node
/**
 * @hook prompt.git.sync
 * @version 1.0.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Delivers the result of a background git sync — nothing else.
 *
 *   BREAKING (v1.0.0): no longer RUNS the sync. It used to shell out to
 *   git-sync.js synchronously (30s timeout) on the user's prompt, and printed
 *   a `✓ skipped (throttled, last sync 4m ago)` line on every other prompt —
 *   noise about not having done anything. Both are gone: syncing is started
 *   detached by ss.git.sync / stop.git.sync, and this hook only picks up what
 *   the child left behind.
 *
 *   Silent unless the sync merged commits (✓), hit ambiguous conflicts (⚠) or
 *   failed (✗). stdout on UserPromptSubmit becomes turn context, which is
 *   exactly the right channel for the ⚠ case — the assistant resolves the
 *   conflict inside the turn the user is already in, instead of a cron waking
 *   it up in a turn of its own.
 */

require('../lib/plugin-guard');

const { takeResult, renderContext } = require('../lib/git-sync-bg');

// While /claude-batch collect mode is active, do not TAKE the result.
// takeResult() consumes the file, and the payload leaves via stdout — i.e. as
// turn context. A collected prompt is erased and produces no turn, so the
// result would be consumed into nothing and a ⚠ conflict would never reach
// anyone. Hooks in one event group run in PARALLEL and are not short-circuited
// by a sibling's block, so the collect hook cannot prevent this for us.
// Nothing is lost: the result file stays put and is delivered by the first
// prompt that is not collected.
try {
  if (require('../lib/batch-state').isModeActive(process.cwd())) process.exit(0);
} catch { /* batch state unreadable — deliver as usual */ }

const result = takeResult(process.cwd());
if (!result) process.exit(0);

process.stdout.write(renderContext(result).join('\n'));
process.exit(0);
