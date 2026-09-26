#!/usr/bin/env node
/**
 * @hook prompt.flow.title-work
 * @version 0.5.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Marks a session as "being worked on" in the sidebar: on the
 *   first real prompt of a session — and on the first prompt after every
 *   completion card — it asks Claude to put the bare `⏳ ` (icon only, no
 *   word — `SESSION_PREFIX.work` in mcp-server/lib/mode-state.js) in front of
 *   the session title, replacing whatever outcome prefix the last card left
 *   (📦 Ready, 🧪 Test, …). The hourglass is ONE state — "Claude works, not
 *   your move" — whether this turn runs or background work continues after
 *   it: a card with pending work sets the same bare `⏳ `. The worded
 *   `⏳ Working – ` of older versions is a legacy form, rewritten wherever
 *   it is still found. The app's
 *   own summary stays the title. The card that ends the turn sets the
 *   outcome prefix again, so the sidebar always says what the session is
 *   doing NOW — not what its last turn ended with. Observed 2026-09-20: a
 *   session sat on `🧪 Test –` for hours while a follow-up prompt had it
 *   implementing with background tasks.
 *
 *   Mode prefixes: `📥 Batch – ` stays untouched, its skill owns it for the
 *   mode's lifetime. `🧭 Concept – ` means "the page waits for YOU", so a
 *   user prompt swaps it for the hourglass too — Claude works now — and the
 *   card that ends the turn brings the compass back while the page still
 *   waits. Only a machine turn (a task notification — the concept's own
 *   watchers exit that way, and such a turn may end without a card) leaves
 *   the compass alone. `🚀 Shipping – `
 *   is a process prefix too: the bare hourglass is the FALLBACK for "being
 *   worked on" and never replaces a running process — so a title that already
 *   says Shipping keeps it, and a prompt that IS a ship (lib/ship-intent.js,
 *   the same classifier prompt.ship.detect uses) gets `🚀 Shipping – ` right
 *   here instead of the hourglass. Observed 2026-09-21: `/do-ship` after a
 *   change left `⏳` on the title for the whole pipeline whenever the model
 *   skipped the do-ship skill's own courtesy rename (Pre-Step C).
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
const { isSilent, isScheduledTask, isMachineTurn } = require('./prompt.flow.silent-turn');
const { isShipIntent } = require('../lib/ship-intent');

/** The runOnce token name — stop.flow.guard releases it after a card. */
const ONCE_KEY = 'prompt-title-work';

/** Pinned copy of `SESSION_PREFIX.work` — hooks are CJS, mode-state.js is ESM. */
const WORK_PREFIX = '⏳ ';

/** The worded hourglass older versions set while background work ran —
 *  legacy, never set any more (the bare `⏳ ` covers both). It shares the
 *  emoji with WORK_PREFIX, so "already bare-marked" must exclude it
 *  explicitly: a legacy title is rewritten to the bare form. Mirrors
 *  `LEGACY_PREFIXES` in mode-state.js. */
const LEGACY_PENDING_PREFIX = '⏳ Working – ';

/** The process prefix /do-ship owns while the pipeline runs — mirrors
 *  `SESSION_PREFIX.shipping`. Shares the 🚀 with the `🚀 Shipped – ` OUTCOME,
 *  so it is matched as a whole string, never on the emoji. */
const SHIPPING_PREFIX = '🚀 Shipping – ';

/** The concept mode prefix — mirrors `SESSION_PREFIX.concept`. */
const CONCEPT_PREFIX = '\u{1F9ED} Concept – ';
const CONCEPT_EMOJI = '\u{1F9ED}';
const BATCH_EMOJI = '\u{1F4E5}';

/** Leading emoji of the prefixes a mode skill owns. Batch is never replaced
 *  here; the concept compass only on a machine turn (see `instruction`).
 *  Mirrors `SESSION_PREFIX.concept` / `.batch` in mode-state.js. */
const MODE_PREFIX_EMOJI = [CONCEPT_EMOJI, BATCH_EMOJI];

