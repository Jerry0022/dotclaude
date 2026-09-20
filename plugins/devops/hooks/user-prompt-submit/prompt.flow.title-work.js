#!/usr/bin/env node
/**
 * @hook prompt.flow.title-work
 * @version 0.3.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Marks a session as "being worked on" in the sidebar: on the
 *   first real prompt of a session — and on the first prompt after every
 *   completion card — it asks Claude to put the bare `⏳ ` (icon only, no
 *   word — `SESSION_PREFIX.work` in mcp-server/lib/mode-state.js) in front of
 *   the session title, replacing whatever outcome prefix the last card left
 *   (📦 Ready, 🧪 Test, ⏳ Working, …). Distinct from the worded `⏳ Working – `
 *   pending prefix, which a card sets while background work runs. The app's
 *   own summary stays the title. The card that ends the turn sets the
 *   outcome prefix again, so the sidebar always says what the session is
 *   doing NOW — not what its last turn ended with. Observed 2026-09-20: a
 *   session sat on `🧪 Test –` for hours while a follow-up prompt had it
 *   implementing with background tasks.
 *
 *   Mode prefixes are not outcomes: `🧭 Concept – ` and `📥 Batch – ` stay
 *   untouched, their skills own them for the mode's lifetime.
 *
 *   Guarded by runOnce: the marker is taken here and given back by
 *   stop.flow.guard once a card has rendered, so a multi-prompt turn without
 *   a card in between costs one rename, not one per prompt. A resumed or
 *   compacted session whose last turn had no card keeps whatever it carries.
 *   Silent/cron turns and scheduled-task ticks are not user work — skipped.
 *   Desktop app only — the instruction tells Claude to skip silently when the
 *   session-mgmt tools are missing (terminal, unattended run).
 */

require('../lib/plugin-guard');

const { runOnce, releaseOnce } = require('../lib/run-once');
const { isSilent, isScheduledTask } = require('./prompt.flow.silent-turn');

/** The runOnce token name — stop.flow.guard releases it after a card. */
const ONCE_KEY = 'prompt-title-work';

/** Pinned copy of `SESSION_PREFIX.work` — hooks are CJS, mode-state.js is ESM. */
const WORK_PREFIX = '⏳ ';

/** The worded pending prefix a card sets while background work runs — shares
 *  the ⏳ emoji with WORK_PREFIX, so "already bare-marked" must exclude it
 *  explicitly (design § 7). Mirrors `SESSION_PREFIX.pending` in mode-state.js. */
const PENDING_PREFIX = '⏳ Working – ';

/** Leading emoji of the prefixes a mode skill owns — never replaced here.
 *  Mirrors `SESSION_PREFIX.concept` / `.batch` in mode-state.js. */
const MODE_PREFIX_EMOJI = ['\u{1F9ED}', '\u{1F4E5}'];

/** Leading emoji of every outcome prefix a card may leave (the bare ⏳
 *  included, so an already-marked title is recognised). The instruction
 *  names them so a title never stacks two. Together with MODE_PREFIX_EMOJI
 *  this mirrors `STRIPPABLE` in mode-state.js (the test pins the lists). */
const OUTCOME_PREFIX_EMOJI = ['\u{1F680}', '\u{1F38A}', '\u{1F9EA}', '▶️', '\u{1F4E6}', '⛔', '\u{1F6AB}', '\u{1F4CB}', '⏳', '\u{1F527}'];

/** Every leading marker the card / skills may have left. */
const KNOWN_PREFIX_EMOJI = [...MODE_PREFIX_EMOJI, ...OUTCOME_PREFIX_EMOJI];

function instruction() {
  return [
    '[prompt.flow.title-work] New work in this session.',
    'Before any other tool call, once, Desktop app only:',
    '  mcp__ccd_session_mgmt__get_session {session_id:"self"} → title.',
    `  If the title is empty or starts with ${MODE_PREFIX_EMOJI.join(' or ')}: do nothing — a mode owns it.`,
    `  Else if it already starts with "${WORK_PREFIX}" and NOT with "${PENDING_PREFIX}": do nothing`,
    `  (the bare icon and the worded "${PENDING_PREFIX}" pending prefix share the ⏳ emoji but mean`,
    '  different things — only the bare form counts as already-marked).',
    `  Else strip every leading "<emoji> <Word> – " prefix whose emoji is one of ${OUTCOME_PREFIX_EMOJI.join(' ')}`,
    `  (e.g. "🧪 Test – ", "📦 Ready – ", "${PENDING_PREFIX}", "🎊 Released Stable – ") and`,
    `  mcp__ccd_session_mgmt__set_session_title {session_id:"self", title: "${WORK_PREFIX}" + <stripped title>}.`,
    'The icon is icon-only — no word after it, the title text stays as it is.',
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

/** Give the token back so the next real prompt re-marks the title. Called by
 *  stop.flow.guard once a completion card has rendered in the turn. */
function releaseTitleWork(sessionId) {
  return releaseOnce(ONCE_KEY, sessionId);
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook;
    try { hook = JSON.parse(inputData); } catch { process.exit(0); }
    if (!shouldMark(hook)) process.exit(0);
    if (!runOnce(ONCE_KEY, hook.session_id)) process.exit(0);
    process.stdout.write(instruction() + '\n');
    process.exit(0);
  });
}

module.exports = { ONCE_KEY, WORK_PREFIX, PENDING_PREFIX, MODE_PREFIX_EMOJI, OUTCOME_PREFIX_EMOJI, KNOWN_PREFIX_EMOJI, instruction, shouldMark, releaseTitleWork };
