#!/usr/bin/env node
/**
 * @hook prompt.flow.title-work
 * @version 0.4.1
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
 *   untouched, their skills own them for the mode's lifetime. `🚀 Shipping – `
 *   is a process prefix too: the bare hourglass is the FALLBACK for "being
 *   worked on" and never replaces a running process — so a title that already
 *   says Shipping keeps it, and a prompt that IS a ship (lib/ship-intent.js,
 *   the same classifier prompt.ship.detect uses) gets `🚀 Shipping – ` right
 *   here instead of the hourglass. Observed 2026-09-21: `/ship` after a
 *   change left `⏳` on the title for the whole pipeline whenever the model
 *   skipped the ship skill's own courtesy rename (Pre-Step C).
 *
 *   Guarded by runOnce: the marker is taken here and given back by
 *   stop.flow.guard at every non-silent turn end (card or no card — since
 *   0.183.10; releasing only after a card let a card-less answer after a ship
 *   pin `🚀 Shipped – ` on the title for the rest of the session), so a
 *   multi-prompt turn costs one rename, not one per prompt. An outcome prefix
 *   therefore lives exactly one turn: `🚀 Shipped – ` stays only while the
 *   LAST thing this session did was a ship.
 *   Silent/cron turns and scheduled-task ticks are not user work — skipped.
 *   Desktop app only — the instruction tells Claude to skip silently when the
 *   session-mgmt tools are missing (terminal, unattended run).
 */

require('../lib/plugin-guard');

const { runOnce, releaseOnce } = require('../lib/run-once');
const { isSilent, isScheduledTask } = require('./prompt.flow.silent-turn');
const { isShipIntent } = require('../lib/ship-intent');

/** The runOnce token name — stop.flow.guard releases it after a card. */
const ONCE_KEY = 'prompt-title-work';

/** Pinned copy of `SESSION_PREFIX.work` — hooks are CJS, mode-state.js is ESM. */
const WORK_PREFIX = '⏳ ';

/** The worded pending prefix a card sets while background work runs — shares
 *  the ⏳ emoji with WORK_PREFIX, so "already bare-marked" must exclude it
 *  explicitly (design § 7). Mirrors `SESSION_PREFIX.pending` in mode-state.js. */
const PENDING_PREFIX = '⏳ Working – ';

/** The process prefix /ship owns while the pipeline runs — mirrors
 *  `SESSION_PREFIX.shipping`. Shares the 🚀 with the `🚀 Shipped – ` OUTCOME,
 *  so it is matched as a whole string, never on the emoji. */
const SHIPPING_PREFIX = '🚀 Shipping – ';

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

/**
 * The prefix a prompt puts on the title: the process it starts when it
 * starts one (a ship → `🚀 Shipping – `), the bare hourglass otherwise. The
 * hourglass is the fallback, never the override.
 */
function prefixFor(prompt) {
  return isShipIntent(prompt) ? SHIPPING_PREFIX : WORK_PREFIX;
}

function instruction(prefix = WORK_PREFIX) {
  const shipping = prefix === SHIPPING_PREFIX;
  const already = shipping
    ? [`  Else if it already starts with "${SHIPPING_PREFIX}": do nothing — the ship is already marked.`]
    : [
      `  Else if it already starts with "${SHIPPING_PREFIX}": do nothing — a ship is running and the`,
      '  hourglass is only the fallback for work that is no named process.',
      `  Else if it already starts with "${WORK_PREFIX}" and NOT with "${PENDING_PREFIX}": do nothing`,
      `  (the bare icon and the worded "${PENDING_PREFIX}" pending prefix share the ⏳ emoji but mean`,
      '  different things — only the bare form counts as already-marked).',
    ];
  const tail = shipping
    ? 'The word is exactly "Shipping" — this is the ship skill\'s Pre-Step C done early; the skill finds the title marked and leaves it.'
    : 'The icon is icon-only — no word after it, the title text stays as it is.';
  return [
    shipping
      ? '[prompt.flow.title-work] New work in this session — a ship.'
      : '[prompt.flow.title-work] New work in this session.',
    'Before any other tool call, once, Desktop app only:',
    '  mcp__ccd_session_mgmt__get_session {session_id:"self"} → title.',
    `  If the title is empty or starts with ${MODE_PREFIX_EMOJI.join(' or ')}: do nothing — a mode owns it.`,
    ...already,
    `  Else strip every leading "<emoji> <Word> – " prefix whose emoji is one of ${OUTCOME_PREFIX_EMOJI.join(' ')}`,
    `  (e.g. "🧪 Test – ", "📦 Ready – ", "🚀 Shipped – ", "${PENDING_PREFIX}", "🎊 Released Stable – ") and`,
    `  mcp__ccd_session_mgmt__set_session_title {session_id:"self", title: "${prefix}" + <stripped title>}.`,
    tail,
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
    const prompt = hook.prompt || hook.user_message || hook.message || '';
    process.stdout.write(instruction(prefixFor(prompt)) + '\n');
    process.exit(0);
  });
}

module.exports = { ONCE_KEY, WORK_PREFIX, PENDING_PREFIX, SHIPPING_PREFIX, MODE_PREFIX_EMOJI, OUTCOME_PREFIX_EMOJI, KNOWN_PREFIX_EMOJI, instruction, prefixFor, shouldMark, releaseTitleWork };
