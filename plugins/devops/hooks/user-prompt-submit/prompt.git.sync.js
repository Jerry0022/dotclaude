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

const result = takeResult(process.cwd());
if (!result) process.exit(0);

process.stdout.write(renderContext(result).join('\n'));
process.exit(0);
