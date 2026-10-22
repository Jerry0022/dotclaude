/**
 * @module title-scheme
 * @version 2.3.0
 * @description The ONE table behind the session title and the completion
 *   card's CTA heading (concept 2026-10-21 "title-iconography").
 *
 *   Grammar: `<STATUS> ┃ <ACTIVITY> <Word> <title>` — a status icon, a heavy
 *   bar (U+2503), the activity emoji and the English keyword (2.2: the
 *   activity follows the bar directly, so both icons sit together). The CTA heading
 *   of every card starts with the SAME parts, followed by ` — ` and the
 *   localized sentence — both are built here from one state id, so they
 *   cannot drift. No fill: 2.0.0 right-aligned the word with U+200A hair
 *   spaces, but the Desktop sidebar drops every whitespace run (verified
 *   2026-10-21), so titles from that release still carry an invisible fill.
 *
 *   STATUS is chosen by card content, not by variant name: a `done` state
 *   turns into the user's move (👉) when the card carries a mandatory user
 *   step (`head(id, { mandatory: true })`). Optional follow-ups keep 🟩.
 *
 *   Matching is FE0F-tolerant and hair-space-tolerant (any number of U+200A
 *   anywhere) and strips ONLY known prefixes: every status x keyword x
 *   activity combination of the current grammar, the 2.0/2.1 order
 *   (`<STATUS> ┃ <Word> <ACTIVITY> `, Started 💡 included), the LEGACY generation
 *   (`<STATUS> <ACTIVITY> <Word> – `, old keywords/icons, old ⏸️ status), the
 *   bare ⏳ and every single-icon prefix (`LEGACY_PREFIXES`). Free text such as
 *   "Fix Login – Bug" after a bare ⏳ is the title and stays (F6).
 *
 *   CJS so hooks `require` it; mcp-server (ESM) loads it through
 *   `hookRequire("lib", "title-scheme.js")` in mcp-server/lib/mode-state.js.
 */

const FE0F = '️';
/** U+200A — built from the code point, the raw char is invisible in source. */
const HAIR = String.fromCharCode(0x200A);
/** U+2503 — the bar between status and word. */
const BAR = String.fromCharCode(0x2503);

/** First icon — the status. 🟩 (not ✅) matches the red 🟥 box. */
const STATUS = Object.freeze({
  work: '⏳',
  user: '👉',
  done: '🟩',
  aborted: '🟥',
  paused: '🟦',
});

/** Old paused status — still recognised on titles in the wild. */
const LEGACY_STATUS = Object.freeze({ ...STATUS, paused: '⏸️' });

/**
 * Every named state: [status key, English keyword, activity icon].
 * Status `done` may be raised to `user` by a mandatory user step.
 */
const STATES = Object.freeze({
  // ⏳ Claude works on a named process.
  shipping: ['work', 'Shipping', '🚀'],
  testing: ['work', 'Testing', '🧪'],
  agents: ['work', 'Team', '🤖'],
  'concept-working': ['work', 'Concept', '🧭'],
  // 👉 the user's move.
  'concept-waiting': ['user', 'Concept', '🧭'],
  batch: ['user', 'Batch', '📚'],
  test: ['user', 'Test', '🧪'],
  ready: ['user', 'Ready', '📦'],
  files: ['user', 'Files', '📦'],
  question: ['user', 'Question', '❓'],
  'red-tests': ['user', 'Red tests', '⚠' + FE0F],
  unverified: ['user', 'Unverified', '⚠' + FE0F],
  'not-deployed': ['user', 'Not deployed', '⚠' + FE0F],
  blocked: ['user', 'Blocked', '🚧'],
  interrupted: ['user', 'Interrupted', '⚡'],
  // 🟩 done — 👉 when a mandatory step rides along.
  // A merged ship — ring alpha or a plain merge without a ring — reads
  // "Released Alpha" (F3: one term everywhere; 2.3 added "Released").
  'released-alpha': ['done', 'Released Alpha', '🚀'],
  'released-beta': ['done', 'Released Beta', '🚀'],
  'released-stable': ['done', 'Released Stable', '🚀'],
  'promoted-beta': ['done', 'Beta', '🎊'],
  'promoted-stable': ['done', 'Stable', '🎊'],
  committed: ['done', 'Committed', '📦'],
  started: ['done', 'Started', '✨'],
  analysis: ['done', 'Analysis', '📊'],
  system: ['done', 'System', '🖥' + FE0F],
  // 🟥 aborted — generic; a named abort keeps its activity (ABORT_ACTIVITY).
  aborted: ['aborted', 'Aborted', '📦'],
  'aborted-ship': ['aborted', 'Ship', '🚀'],
  'aborted-promote': ['aborted', 'Promote', '🎊'],
  'aborted-test': ['aborted', 'Test', '🧪'],
  'aborted-concept': ['aborted', 'Concept', '🧭'],
  'aborted-batch': ['aborted', 'Batch', '📚'],
  'aborted-analysis': ['aborted', 'Analysis', '📊'],
  'aborted-agents': ['aborted', 'Team', '🤖'],
  // 🟦 paused, per reason.
  'paused-user': ['paused', 'Paused', '✋'],
  'paused-usage-reset': ['paused', 'Limit reset', '🔋'],
  'paused-restart': ['paused', 'Restart', '🔌'],
  'paused-reboot': ['paused', 'Reboot', '💻'],
});

