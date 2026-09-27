/**
 * @module validation-gaps
 * @version 0.1.0
 * @description Which requirements of a card's `validation` field are still
 *   Claude's own work. Shared by the completion MCP (evidence row + gap flag),
 *   stop.flow.guard (Gate 4b: close the gap before the turn ends) and
 *   ship_release (no merge over a self-resolvable gap).
 *
 *   A requirement that is not `met` may stay open only with a reason Claude
 *   cannot remove itself — `waitsOn`:
 *     user     — the user has to act or decide (listen, click, approve, choose)
 *     deploy   — only verifiable once the change is shipped / deployed / restarted
 *     external — a third party (service outage, quota, review by someone else)
 *     pending  — Claude's own background work (agent, workflow) is still
 *                running; valid only while that work is provably open.
 *   Everything else — no status, or partial/unmet without `waitsOn` — is a gap
 *   Claude owes before it reports done. Measured 2026-09-27 over 520 cards: 35 %
 *   carried a partial, 9 % an unmet, and no gate looked at the status at all.
 */

const WAITS_ON = ['user', 'deploy', 'external', 'pending'];

/** Variants that end work on purpose — an open requirement is their point. */
const GAP_EXEMPT_VARIANTS = new Set(['aborted', 'paused']);

function asItems(validation) {
  if (!Array.isArray(validation)) return [];
  return validation
    .map(v => (typeof v === 'string' ? { requirement: v } : v))
    .filter(v => v && typeof v === 'object' && typeof v.requirement === 'string');
}

function waitsOnOf(item) {
  return WAITS_ON.includes(item.waitsOn) ? item.waitsOn : null;
}

/**
 * Classify every requirement. `openTasks` is the number of background tasks
 * still running (transcript-proven); when it is 0, `waitsOn: "pending"` is
 * stale — the work finished and its result is owed. Pass `openTasks: null`
 * when the caller cannot know (the MCP at render time): pending is then taken
 * at its word, and the Stop gate re-checks it with the real count.
 *
 * @returns {{ total, met, waiting: {user,deploy,external,pending}, gaps: Array<{requirement, reason}> }}
 *   reason: 'no-status' | 'open' | 'no-evidence' | 'pending-done'
 */
function classify(validation, { openTasks = null } = {}) {
  const items = asItems(validation);
  const waiting = { user: 0, deploy: 0, external: 0, pending: 0 };
  const gaps = [];
  let met = 0;
  for (const item of items) {
    if (item.status === 'met') { met++; continue; }
    if (!item.status) { gaps.push({ requirement: item.requirement, reason: 'no-status' }); continue; }
    const w = waitsOnOf(item);
    if (!w) { gaps.push({ requirement: item.requirement, reason: 'open' }); continue; }
    // A reason nobody can check is no reason: waitsOn has to say what it waits for.
    if (!(typeof item.evidence === 'string' && item.evidence.trim())) {
      gaps.push({ requirement: item.requirement, reason: 'no-evidence' });
      continue;
    }
    if (w === 'pending' && openTasks === 0) {
      gaps.push({ requirement: item.requirement, reason: 'pending-done' });
      continue;
    }
    waiting[w]++;
  }
  return { total: items.length, met, waiting, gaps };
}

/** The not-met items the MCP hands to the Stop gate (evidence clipped to 200 chars). */
function openItems(validation) {
  return asItems(validation)
    .filter(v => v.status !== 'met')
    .map(v => ({
      requirement: v.requirement,
      status: v.status || null,
      waitsOn: waitsOnOf(v),
      evidence: typeof v.evidence === 'string' ? v.evidence.slice(0, 200) : '',
    }));
}

module.exports = { WAITS_ON, GAP_EXEMPT_VARIANTS, classify, openItems };
