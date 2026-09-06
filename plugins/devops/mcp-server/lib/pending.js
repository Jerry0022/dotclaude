/**
 * Pure helpers for the completion card's `pending` layer.
 *
 * A turn can END while work it started is still RUNNING — background subagents
 * (`Agent` with run_in_background), backgrounded Bash tasks, and whole
 * `Workflow` runs that fan out to dozens of agents of their own. The card is
 * rendered at that moment, so every variant's CTA ("SHIP or CHANGE?", "All
 * DONE") would ask the user to act on a result that does not exist yet.
 *
 * `pending` is therefore NOT a variant but a LAYER over every variant: the body
 * of the card stays true (the changes, tests and repo state really are what they
 * say), while the CTA — the one line that tells the user what to do — is
 * replaced by "not done yet, I'll report back". Same shape as the existing
 * `state.deployPending` override, which flips the ship CTA for merged-but-
 * undeployed artifacts.
 *
 * WHERE THE NAMES GO (three places, three jobs):
 *   - the CTA says what SHAPE the open work has — "2 Workflows + 1 Agent
 *     laufen". One item is named right in it; several are not, or it wraps.
 *   - a dim line directly above the CTA, styled like the version and branch
 *     rows, NAMES the first three — the user reads WHICH workflows are running
 *     without the heading growing.
 *   - the block higher up names each item WITH what it is doing.
 *
 * Extracted from index.js so the wording is unit-testable without booting the
 * MCP server (index.js connects a stdio transport at import time).
 */

/** Names shown inline in the CTA — only ever reached by a single-item CTA. */
const CTA_NAME_LIMIT = 2;

/** Names shown on the dim line next to the CTA before it collapses into "+N". */
const LINE_NAME_LIMIT = 3;

/** Bullets rendered in the pending block — same cap as the line, so the two
 *  "+N" tails on one card always agree. */
const BLOCK_ITEM_LIMIT = LINE_NAME_LIMIT;

/**
 * Hard cap for a single name. Names arrive as model-authored text (a workflow's
 * `meta.name`, an agent description) and land inside an inline code span in the
 * card's tightest line — an unbounded one turns that line into a wall of text.
 */
const NAME_MAX = 48;

/** Order the kinds are reported in — biggest unit of work first. */
const KIND_ORDER = ['workflow', 'agent', 'task'];

const NOUN_KEYS = {
  workflow: ['workflowOne', 'workflowMany'],
  agent: ['agentOne', 'agentMany'],
  task: ['taskOne', 'taskMany'],
};

const VERB_KEYS = {
  workflow: ['workflowVerbOne', 'workflowVerbMany'],
  agent: ['verbOne', 'verbMany'],
  task: ['taskVerbOne', 'taskVerbMany'],
};

const PENDING_LABEL = {
  de: {
    header: '⏳ **LÄUFT NOCH — nicht abgeschlossen:**',
    hint: 'Diese Card berichtet den Stand VOR diesen Ergebnissen.',
    agentOne: 'Agent', agentMany: 'Agenten',
    taskOne: 'Task', taskMany: 'Tasks',
    workflowOne: 'Workflow', workflowMany: 'Workflows',
    verbOne: 'arbeitet', verbMany: 'arbeiten',
    taskVerbOne: 'läuft', taskVerbMany: 'laufen',
    workflowVerbOne: 'läuft', workflowVerbMany: 'laufen',
    mixedVerb: 'laufen',
  },
  en: {
    header: '⏳ **STILL RUNNING — not finished:**',
    hint: 'This card reports the state BEFORE those results.',
    agentOne: 'agent', agentMany: 'agents',
    taskOne: 'task', taskMany: 'tasks',
    workflowOne: 'workflow', workflowMany: 'workflows',
    verbOne: 'is working', verbMany: 'are working',
    taskVerbOne: 'is running', taskVerbMany: 'are running',
    workflowVerbOne: 'is running', workflowVerbMany: 'are running',
    mixedVerb: 'running',
  },
};

/**
 * Strip what would break the card's markdown, then clamp.
 *
 * A name reaches an inline code span in the card's tightest line — a backtick
 * ends that span early and lets the rest render as markup, a newline splits the
 * row in two. Names are IDENTIFIERS (an agent type, a workflow slug), so
 * dropping those characters is lossless in every real case.
 */