/**
 * The previous generation (`<STATUS> <ACTIVITY> <Word> – `): kept ONLY as a
 * recogniser so titles written by older versions are still stripped and
 * classified. Never emitted.
 */
const LEGACY_STATES = Object.freeze({
  shipping: ['work', '🚀', 'Shipping'],
  testing: ['work', '🧪', 'Testing'],
  agents: ['work', '🤖', 'Agents'],
  'concept-working': ['work', '🧭', 'Concept'],
  'concept-waiting': ['user', '🧭', 'Concept'],
  batch: ['user', '📥', 'Batch'],
  test: ['user', '🧪', 'Test'],
  ready: ['user', '📦', 'Ready'],
  files: ['user', '📦', 'Files'],
  question: ['user', '❓', 'Question'],
  'red-tests': ['user', '⚠️', 'Red tests'],
  unverified: ['user', '⚠️', 'Unverified'],
  'not-deployed': ['user', '⚠️', 'Not deployed'],
  blocked: ['user', '⛔', 'Blocked'],
  interrupted: ['user', '⚡', 'Interrupted'],
  'released-alpha': ['done', '🚀', 'Released Alpha'],
  'released-beta': ['done', '🎊', 'Released Beta'],
  'released-stable': ['done', '🎊', 'Released Stable'],
  'promoted-beta': ['done', '🎊', 'Promoted Beta'],
  'promoted-stable': ['done', '🎊', 'Promoted Stable'],
  committed: ['done', '📦', 'Committed'],
  started: ['done', '▶️', 'Started'],
  analysis: ['done', '📋', 'Analysis'],
  system: ['done', '🖥️', 'System'],
  aborted: ['aborted', '📦', 'Aborted'],
  'aborted-ship': ['aborted', '🚀', 'Ship'],
  'aborted-promote': ['aborted', '🎊', 'Promote'],
  'aborted-test': ['aborted', '🧪', 'Test'],
  'aborted-concept': ['aborted', '🧭', 'Concept'],
  'aborted-batch': ['aborted', '📥', 'Batch'],
  'aborted-analysis': ['aborted', '📋', 'Analysis'],
  'aborted-agents': ['aborted', '🤖', 'Agents'],
  'paused-user': ['paused', '✋', 'Paused'],
  'paused-usage-reset': ['paused', '🔋', 'Limit reset'],
  'paused-restart': ['paused', '🔄', 'Restart'],
  'paused-reboot': ['paused', '💻', 'Reboot'],
});

/** `cta.activity` of an aborted card → its named abort state. */
const ABORT_ACTIVITIES = Object.freeze(['ship', 'promote', 'test', 'concept', 'batch', 'analysis', 'agents']);

/** `pause.reason` → paused state id; `user` and anything unknown → paused-user. */
function pausedState(reason) {
  const r = String(reason ?? '').trim().toLowerCase();
  return STATES['paused-' + r] && r !== 'user' ? 'paused-' + r : 'paused-user';
}

