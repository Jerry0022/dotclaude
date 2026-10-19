/**
 * @module title-scheme
 * @version 1.0.0
 * @description The ONE table behind the session title and the completion
 *   card's CTA heading (concept 2026-10-19 "title-cta-emoji-scheme").
 *
 *   Grammar: `<STATUS> <ACTIVITY> <Word…> – <title>`. The only single-icon
 *   form is the bare `⏳ <title>` for generic, unnamed work
 *   (prompt.flow.title-work). The CTA heading of every card starts with the
 *   SAME two icons and the SAME English keyword as the title it leaves,
 *   followed by ` — ` and the localized sentence — both are built here from
 *   one state id, so they cannot drift.
 *
 *   STATUS is chosen by card content, not by variant name: a `done` state
 *   turns into the user's move (👉) when the card carries a mandatory user
 *   step (`head(id, { mandatory: true })`). Optional follow-ups keep 🟩.
 *
 *   Matching is FE0F-tolerant (▶️ ⏸️ 🖥️ ⚠️ may arrive with or without the
 *   variation selector) and strips ONLY known prefixes — every status ×
 *   activity × keyword combination, the bare ⏳ and every legacy single-icon
 *   prefix older versions left (`LEGACY_PREFIXES`). Free text such as
 *   "Fix Login – Bug" after a bare ⏳ is the title and stays (F6).
 *
 *   CJS so hooks `require` it; mcp-server (ESM) loads it through
 *   `hookRequire("lib", "title-scheme.js")` in mcp-server/lib/mode-state.js.
 */

const FE0F = '️';

/** First icon — the status. 🟩 (not ✅) matches the red 🟥 box. */
const STATUS = Object.freeze({
  work: '⏳',
  user: '👉',
  done: '🟩',
  aborted: '🟥',
  paused: '⏸️',
});

/** The bare hourglass — generic work, no activity, no word. */
const WORK_PREFIX = STATUS.work + ' ';

/**
 * Every named state: [status key, activity icon, English keyword].
 * Status `done` may be raised to `user` by a mandatory user step.
 */
const STATES = Object.freeze({
  // ⏳ Claude works on a named process.
  shipping: ['work', '🚀', 'Shipping'],
  testing: ['work', '🧪', 'Testing'],
  agents: ['work', '🤖', 'Agents'],
  'concept-working': ['work', '🧭', 'Concept'],
  // 👉 the user's move.
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
  // 🟩 done — 👉 when a mandatory step rides along.
  // A merged ship — ring alpha or a plain merge without a ring — reads
  // "Released Alpha" (F3: one term everywhere).
  'released-alpha': ['done', '🚀', 'Released Alpha'],
  'released-beta': ['done', '🎊', 'Released Beta'],
  'released-stable': ['done', '🎊', 'Released Stable'],
  'promoted-beta': ['done', '🎊', 'Promoted Beta'],
  'promoted-stable': ['done', '🎊', 'Promoted Stable'],
  committed: ['done', '📦', 'Committed'],
  started: ['done', '▶️', 'Started'],
  analysis: ['done', '📋', 'Analysis'],
  system: ['done', '🖥️', 'System'],
  // 🟥 aborted — generic; a named abort keeps its activity (ABORT_ACTIVITY).
  aborted: ['aborted', '📦', 'Aborted'],
  'aborted-ship': ['aborted', '🚀', 'Ship'],
  'aborted-promote': ['aborted', '🎊', 'Promote'],
  'aborted-test': ['aborted', '🧪', 'Test'],
  'aborted-concept': ['aborted', '🧭', 'Concept'],
  'aborted-batch': ['aborted', '📥', 'Batch'],
  'aborted-analysis': ['aborted', '📋', 'Analysis'],
  'aborted-agents': ['aborted', '🤖', 'Agents'],
  // ⏸️ paused, per reason.
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

/** `cta.activity` → aborted state id; unknown → the generic `🟥 📦 Aborted`. */
function abortedState(activity) {
  const a = String(activity ?? '').trim().toLowerCase();
  return ABORT_ACTIVITIES.includes(a) ? 'aborted-' + a : 'aborted';
}

/**
 * The head of a state: status, activity, keyword and the joined text
 * (`👉 📦 Ready`). `mandatory` raises a `done` state to the user's move.
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
  return { id, status, activity: s[1], word: s[2], text: `${status} ${s[1]} ${s[2]}` };
}

/** `👉 📦 Ready – ` — the session-title prefix of a state. */
function prefixOf(id, opts) {
  return head(id, opts).text + ' – ';
}

/** `👉 📦 Ready — Shippen?` — the CTA heading of a state. */
function headingOf(id, sentence, opts) {
  const h = head(id, opts).text;
  const s = String(sentence ?? '').trim();
  return s ? `${h} — ${s}` : h;
}

/** The running ship — checked before the bare-⏳ shortcut (R1). */
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
});