function cleanName(s) {
  return String(s == null ? '' : s)
    .split('')
    .map(ch => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? ' ' : ch))
    .join('')
    .replace(/[`|<>]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX)
    .trim();
}

/**
 * Coerce the accepted input shapes into a uniform item list.
 * Accepts plain strings ("devops:frontend") and objects
 * ({ kind, name, doing }). Anything unusable is dropped rather than thrown —
 * a card with a slightly thinner pending block still beats no card.
 *
 * @param {Array<string|object>|undefined} pending
 * @returns {Array<{ kind: 'agent'|'task'|'workflow', name: string, doing: string }>}
 */
export function normalizePending(pending) {
  if (!Array.isArray(pending)) return [];
  const out = [];
  for (const raw of pending) {
    if (typeof raw === 'string') {
      const name = cleanName(raw);
      if (name) out.push({ kind: 'agent', name, doing: '' });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanName(raw.name);
    const doing = cleanName(raw.doing);
    if (!name && !doing) continue;
    out.push({
      kind: KIND_ORDER.includes(raw.kind) ? raw.kind : 'agent',
      name,
      doing,
    });
  }
  return out;
}

/** True when the card must switch to the pending CTA. */
export function hasPending(pending) {
  return normalizePending(pending).length > 0;
}

function noun(L, kind, n) {
  const keys = NOUN_KEYS[kind] || NOUN_KEYS.agent;
  return L[n === 1 ? keys[0] : keys[1]];
}

function verbFor(L, kind, n) {
  const keys = VERB_KEYS[kind] || VERB_KEYS.agent;
  return L[n === 1 ? keys[0] : keys[1]];
}

/**
 * Code-fenced names, capped, with a "+N" tail. The tail counts EVERY remaining
 * item, named or not — two unnamed items are still two things being waited on.
 */
function nameList(items, limit) {
  const named = items.filter(i => i.name);
  if (named.length === 0) return '';
  const shown = named.slice(0, limit).map(i => '`' + i.name + '`');
  const rest = items.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ' +' + rest : '');
}

/** Items grouped by kind in report order, empty groups dropped. */
function groupsOf(items) {
  return KIND_ORDER
    .map(kind => ({ kind, items: items.filter(i => i.kind === kind) }))
    .filter(g => g.items.length > 0);
}

/**
 * The `{what}` slot of the pending CTA — says what shape the open work has.
 *
 * ONE item is named here, since a separate line repeating that single name
 * would be pure duplication. From TWO items on, the CTA carries counts only and
 * the names move to the dim line above it: three names plus two counts in one
 * heading is a line that wraps.
 *
 * @param {Array} pending — raw or normalized items
 * @param {'de'|'en'} lang
 * @returns {string} e.g. "2 Workflows + 1 Agent laufen"
 */
export function pendingWhat(pending, lang) {
  const L = PENDING_LABEL[lang] || PENDING_LABEL.de;
  const items = normalizePending(pending);
  if (items.length === 0) return '';

  if (items.length === 1) {
    const kind = items[0].kind;
    const names = nameList(items, CTA_NAME_LIMIT);
    return names
      ? noun(L, kind, 1) + ' ' + names + ' ' + verbFor(L, kind, 1)
      : '1 ' + noun(L, kind, 1) + ' ' + verbFor(L, kind, 1);
  }

  const groups = groupsOf(items);
  const head = groups.map(g => g.items.length + ' ' + noun(L, g.kind, g.items.length)).join(' + ');
  const verb = groups.length === 1
    ? verbFor(L, groups[0].kind, groups[0].items.length)
    : L.mixedVerb;
  return head + ' ' + verb;
}

/**
 * The dim line rendered directly above the CTA, in the same blockquote style as
 * the version and branch rows: small enough not to compete with the CTA, close
 * enough to be read with it. The CTA above carries the counts, so this line is
 * pure naming — the first three, then a "+N" tail.
 *
 * Empty for a single item, which the CTA already names itself.
 *
 * @param {Array} pending — raw or normalized items
 * @param {'de'|'en'} _lang — unused: the line is names only. Kept so every renderer
 *   in this module has the same signature.
 * @returns {string} the line WITHOUT its blockquote marker, '' when not needed
 */
export function renderPendingLine(pending, _lang) {
  const items = normalizePending(pending);
  if (items.length < 2) return '';
  const ordered = groupsOf(items).flatMap(g => g.items);
  const names = nameList(ordered, LINE_NAME_LIMIT);
  return names ? '⏳ ' + names : '';
}

/**
 * The pending block — one bullet per still-running item, plus the hint that the
 * card predates their results. Rendered above the footer on every variant.
 *
 * @param {Array} pending — raw or normalized items
 * @param {'de'|'en'} lang
 * @returns {string} markdown block, '' when nothing is pending
 */
export function renderPendingBlock(pending, lang) {
  const L = PENDING_LABEL[lang] || PENDING_LABEL.de;
  const items = normalizePending(pending);
  if (items.length === 0) return '';

  const bullets = items.slice(0, BLOCK_ITEM_LIMIT).map(it => {
    const label = it.name ? '`' + it.name + '`' : noun(L, it.kind, 1);
    return '* ' + label + (it.doing ? ' — ' + it.doing : '');
  });
  const rest = items.length - bullets.length;
  if (rest > 0) bullets.push('* +' + rest);

  return L.header + '\n' + bullets.join('\n') + '\n\n_' + L.hint + '_';
}

/**
 * The `{what}` slot shape WITHOUT a verb — "Agent `x`" or "2 Agenten + 1 Task".
 * Used where the sentence already has its verb (the concept CTA: "Arbeite an
 * der Implementierung mit …"), so pendingWhat's "arbeiten" would double it.
 */
function pendingShape(pending, lang) {
  const L = PENDING_LABEL[lang] || PENDING_LABEL.de;
  const items = normalizePending(pending);
  if (items.length === 0) return '';
  if (items.length === 1) {
    const names = nameList(items, CTA_NAME_LIMIT);
    return names ? noun(L, items[0].kind, 1) + ' ' + names : '1 ' + noun(L, items[0].kind, 1);
  }
  return groupsOf(items)
    .map(g => g.items.length + ' ' + noun(L, g.kind, g.items.length))
    .join(' + ');
}

// ---------------------------------------------------------------------------
// Concept layer — a concept page is open, so the turn is a checkpoint
// ---------------------------------------------------------------------------
//
// While a concept page is open, the turn always ends in one of three states,
// and none of them is "background work is running": the bridge server, the
// keepalive pulser and the pickup waker are plumbing that stays up for the
// whole concept — they never produce a result, they ARE the waiting. So the
// concept CTA replaces the pending CTA and states the one thing that is true:
// waiting for decisions, working on the next iteration, or implementing. Real
// content agents (a frontend agent, a research workflow) still count and are
// folded into the sentence — "Arbeite an der Implementierung mit 2 Agenten".

/** Phases a concept session can be in when a turn hands back. */
export const CONCEPT_PHASES = ['waiting', 'iterating', 'implementing'];

const CONCEPT_LABEL = {
  de: {
    waiting: 'Warte auf deine Entscheidungen auf der Seite',
    iterating: 'Arbeite an der nächsten Iteration',
    implementing: 'Arbeite an der Implementierung',
    with: 'mit',
  },
  en: {
    waiting: 'Waiting for your decisions on the page',
    iterating: 'Working on the next iteration',
    implementing: 'Working on the implementation',
    with: 'with',
  },
};

/**
 * Coerce the accepted `concept` shapes — a phase string or `{ phase }` — into
 * `{ phase }`, or null when no concept is open. A truthy value with an unknown
 * or missing phase still means "a concept is open" and defaults to waiting:
 * the safe reading, since the only wrong card here is one that asks for a SHIP.
 *
 * @param {string|object|undefined} concept
 * @returns {{ phase: 'waiting'|'iterating'|'implementing' }|null}
 */
export function normalizeConcept(concept) {
  if (!concept) return null;
  // A JSON-encoded object arrives as a string through the CLI fallback and any
  // caller that skipped the schema's preprocess — parse it rather than reading
  // the whole blob as an unknown phase.
  if (typeof concept === 'string' && concept.trim().startsWith('{')) {
    try { concept = JSON.parse(concept); } catch { /* keep the string */ }
  }
  const raw = typeof concept === 'string' ? concept : (typeof concept === 'object' ? concept.phase : '');
  const phase = String(raw == null ? '' : raw).trim().toLowerCase();
  return { phase: CONCEPT_PHASES.includes(phase) ? phase : 'waiting' };
}

/** True when the card must switch to the concept CTA. */
export function hasConcept(concept) {
  return normalizeConcept(concept) !== null;
}

/**
 * The `{what}` slot of the concept CTA — the phase sentence, with any real
 * background work folded in: "Arbeite an der Implementierung mit Agent
 * `devops:frontend`". While waiting, open work is unusual, so it is appended
 * as its own clause instead of pretending the wait is done "with" it.
 *
 * @param {string|object} concept
 * @param {Array} [pending] — raw or normalized items (content work only; the
 *   bridge's own tasks never belong here)
 * @param {'de'|'en'} lang
 * @returns {string} '' when no concept is open
 */
export function conceptWhat(concept, pending, lang) {
  const c = normalizeConcept(concept);
  if (!c) return '';
  const L = CONCEPT_LABEL[lang] || CONCEPT_LABEL.de;
  const shape = pendingShape(pending, lang);
  if (!shape) return L[c.phase];
  if (c.phase === 'waiting') return L[c.phase] + ' · ' + pendingWhat(pending, lang);
  return L[c.phase] + ' ' + L.with + ' ' + shape;
}

export { PENDING_LABEL, CONCEPT_LABEL, CTA_NAME_LIMIT, LINE_NAME_LIMIT, BLOCK_ITEM_LIMIT, NAME_MAX };