/** `cta.activity` → aborted state id; unknown → the generic `🟥 ┃ 📦 Aborted`. */
function abortedState(activity) {
  const a = String(activity ?? '').trim().toLowerCase();
  return ABORT_ACTIVITIES.includes(a) ? 'aborted-' + a : 'aborted';
}

/** `👉 ┃ 📦 Ready` for a status icon, keyword and activity. */
function compose(status, word, activity) {
  return `${status} ${BAR} ${activity} ${word}`;
}

/** The 2.0/2.1 order `👉 ┃ Ready 📦` — recognised, never emitted. */
function composeWordFirst(status, word, activity) {
  return `${status} ${BAR} ${word} ${activity}`;
}

/**
 * The head of a state: status, keyword, activity and the joined text
 * (`👉 ┃ 📦 Ready`, no fill). `mandatory` raises a `done` state to the
 * user's move.
 *
 * @param {string} id key of STATES
 * @param {{ mandatory?: boolean }} [opts]
 * @returns {{ id: string, status: string, activity: string, word: string, text: string }}
 */
function head(id, { mandatory = false } = {}) {
  const s = STATES[id];
  if (!s) throw new Error(`title-scheme: unknown state "${id}"`);
  const statusKey = s[0] === 'done' && mandatory ? 'user' : s[0];
  const status = STATUS[statusKey];
  return { id, status, activity: s[2], word: s[1], text: compose(status, s[1], s[2]) };
}

/** `👉 ┃ 📦 Ready ` — the session-title prefix of a state. */
function prefixOf(id, opts) {
  return head(id, opts).text + ' ';
}

/**
 * `👉 📦 Ready — Shippen?` — the CTA heading of a state. No `┃`: the bar
 * aligns the word column of session titles; on the card it read as a line
 * starting with "|" (2026-10-21).
 */
function headingOf(id, sentence, opts) {
  const { status, word, activity } = head(id, opts);
  const h = `${status} ${activity} ${word}`;
  const s = String(sentence ?? '').trim();
  return s ? `${h} — ${s}` : h;
}

/** Generic work: `⏳ ┃ 🤖 Solo ` — what a bare unnamed turn gets. */
const WORK_PREFIX = compose(STATUS.work, 'Solo', '🤖') + ' ';
/** The pre-2.0 bare hourglass — still recognised as generic work. */
const BARE_WORK = STATUS.work + ' ';

/** The running ship — checked before the generic-work shortcut (R1). */
const SHIPPING_PREFIX = prefixOf('shipping');
/** The /do-batch mode title. */
const BATCH_PREFIX = prefixOf('batch');
/** The concept page waits for the user / Claude works on it. */
const CONCEPT_PREFIX = prefixOf('concept-waiting');
const CONCEPT_WORKING_PREFIX = prefixOf('concept-working');
/** F5: a turn that ended without a card. */
const INTERRUPTED_PREFIX = prefixOf('interrupted');

/** Every single-icon prefix older versions set — still stripped (R4). */
const LEGACY_PREFIXES = Object.freeze([
  '⏳ Working – ',
  '🧭 Concept – ',
  '📥 Batch – ',
  '🚀 Shipping – ',
  '🚀 Shipped – ',
  '🎊 Released – ',
  '🎊 Released Alpha – ',
  '🎊 Released Beta – ',
  '🎊 Released Stable – ',
  '🎊 Promoted Beta – ',
  '🎊 Promoted Stable – ',
  '🧪 Test – ',
  '▶️ Started – ',
  '📦 Ready – ',
  '⛔ Blocked – ',
  '🚫 Aborted – ',
  '📋 Analysis – ',
  '🔧 Done – ',
  '⏸️ Paused – ',
  '⏸️ Paused until restart – ',
  '⏸️ Paused until reboot – ',
  '⏸️ Paused until limit reset – ',
]);

