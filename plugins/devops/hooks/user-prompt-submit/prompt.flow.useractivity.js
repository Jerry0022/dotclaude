#!/usr/bin/env node
/**
 * @hook prompt.flow.useractivity
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Touch a session-scoped flag file on every user prompt.
 *   The self-calibration cron checks this flag before running: if no
 *   user prompt arrived since the last cycle, the cycle is skipped.
 *   This prevents idle sessions from burning tokens on repeated
 *   self-calibration runs with zero value.
 *
 *   The flag path includes the session_id so parallel sessions
 *   (different worktrees, different windows) are fully isolated.
 */

require('../lib/plugin-guard');

const fs   = require('fs');
const { sessionFile } = require('../lib/session-id');

const FLAG_PREFIX = 'dotclaude-devops-user-active';

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let sessionId;
  try {
    const input = JSON.parse(inputData);
    sessionId = input.session_id;
  } catch {}

  // Touch the flag file — content doesn't matter, existence is the signal.
  const flagPath = sessionFile(FLAG_PREFIX, sessionId);
  try {
    fs.writeFileSync(flagPath, String(Date.now()), 'utf8');
  } catch {
    // Non-critical — worst case the next calibration cycle runs anyway.
  }
});
