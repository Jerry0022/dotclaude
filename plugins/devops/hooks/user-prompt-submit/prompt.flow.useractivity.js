#!/usr/bin/env node
/**
 * @hook prompt.flow.useractivity
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Touch a session-scoped flag file on every user prompt.
 *   The self-calibration cron checks this flag before running: if no
 *   user prompt arrived since the last cycle, the cycle is skipped.
 *   This prevents idle sessions from burning tokens on repeated
 *   self-calibration runs with zero value.
 *
 *   DEDUPLICATION (v0.2.0): If the flag file already exists and was written
 *   less than 60 seconds ago, skip the write. This prevents rapid-fire
 *   re-touches when context compression or system-reminders re-trigger
 *   UserPromptSubmit hooks without a real user prompt in between.
 *
 *   The flag path includes the session_id so parallel sessions
 *   (different worktrees, different windows) are fully isolated.
 */

require('../lib/plugin-guard');

const fs   = require('fs');
const { sessionFile } = require('../lib/session-id');

const FLAG_PREFIX = 'dotclaude-devops-user-active';
const DEBOUNCE_MS = 60_000; // 60 seconds

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let sessionId;
  try {
    const input = JSON.parse(inputData);
    sessionId = input.session_id;
  } catch {}

  const flagPath = sessionFile(FLAG_PREFIX, sessionId);

  // Debounce: if flag was touched recently, don't re-touch.
  // This prevents synthetic prompt events (context compression, system-reminder
  // re-injection) from resetting the idle guard and causing extra cron runs.
  try {
    const stat = fs.statSync(flagPath);
    if (Date.now() - stat.mtimeMs < DEBOUNCE_MS) {
      process.exit(0); // Already fresh — skip
    }
  } catch {
    // File doesn't exist — proceed to create it
  }

  try {
    fs.writeFileSync(flagPath, String(Date.now()), 'utf8');
  } catch {
    // Non-critical — worst case the next calibration cycle is skipped.
  }
});
