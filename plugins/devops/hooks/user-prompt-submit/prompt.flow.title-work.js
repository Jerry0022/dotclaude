#!/usr/bin/env node
/**
 * @hook prompt.flow.title-work
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Marks a fresh session as "being worked on" in the sidebar: on
 *   the FIRST real prompt of a session it asks Claude to put the wrench
 *   (`🔧 `, `SESSION_PREFIX.work` in mcp-server/lib/mode-state.js) in front
 *   of the session title — icon only, no word, the app's own summary stays
 *   the title. The completion card that ends the turn replaces it with the
 *   outcome prefix (📦 Ready, 🧪 Test, …), so the wrench is exactly the
 *   "first prompt in flight" marker; a `fallback` card keeps it.
 *
 *   Once per session (runOnce): a resumed or compacted session already has
 *   the prefix its last card left, and must not be flipped back to 🔧.
 *   Silent/cron turns and scheduled-task ticks are not user work — skipped.
 *   Desktop app only — the instruction tells Claude to skip silently when the
 *   session-mgmt tools are missing (terminal, unattended run).
 */

require('../lib/plugin-guard');

const { runOnce } = require('../lib/run-once');
const { isSilent, isScheduledTask } = require('./prompt.flow.silent-turn');

/** Pinned copy of `SESSION_PREFIX.work` — hooks are CJS, mode-state.js is ESM. */
const WORK_PREFIX = '\u{1F527} ';

/** Every leading marker the card / skills may have left; the instruction
 *  names them so a title never stacks two. Mirrors `STRIPPABLE` in
 *  mode-state.js (the test pins the two lists together). */
const KNOWN_PREFIX_EMOJI = ['\u{1F9ED}', '\u{1F4E5}', '\u{1F680}', '\u{1F38A}', '\u{1F9EA}', '▶️', '\u{1F4E6}', '⛔', '\u{1F6AB}', '\u{1F4CB}', '⏳', '\u{1F527}'];

function instruction() {
  return [
    '[prompt.flow.title-work] First prompt of this session.',
    'Before any other tool call, once, Desktop app only:',
    '  mcp__ccd_session_mgmt__get_session {session_id:"self"} → title.',
    `  If the title is non-empty and does NOT already start with one of ${KNOWN_PREFIX_EMOJI.join(' ')}:`,
    `  mcp__ccd_session_mgmt__set_session_title {session_id:"self", title: "${WORK_PREFIX}" + title}.`,
    'The wrench is icon-only — no word after it, the title text stays as it is.',
    'If either tool is unavailable or fails: skip silently — no retry, no note, no fallback.',
    'Do not mention this to the user.',
  ].join('\n');
}

function shouldMark(hook) {
  const prompt = hook.prompt || hook.user_message || hook.message || '';
  if (!prompt.trim()) return false;
  if (isSilent(prompt) || isScheduledTask(prompt)) return false;
  try { if (require('../lib/batch-state').willBeCollected(hook)) return false; }
  catch { /* fail open */ }
  return true;
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook;
    try { hook = JSON.parse(inputData); } catch { process.exit(0); }
    if (!shouldMark(hook)) process.exit(0);
    if (!runOnce('prompt-title-work', hook.session_id)) process.exit(0);
    process.stdout.write(instruction() + '\n');
    process.exit(0);
  });
}

module.exports = { WORK_PREFIX, KNOWN_PREFIX_EMOJI, instruction, shouldMark };
