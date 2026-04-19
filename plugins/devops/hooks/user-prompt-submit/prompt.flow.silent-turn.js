#!/usr/bin/env node
/**
 * @hook prompt.flow.silent-turn
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detects background/cron-injected prompts and marks the turn
 *   as "silent" so post.flow.completion skips the completion-card reminder
 *   and stop.flow.guard skips enforcement.
 *
 *   Why: cron jobs (git-sync, concept bridge poll) and autonomous loops
 *   re-enter Claude with a prompt that ALWAYS begins with a silence marker
 *   ("Silently run", "Run silently") or with a loop sentinel
 *   (`<<autonomous-loop>>`). Without this flag, every silent tick is
 *   treated as a user turn — the post-tool-use hook injects the card
 *   reminder, and the stop hook blocks the turn to force a second card.
 *   Result: duplicate cards after every /devops-ship (git-sync cron fires
 *   next tick) and one card per minute during a /devops-concept monitoring
 *   loop. The user only wants the card from their REAL interaction.
 *
 *   The flag is a one-shot — stop.flow.guard clears it when the turn ends.
 */

require('../lib/plugin-guard');

const { sessionFile, writeSessionFile } = require('../lib/session-id');

const SILENT_PATTERNS = [
  /^\s*silently\s+run\b/i,          // cron git-sync, concept bridge cron
  /^\s*run\s+silently\b/i,          // alt phrasing used by some skills
  /<<autonomous-loop(-dynamic)?>>/i, // /loop autonomous sentinel
];

function isSilent(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) return false;
  return SILENT_PATTERNS.some(rx => rx.test(prompt));
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  if (!isSilent(hook.prompt || '')) process.exit(0);

  try {
    const flagFile = sessionFile('dotclaude-devops-silent-turn', hook.session_id);
    writeSessionFile(flagFile, '1');
  } catch {}
  process.exit(0);
});

module.exports = { isSilent, SILENT_PATTERNS };
