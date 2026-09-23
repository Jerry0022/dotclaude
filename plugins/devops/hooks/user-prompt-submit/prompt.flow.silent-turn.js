#!/usr/bin/env node
/**
 * @hook prompt.flow.silent-turn
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detects background/cron-injected prompts and marks the turn
 *   as "silent" so post.flow.completion skips the completion-card reminder
 *   and stop.flow.guard skips enforcement.
 *
 *   Why: cron jobs (concept bridge poll — git-sync no longer uses one, it runs
 *   detached from ss.git.sync/stop.git.sync) and autonomous loops
 *   re-enter Claude with a prompt that ALWAYS begins with a silence marker
 *   ("Silently run", "Run silently") or with a loop sentinel
 *   (`<<autonomous-loop>>`). Without this flag, every silent tick is
 *   treated as a user turn — the post-tool-use hook injects the card
 *   reminder, and the stop hook blocks the turn to force a second card.
 *   Result: duplicate cards after every /ship (git-sync cron fires
 *   next tick) and one card per minute during a /concept monitoring
 *   loop. The user only wants the card from their REAL interaction.
 *
 *   The flag is a one-shot — stop.flow.guard clears it when the turn ends.
 *
 *   Scheduled tasks (#371) are a SEPARATE flag, not a silent turn: the prompt
 *   arrives wrapped in `<scheduled-task name="…" file="…">` and the routine may
 *   do real work that owes a card. `dotclaude-devops-scheduled-task` only lets
 *   stop.flow.guard waive the card for an idle tick (clean tree, no ship).
 */

require('../lib/plugin-guard');

const { sessionFile, writeSessionFile } = require('../lib/session-id');

const SILENT_PATTERNS = [
  // Colon-form: 'Silent: POST /heartbeat …' (seen in active concept-bridge
  // crons). The colon is the disambiguator — ordinary prose does not open
  // with 'Silent:' followed by a command.
  /^\s*silent\s*:/i,
  // Verb-form: 'Silently <operational-verb> …' covers:
  //   'Silently run via Bash …'              (git-sync cron)
  //   'Silently run both steps …'            (older concept cron)
  //   'Silently service the concept bridge …' (canonical concept cron)
  //   plus the verbs used inside such cron prompts. The whitelist avoids
  //   classifying real prompts like 'Silently explain what this does' as
  //   silent — only operational/cron-like verbs trigger the flag.
  /^\s*silently\s+(?:run|service|post|get|curl|fetch|heartbeat|keep|check|trigger|update|sync|reset|tick|reload|shutdown|execute|poll|invoke|call)\b/i,
  // 'Run silently …' — alt phrasing used by some skills
  /^\s*run\s+silently\b/i,
  // /loop autonomous sentinel
  /<<autonomous-loop(-dynamic)?>>/i,
];

function isSilent(prompt) {
  if (typeof prompt !== 'string' || prompt.length === 0) return false;
  return SILENT_PATTERNS.some(rx => rx.test(prompt));
}

/** The scheduler's wrapper opens the prompt; nothing a user types starts this way. */
const SCHEDULED_TASK_PATTERN = /^\s*<scheduled-task\b/i;

function isScheduledTask(prompt) {
  return typeof prompt === 'string' && SCHEDULED_TASK_PATTERN.test(prompt);
}

/** A machine turn: a background task / agent result or a channel message
 *  arrives through UserPromptSubmit too, but nobody typed it. Not silent —
 *  such a turn may do real work — just not the user's own prompt. */
const MACHINE_TURN_PATTERN = /^\s*\[SYSTEM NOTIFICATION|<task-notification>|<channel\s+source=/i;

function isMachineTurn(prompt) {
  return typeof prompt === 'string' && MACHINE_TURN_PATTERN.test(prompt);
}

// Guarded so prompt.flow.title-work can require the detectors without a
// second stdin consumer racing this one to process.exit().
if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook;
    try { hook = JSON.parse(inputData); } catch { process.exit(0); }

    const prompt = hook.prompt || '';

    if (isScheduledTask(prompt)) {
      try {
        writeSessionFile(sessionFile('dotclaude-devops-scheduled-task', hook.session_id), '1');
      } catch {}
    }

    if (!isSilent(prompt)) process.exit(0);

    try {
      const flagFile = sessionFile('dotclaude-devops-silent-turn', hook.session_id);
      writeSessionFile(flagFile, '1');
    } catch {}
    process.exit(0);
  });
}

module.exports = { isSilent, isScheduledTask, isMachineTurn, SILENT_PATTERNS, SCHEDULED_TASK_PATTERN, MACHINE_TURN_PATTERN };