/** Every two-slot prefix: each status × each (activity, keyword) pair. */
const TWO_SLOT = (() => {
  const pairs = new Map();
  for (const [, act, word] of Object.values(STATES)) pairs.set(act + ' ' + word, true);
  const out = [];
  for (const st of Object.values(STATUS)) for (const p of pairs.keys()) out.push(`${st} ${p} – `);
  return out;
})();

/** Every known prefix but the bare ⏳, longest first. */
const KNOWN_PREFIXES = Object.freeze(
  [...new Set([...TWO_SLOT, ...LEGACY_PREFIXES])].sort((a, b) => b.length - a.length),
);

/**
 * Length of `prefix` at the start of `t`, ignoring FE0F on both sides, or -1.
 * @param {string} t
 * @param {string} prefix
 * @returns {number}
 */
function matchLength(t, prefix) {
  let i = 0;
  let j = 0;
  while (j < prefix.length) {
    if (prefix[j] === FE0F) { j++; continue; }
    if (t[i] === FE0F) { i++; continue; }
    if (i >= t.length || t[i] !== prefix[j]) return -1;
    i++; j++;
  }
  return i;
}

/** True when `t` starts with `prefix` (FE0F-tolerant). */
function startsWithPrefix(t, prefix) {
  return matchLength(String(t ?? ''), prefix) >= 0;
}

/**
 * The leading known prefix of `title`: `{ prefix, length }` (the canonical
 * prefix string and how many code units of `title` it covers), the bare ⏳ as
 * `{ prefix: WORK_PREFIX, … }`, or null for a plain title.
 */
function leadingPrefix(title) {
  const t = String(title ?? '');
  for (const p of KNOWN_PREFIXES) {
    const n = matchLength(t, p);
    if (n >= 0) return { prefix: p, length: n };
  }
  const n = matchLength(t, WORK_PREFIX);
  return n >= 0 ? { prefix: WORK_PREFIX, length: n } : null;
}

/**
 * `title` without every leading known prefix (stacked ones included). Only
 * known prefixes go: "⏳ Fix Login – Bug" → "Fix Login – Bug" (F6).
 *
 * @param {string} title
 * @returns {string}
 */
function stripPrefixes(title) {
  let t = String(title ?? '');
  for (;;) {
    const lead = leadingPrefix(t);
    if (!lead) return t;
    t = t.slice(lead.length);
  }
}

/**
 * The state of a title, read off its leading prefix:
 * - 'plain'      no known prefix
 * - 'work'       the bare ⏳ (or the legacy `⏳ Working – `)
 * - 'shipping'   `⏳ 🚀 Shipping – ` (or the legacy `🚀 Shipping – `)
 * - 'batch'      any status + `📥 Batch – ` (or the legacy `📥 Batch – `)
 * - 'concept-waiting' `👉 🧭 Concept – ` (or the legacy `🧭 Concept – `)
 * - 'process'    any other ⏳ two-slot prefix (Concept working, Agents, Testing)
 * - 'outcome'    any other known prefix (a card's outcome, legacy included)
 *
 * @param {string} title
 * @returns {'plain'|'work'|'shipping'|'batch'|'concept-waiting'|'process'|'outcome'}
 */
function classify(title) {
  const lead = leadingPrefix(title);
  if (!lead) return 'plain';
  const p = lead.prefix;
  if (p === WORK_PREFIX || p === LEGACY.working) return 'work';
  if (p === SHIPPING_PREFIX || p === LEGACY.shipping) return 'shipping';
  if (p === LEGACY.batch || p.endsWith(' 📥 Batch – ')) return 'batch';
  if (p === CONCEPT_PREFIX || p === LEGACY.concept) return 'concept-waiting';
  if (p.startsWith(STATUS.work + ' ')) return 'process';
  return 'outcome';
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
  STATUS,
  STATES,
  ABORT_ACTIVITIES,
  WORK_PREFIX,
  SHIPPING_PREFIX,
  BATCH_PREFIX,
  CONCEPT_PREFIX,
  CONCEPT_WORKING_PREFIX,
  INTERRUPTED_PREFIX,
  LEGACY_PREFIXES,
  LEGACY,
  KNOWN_PREFIXES,
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