/** Legacy forms with a fixed meaning the guards still honour. */
const LEGACY = Object.freeze({
  working: '⏳ Working – ',
  concept: '🧭 Concept – ',
  batch: '📥 Batch – ',
  shipping: '🚀 Shipping – ',
  // Two-slot generation (pre-2.0).
  shippingTwoSlot: '⏳ 🚀 Shipping – ',
  conceptTwoSlot: '👉 🧭 Concept – ',
});

/** Category of a canonical (fill-less) prefix → classify() result. */
const CATEGORY = new Map();
/** Canonical → every known prefix, used for matching. */
const KNOWN = [];

(function build() {
  const add = (prefix, category) => { KNOWN.push(prefix); CATEGORY.set(prefix, category); };
  const pick = (status, word, shipping, concept) => {
    if (word === 'Batch') return 'batch';
    if (shipping) return 'shipping';
    if (concept) return 'concept-waiting';
    return status === STATUS.work ? 'process' : 'outcome';
  };
  // Current grammar: every status x (word, activity) pair, no fill.
  const pairs = new Map();
  for (const [, word, act] of Object.values(STATES)) pairs.set(word + ' ' + act, [word, act]);
  pairs.set('Solo 🤖', ['Solo', '🤖']);
  // Words retired by 2.3 ("Alpha 🚀" before "Released Alpha"), both orders.
  const retired = [['Alpha', '🚀'], ['Beta', '🚀'], ['Stable', '🚀']];
  const current = new Map([...pairs, ...retired.map((wa) => [wa.join(' '), wa])]);
  // The 2.0/2.1 word-first order, with the icons it used (Started 💡).
  const wordFirst = new Map([...current, ['Started 💡', ['Started', '💡']]]);
  for (const [build, list] of [[compose, current], [composeWordFirst, wordFirst]]) {
    for (const st of Object.values(STATUS)) {
      for (const [word, act] of list.values()) {
        const p = build(st, word, act) + ' ';
        if (CATEGORY.has(p)) continue;
        if (word === 'Solo') { add(p, st === STATUS.work ? 'work' : 'outcome'); continue; }
        add(p, pick(st, word, st === STATUS.work && word === 'Shipping' && act === '🚀',
          st === STATUS.user && word === 'Concept'));
      }
    }
  }
  // Previous two-slot generation, old keywords and icons, old ⏸️ status.
  for (const st of Object.values(LEGACY_STATUS)) {
    for (const [, act, word] of Object.values(LEGACY_STATES)) {
      const p = `${st} ${act} ${word} – `;
      if (CATEGORY.has(p)) continue;
      add(p, pick(st, word, st === STATUS.work && word === 'Shipping',
        st === STATUS.user && word === 'Concept' && act === '🧭'));
    }
  }
  for (const p of LEGACY_PREFIXES) {
    if (CATEGORY.has(p)) continue;
    const cat = p === LEGACY.working ? 'work'
      : p === LEGACY.shipping ? 'shipping'
        : p === LEGACY.batch ? 'batch'
          : p === LEGACY.concept ? 'concept-waiting' : 'outcome';
    add(p, cat);
  }
}());

/** Every known prefix but the bare ⏳, longest first. */
const KNOWN_PREFIXES = Object.freeze([...new Set(KNOWN)].sort((a, b) => b.length - a.length));

// A current head that lost its status: an older plugin strips the leading
// ⏳ as its own bare prefix and stacks its prefix on the rest
// ("⏳ 🧭 Concept – ┃ Shipping 🚀 X"). Stripped, never classified — the
// title gets a fresh head right after.
const ORPHAN_HEADS = Object.freeze([...new Set(
  [...KNOWN].filter((p) => p.includes(BAR)).map((p) => p.slice(p.indexOf(BAR))),
)].sort((a, b) => b.length - a.length));

/**
 * Length of `prefix` at the start of `t`, ignoring FE0F and U+200A on both
 * sides, or -1. A space in `prefix` takes a whole run of spaces in `t`: the
 * Desktop app stores the 2.0.0 hair-space fill as plain U+0020 (observed
 * 2026-10-21, "┃" + 25 spaces + "Solo 🤖"), and a fill the matcher missed
 * left every older head on the title, stacked one per turn.
 * @param {string} t
 * @param {string} prefix
 * @returns {number}
 */
