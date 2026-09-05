/**
 * Pure helpers for the completion card's `pending` layer.
 *
 * A turn can END while work it started is still RUNNING — background subagents
 * (`Agent` with run_in_background) and backgrounded Bash tasks keep going after
 * the assistant hands the turn back. The card is rendered at that moment, so
 * every variant's CTA ("SHIP or CHANGE?", "All DONE") would ask the user to act
 * on a result that does not exist yet.
 *
 * `pending` is therefore NOT a variant but a LAYER over every variant: the body
 * of the card stays true (the changes, tests and repo state really are what they
 * say), while the CTA — the one line that tells the user what to do — is
 * replaced by "not done yet, I'll report back", and a block names WHAT is still
 * running. Same shape as the existing `state.deployPending` override, which
 * flips the ship CTA for merged-but-undeployed artifacts.
 *
 * Extracted from index.js so the wording is unit-testable without booting the
 * MCP server (index.js connects a stdio transport at import time).
 */

/** Names shown inline in the CTA before it collapses into a "+N" tail. */
const CTA_NAME_LIMIT = 2;

/** Bullets rendered in the pending block. */
const BLOCK_ITEM_LIMIT = 4;

const PENDING_LABEL = {
  de: {
    header: '⏳ **LÄUFT NOCH — nicht abgeschlossen:**',
    hint: 'Diese Card berichtet den Stand VOR diesen Ergebnissen.',
    agentOne: 'Agent', agentMany: 'Agenten',
    taskOne: 'Task', taskMany: 'Tasks',
    verbOne: 'arbeitet', verbMany: 'arbeiten',
    taskVerbOne: 'läuft', taskVerbMany: 'laufen',
    mixedVerb: 'laufen',
  },
  en: {
    header: '⏳ **STILL RUNNING — not finished:**',
    hint: 'This card reports the state BEFORE those results.',
    agentOne: 'agent', agentMany: 'agents',
    taskOne: 'task', taskMany: 'tasks',
    verbOne: 'is working', verbMany: 'are working',
    taskVerbOne: 'is running', taskVerbMany: 'are running',
    mixedVerb: 'running',
  },
};

/**
 * Coerce the accepted input shapes into a uniform item list.
 * Accepts plain strings ("devops:frontend") and objects
 * ({ kind, name, doing }). Anything unusable is dropped rather than thrown —
 * a card with a slightly thinner pending block still beats no card.
 *
 * @param {Array<string|object>|undefined} pending
 * @returns {Array<{ kind: 'agent'|'task', name: string, doing: string }>}
 */
export function normalizePending(pending) {
  if (!Array.isArray(pending)) return [];
  const out = [];
  for (const raw of pending) {
    if (typeof raw === 'string') {
      const name = raw.trim();
      if (name) out.push({ kind: 'agent', name, doing: '' });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim();
    const doing = String(raw.doing || '').trim();
    if (!name && !doing) continue;
    out.push({
      kind: raw.kind === 'task' ? 'task' : 'agent',
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

/** `a`, `b` — code-fenced names, capped, with a "+N" tail for the rest. */
function nameList(items) {
  const named = items.filter(i => i.name);
  if (named.length === 0) return '';
  const shown = named.slice(0, CTA_NAME_LIMIT).map(i => '`' + i.name + '`');
  const rest = named.length - shown.length;
  if (rest > 0) shown.push('+' + rest);
  return shown.join(', ');
}

/** "Agent `x` arbeitet" for one group (all agents, or all tasks). */
function groupPhrase(items, L, kind) {
  const n = items.length;
  const names = nameList(items);
  const noun = kind === 'task'
    ? (n === 1 ? L.taskOne : L.taskMany)
    : (n === 1 ? L.agentOne : L.agentMany);
  const verb = kind === 'task'
    ? (n === 1 ? L.taskVerbOne : L.taskVerbMany)
    : (n === 1 ? L.verbOne : L.verbMany);

  // One named item reads better without the count: "Agent `qa` arbeitet".
  if (n === 1 && names) return `${noun} ${names} ${verb}`;
  if (names) return `${n} ${noun} (${names}) ${verb}`;
  return `${n} ${noun} ${verb}`;
}

/**
 * The `{what}` slot of the pending CTA — names what is still running so the
 * line says WHICH agent, not just that something is busy.
 *
 * @param {Array} pending — raw or normalized items
 * @param {'de'|'en'} lang
 * @returns {string} e.g. "Agent `devops:frontend` arbeitet"
 */
export function pendingWhat(pending, lang) {
  const L = PENDING_LABEL[lang] || PENDING_LABEL.de;
  const items = normalizePending(pending);
  if (items.length === 0) return '';

  const agents = items.filter(i => i.kind === 'agent');
  const tasks = items.filter(i => i.kind === 'task');

  if (tasks.length === 0) return groupPhrase(agents, L, 'agent');
  if (agents.length === 0) return groupPhrase(tasks, L, 'task');

  // Mixed: lead with the named agents, append the task count.
  const names = nameList(agents);
  const agentNoun = agents.length === 1 ? L.agentOne : L.agentMany;
  const taskNoun = tasks.length === 1 ? L.taskOne : L.taskMany;
  const head = !names
    ? `${agents.length} ${agentNoun}`
    : (agents.length === 1 ? `${agentNoun} ${names}` : `${agents.length} ${agentNoun} (${names})`);
  return `${head} + ${tasks.length} ${taskNoun} ${L.mixedVerb}`;
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
    const label = it.name ? '`' + it.name + '`' : (it.kind === 'task' ? L.taskOne : L.agentOne);
    return '* ' + label + (it.doing ? ' — ' + it.doing : '');
  });
  const rest = items.length - bullets.length;
  if (rest > 0) bullets.push('* +' + rest);

  return L.header + '\n' + bullets.join('\n') + '\n\n_' + L.hint + '_';
}

export { PENDING_LABEL, CTA_NAME_LIMIT, BLOCK_ITEM_LIMIT };
