/**
 * @module budget
 * @version 0.1.0
 * @description Budget class for the agent delegation policy — the fourth
 *   policy input next to the task's tier signals.
 *
 *   Delegation costs volume in exactly one place: the parallel tier and the
 *   full ceremony spawn opus·high agents (research / po / redteam). On a Pro
 *   plan two of those plus their bootstraps are 10–20 % of a 5-hour window;
 *   on Max 20x they are noise. The 1-agent tier is NOT the problem — an
 *   isolated research agent keeps three web pages out of the main context,
 *   which otherwise get re-sent on every later turn.
 *
 *   Inputs, all local, no network:
 *     ~/.claude/usage-live.json      plan label + 5h / weekly percentages
 *                                    (written by the status line; can be an
 *                                    hour stale in Desktop sessions — fine
 *                                    for a gate, but "unknown" must degrade
 *                                    gracefully)
 *     ~/.claude/.credentials.json    rateLimitTier as the plan fallback (only
 *                                    that key is read — never the tokens)
 *
 *   No persisted preference on purpose: the one budget question is asked
 *   once per session and the answer lives in the conversation — a new
 *   session asks again (user decision, 2026-09-14).
 *
 *   Output: { plan, tier, fivePct, weeklyPct, resetInMinutes, stale, cls }
 *   with cls ∈ comfortable | tight | critical, plus budgetLine() /
 *   nudgeSuffix() — the strings the hooks inject.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STALE_MS = 3 * 60 * 60 * 1000; // snapshot older than 3 h → flagged, still used

// Thresholds per plan tier: [fiveHourPct, weeklyPct] at which the class flips.
// `pro` is tight from the first prompt — a parallel spawn is always a real
// share of its window, so the question is asked there even at 0 %.
const RULES = {
  pro:   { tightAt: [0, 0],   criticalAt: [70, 85] },
  max5:  { tightAt: [80, 90], criticalAt: [95, 98] },
  max20: { tightAt: [90, 95], criticalAt: [98, 99] },
};
const UNKNOWN_TIER_RULES = 'max5'; // no plan info → the middle plan's rules

function planTier(label) {
  if (typeof label !== 'string') return 'unknown';
  const m = label.match(/max[\s_]*(\d+)x/i);
  if (m) return Number(m[1]) >= 20 ? 'max20' : 'max5';
  if (/(?:^|[^a-z])pro(?:$|[^a-z])/i.test(label)) return 'pro'; // "_" is a word char — \bpro\b misses default_claude_pro
  if (/free/i.test(label)) return 'pro'; // a free tier is at least as tight
  return 'unknown';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/** Pure: class from tier + usage. Missing percentages count as 0 (no false tightening). */
function classify({ tier, fivePct, weeklyPct }) {
  const rules = RULES[tier] || RULES[UNKNOWN_TIER_RULES];
  const five = fivePct == null ? 0 : fivePct;
  const week = weeklyPct == null ? 0 : weeklyPct;
  if (five >= rules.criticalAt[0] || week >= rules.criticalAt[1]) return 'critical';
  if (five >= rules.tightAt[0] || week >= rules.tightAt[1]) return 'tight';
  return 'comfortable';
}

/** Read every input and classify. `home` is overridable for tests. */
function readBudget(home = os.homedir(), nowMs = Date.now()) {
  const live = readJson(path.join(home, '.claude', 'usage-live.json')) || {};
  let plan = typeof live.plan === 'string' ? live.plan : null;
  let tier = planTier(plan);
  if (tier === 'unknown') {
    const creds = readJson(path.join(home, '.claude', '.credentials.json'));
    const rl = creds && creds.claudeAiOauth && creds.claudeAiOauth.rateLimitTier;
    const fromCreds = planTier(rl);
    if (fromCreds !== 'unknown') { tier = fromCreds; plan = plan || rl; }
  }
  const fivePct = pct(live.session && live.session.pct);
  const weeklyPct = pct(live.weekly && live.weekly.pct);
  const resetInMinutes = live.session && Number.isFinite(Number(live.session.resetInMinutes))
    ? Number(live.session.resetInMinutes) : null;
  const ts = Date.parse(live.timestamp || '');
  const stale = !Number.isFinite(ts) || nowMs - ts > STALE_MS;

  return { plan, tier, fivePct, weeklyPct, resetInMinutes, stale,
    cls: classify({ tier, fivePct, weeklyPct }) };
}

/** The one line the hooks inject. Always present so "unknown" is visible, not silent. */
function budgetLine(b) {
  const planTxt = b.plan ? b.plan : 'plan unknown';
  const usage = b.fivePct == null && b.weeklyPct == null
    ? 'usage unknown'
    : `5h ${b.fivePct == null ? '?' : b.fivePct + '%'}` +
      (b.resetInMinutes != null ? ` (reset ${b.resetInMinutes} min)` : '') +
      ` · week ${b.weeklyPct == null ? '?' : b.weeklyPct + '%'}`;
  const parts = [`[budget] ${planTxt} · ${usage}${b.stale && b.fivePct != null ? ' · stale' : ''} → ${b.cls}`];
  if (b.tier === 'unknown') parts.push('(no plan info — Max 5x rules)');
  return parts.join(' ');
}

/** Short suffix for the per-prompt nudge; empty when nothing changes. */
function nudgeSuffix(b) {
  if (b.cls === 'critical') {
    const reset = b.resetInMinutes != null ? `, 5h reset in ${b.resetInMinutes} min` : '';
    return ` · budget: critical (1-agent tier → sonnet, ≤5 tool calls; parallel/ceremony → ask once${reset})`;
  }
  if (b.cls === 'tight') return ' · budget: tight (parallel/ceremony → ask once: spare = 1 sonnet agent ≤10 calls, or full)';
  return '';
}

module.exports = { RULES, planTier, classify, readBudget, budgetLine, nudgeSuffix, STALE_MS };