function matchLength(t, prefix) {
  const skip = (c) => c === FE0F || c === HAIR;
  let i = 0;
  let j = 0;
  while (j < prefix.length) {
    if (skip(prefix[j])) { j++; continue; }
    if (skip(t[i])) { i++; continue; }
    if (i >= t.length || t[i] !== prefix[j]) return -1;
    i++; j++;
    if (prefix[j - 1] === ' ') while (t[i] === ' ' || skip(t[i])) i++;
  }
  return i;
}

/** True when `t` starts with `prefix` (FE0F- and hair-space-tolerant). */
function startsWithPrefix(t, prefix) {
  return matchLength(String(t ?? ''), prefix) >= 0;
}

/** A title prefix without fill/FE0F — the key into CATEGORY. */
function canonical(prefix) {
  return String(prefix).split(HAIR).join('');
}

/**
 * The leading known prefix of `title`: `{ prefix, length }` (the canonical
 * prefix string, fill-less, and how many code units of `title` it covers),
 * the bare ⏳ as `{ prefix: BARE_WORK, … }`, or null for a plain title.
 */
function leadingPrefix(title) {
  const t = String(title ?? '');
  for (const p of KNOWN_PREFIXES) {
    const n = matchLength(t, p);
    if (n >= 0) return { prefix: p, length: n };
  }
  const n = matchLength(t, BARE_WORK);
  return n >= 0 ? { prefix: BARE_WORK, length: n } : null;
}

/**
 * `title` without every leading known prefix (stacked ones, either
 * generation, included). Only known prefixes go: "⏳ Fix Login – Bug" →
 * "Fix Login – Bug" (F6).
 *
 * @param {string} title
 * @returns {string}
 */
function stripPrefixes(title) {
  let t = String(title ?? '');
  for (;;) {
    const lead = leadingPrefix(t);
    if (lead) { t = t.slice(lead.length); continue; }
    const orphan = ORPHAN_HEADS.map((p) => matchLength(t, p)).find((n) => n >= 0);
    if (orphan === undefined) return t;
    t = t.slice(orphan);
  }
}

/**
 * The state of a title, read off its leading prefix (either generation):
 * - 'plain'      no known prefix
 * - 'work'       `⏳ ┃ 🤖 Solo ` (or the bare ⏳ / legacy `⏳ Working – `)
 * - 'shipping'   `⏳ ┃ 🚀 Shipping ` (or the legacy forms)
 * - 'batch'      any status + Batch
 * - 'concept-waiting' `👉 ┃ 🧭 Concept ` (or the legacy forms)
 * - 'process'    any other ⏳ prefix (Concept working, Team, Testing)
 * - 'outcome'    any other known prefix (a card's outcome, legacy included)
 *
 * @param {string} title
 * @returns {'plain'|'work'|'shipping'|'batch'|'concept-waiting'|'process'|'outcome'}
 */
function classify(title) {
  const lead = leadingPrefix(title);
  if (!lead) return 'plain';
  if (lead.prefix === BARE_WORK) return 'work';
  return CATEGORY.get(lead.prefix) || 'outcome';
}

/** Every prefix a state can leave on a title (status raised included). */
function allStatePrefixes() {
  const out = new Set();
  for (const id of Object.keys(STATES)) {
    out.add(prefixOf(id));
    out.add(prefixOf(id, { mandatory: true }));
  }
  return [...out];
}

module.exports = {
  FE0F,
  HAIR,
  BAR,
  STATUS,
  STATES,
  LEGACY_STATES,
  ABORT_ACTIVITIES,
  WORK_PREFIX,
  BARE_WORK,
  SHIPPING_PREFIX,
  BATCH_PREFIX,
  CONCEPT_PREFIX,
  CONCEPT_WORKING_PREFIX,
  INTERRUPTED_PREFIX,
  LEGACY_PREFIXES,
  LEGACY,
  KNOWN_PREFIXES,
  canonical,
  head,
  prefixOf,
  headingOf,
  pausedState,
  abortedState,
  matchLength,
  startsWithPrefix,
  leadingPrefix,
  stripPrefixes,
  classify,
  allStatePrefixes,
};
