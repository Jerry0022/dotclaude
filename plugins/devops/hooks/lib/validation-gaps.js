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
 *     user     — work only the user can do (decide, approve, a manual setup step);
 *                delivered-but-only-user-verifiable is `met` + userTest (#631)
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

// ---------------------------------------------------------------------------
// Per-checkout copy for ship_release. The ship MCP server never learns the
// session id, so the session flag is out of its reach; a caller that ships
// without passing `validation` (do-run backlog, auto-concept, a ship typed
// right after a card) would otherwise skip the gate entirely. The card writes
// the not-met items keyed by its cwd too; ship_release reads them when the
// caller passed none. An explicit `validation` always wins.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** A card older than this no longer speaks for the checkout. */
const REPO_FLAG_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function normalizeCwd(cwd) {
  let raw = String(cwd);
  // The card and the ship get the cwd from different writers: a Git-Bash
  // `/c/Users/…` and a native `C:\Users\…` must land on the same key.
  if (process.platform === 'win32') raw = raw.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  let p = path.resolve(raw).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') p = p.toLowerCase();
  return p;
}

function repoFlagPath(cwd, dir = os.tmpdir()) {
  const hash = crypto.createHash('sha1').update(normalizeCwd(cwd)).digest('hex').slice(0, 16);
  return path.join(dir, 'dotclaude-devops-validation-open-cwd-' + hash);
}

/** Write (items non-empty) or remove (empty) the checkout's open-requirement copy. */
function writeRepoOpen(cwd, items, dir) {
  if (!cwd) return;
  const file = repoFlagPath(cwd, dir);
  try {
    if (Array.isArray(items) && items.length) {
      fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), cwd: normalizeCwd(cwd), items }));
    } else {
      fs.unlinkSync(file);
    }
  } catch { /* advisory: a missing copy only disables the ship fallback */ }
}

/** The last card's not-met items for this checkout, or null when none / stale / unreadable. */
function readRepoOpen(cwd, { dir, maxAgeMs = REPO_FLAG_MAX_AGE_MS, now = Date.now() } = {}) {
  if (!cwd) return null;
  try {
    const data = JSON.parse(fs.readFileSync(repoFlagPath(cwd, dir), 'utf8'));
    if (!data || !Array.isArray(data.items)) return null;
    if (now - Date.parse(data.at) > maxAgeMs) return null;
    return data.items;
  } catch {
    return null;
  }
}

module.exports = {
  WAITS_ON, GAP_EXEMPT_VARIANTS, REPO_FLAG_MAX_AGE_MS,
  classify, openItems, repoFlagPath, writeRepoOpen, readRepoOpen,
};