/** Leading emoji of every outcome prefix a card may leave (the bare ⏳
 *  included, so an already-marked title is recognised). The instruction
 *  names them so a title never stacks two. Together with MODE_PREFIX_EMOJI
 *  this mirrors `STRIPPABLE` in mode-state.js (the test pins the lists). */
const OUTCOME_PREFIX_EMOJI = ['\u{1F680}', '\u{1F38A}', '\u{1F9EA}', '▶️', '\u{1F4E6}', '⛔', '\u{1F6AB}', '\u{1F4CB}', '⏳', '\u{1F527}', '⏸️'];

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

function instruction(prefix = WORK_PREFIX, { machine = false } = {}) {
  const shipping = prefix === SHIPPING_PREFIX;
  // The compass says "the page waits for YOU". A user prompt means Claude
  // works now, so it yields to the hourglass (or Shipping) like any outcome;
  // the turn's card brings it back while the page still waits. A machine turn
  // (a task notification — the concept's own watchers exit that way) is no
  // proof of work: it may end without a card, so it keeps its hands off.
  const owned = machine ? MODE_PREFIX_EMOJI : [BATCH_EMOJI];
  const strippable = machine ? OUTCOME_PREFIX_EMOJI : [CONCEPT_EMOJI, ...OUTCOME_PREFIX_EMOJI];
  const ownedNote = machine
    ? 'a mode owns it (this turn is no user prompt — an open concept page keeps its compass).'
    : 'batch mode owns it.';
  const already = shipping
    ? [`  Else if it already starts with "${SHIPPING_PREFIX}": do nothing — the ship is already marked.`]
    : [
      `  Else if it already starts with "${SHIPPING_PREFIX}": do nothing — a ship is running and the`,
      '  hourglass is only the fallback for work that is no named process.',
      `  Else if it already starts with "${WORK_PREFIX}" and NOT with "${LEGACY_PENDING_PREFIX}": do nothing`,
      '  (that worded form is a legacy of older versions — only the bare icon counts as already-marked).',
    ];
  const tail = shipping
    ? 'The word is exactly "Shipping" — this is the do-ship skill\'s Pre-Step C done early; the skill finds the title marked and leaves it.'
    : 'The icon is icon-only — no word after it, the title text stays as it is.';
  const examples = machine
    ? `"🧪 Test – ", "📦 Ready – ", "🚀 Shipped – ", "${LEGACY_PENDING_PREFIX}", "🎊 Released Stable – "`
    : `"${CONCEPT_PREFIX}", "🧪 Test – ", "📦 Ready – ", "🚀 Shipped – ", "${LEGACY_PENDING_PREFIX}", "🎊 Released Stable – "`;
  const conceptNote = machine ? [] : [
    `A "${CONCEPT_PREFIX}" title yields too: the compass means the page waits for the user, and now Claude works.`,
    'If a concept page stays open after this turn, end the turn with its completion card (concept field + cwd) — that card brings the compass back.',
  ];
  return [
    shipping
      ? '[prompt.flow.title-work] New work in this session — a ship.'
      : '[prompt.flow.title-work] New work in this session.',
    'Before any other tool call, once, Desktop app only:',
    '  mcp__ccd_session_mgmt__get_session {session_id:"self"} → title.',
    `  If the title is empty or starts with ${owned.join(' or ')}: do nothing — ${ownedNote}`,
    ...already,
    `  Else strip every leading "<emoji> <Word> – " prefix whose emoji is one of ${strippable.join(' ')}`,
    `  (e.g. ${examples}) and`,
    `  mcp__ccd_session_mgmt__set_session_title {session_id:"self", title: "${prefix}" + <stripped title>}.`,
    tail,
    ...conceptNote,
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
    process.stdout.write(instruction(prefixFor(prompt), { machine: isMachineTurn(prompt) }) + '\n');
    process.exit(0);
  });
}

module.exports = { ONCE_KEY, WORK_PREFIX, LEGACY_PENDING_PREFIX, SHIPPING_PREFIX, CONCEPT_PREFIX, MODE_PREFIX_EMOJI, OUTCOME_PREFIX_EMOJI, KNOWN_PREFIX_EMOJI, instruction, prefixFor, shouldMark, releaseTitleWork };
