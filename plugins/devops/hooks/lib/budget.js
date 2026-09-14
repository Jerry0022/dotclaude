/**
 * @module budget
 * @version 0.2.0
 * @description Budget class for the agent delegation policy — the fourth
 *   policy input next to the task's tier signals.
 *
 *   Delegation costs volume where opus·high agents are spawned (research /
 *   po / redteam) — model × effort × tool calls. On a Pro plan even one of
 *   those is a real share of the 5-hour window; on Max 20x two in parallel
 *   are noise. The class names say what they DO, not how full the meter is
 *   (a Pro plan is "ask-before-parallel" at 0 %, which is honest; "tight at
 *   0 %" was not — PO review 2026-09-14):
 *
 *     free                 tiers as designed
 *     ask-before-parallel  1-agent tier on sonnet + call ceiling; a parallel
 *                          spawn or a ceremony asks ONE question per session
 *     sonnet-only          1-agent tier only, sonnet, ≤5 calls; parallel and
 *                          ceremony ask, naming the binding reset
 *
 *   Inputs, all local, no network:
 *     ~/.claude/.credentials.json    rateLimitTier — preferred plan source: it
 *                                    refreshes with the token, whereas the
 *                                    status line copies its last label forever
 *                                    (redteam #4). Only that key is read.
 *     ~/.claude/usage-live.json      plan label fallback + 5h / weekly
 *                                    percentages with reset minutes. A snapshot
 *                                    whose window has RESET since it was written
 *                                    contributes no usage (redteam #1 — the
 *                                    morning-after Desktop session must not
 *                                    inherit last night's 96 %).
 *     DOTCLAUDE_BUDGET / EVAL_DOTCLAUDE_BUDGET   env override with a class name
 *                                    (evals hand settings through EVAL_* only).
 *
 *   Unknown plan AND unknown usage → ask-before-parallel: one question is the
 *   cheap side of that error; an API-key user pays per token (PO + redteam #5).
 *
 *   The class is read at SessionStart and on every prompt (cheap JSON). The
 *   credentials tier is cached per session (`dotclaude-budget-tier-<sid>`) so
 *   the credentials file is parsed once, not per prompt (redteam #14).
 *
 *   No persisted answer on purpose: the one budget question is asked once per
 *   session and the answer lives in the conversation — a new session asks
 *   again (user decision, 2026-09-14).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STALE_MS = 3 * 60 * 60 * 1000; // snapshot older than 3 h → flagged (still used unless its window reset)

const CLASSES = ['free', 'ask-before-parallel', 'sonnet-only'];

// Thresholds per plan tier: [fiveHourPct, weeklyPct] at which the class flips.
// `pro` asks from the first prompt — a parallel spawn is always a real share
// of its window, so the question is asked there even at 0 %.
const RULES = {
  pro:   { askAt: [0, 0],   sonnetAt: [70, 85] },
  max5:  { askAt: [80, 90], sonnetAt: [95, 98] },
  max20: { askAt: [90, 95], sonnetAt: [98, 99] },
};

/** Human label for a tier — the credentials string is an internal id. */
function tierLabel(tier, raw) {
  return { pro: 'Pro', max5: 'Max 5x', max20: 'Max 20x' }[tier] || (raw == null ? null : String(raw));
}

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

function minutes(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure: class from tier + usage. Missing percentages count as 0 — but a
 * tier we know nothing about with no usage at all asks (never silently free).
 */
function classify({ tier, fivePct, weeklyPct }) {
  if (!RULES[tier]) {
    return fivePct == null && weeklyPct == null ? 'ask-before-parallel'
      : classify({ tier: 'max5', fivePct, weeklyPct });
  }
  const rules = RULES[tier];
  const five = fivePct == null ? 0 : fivePct;
  const week = weeklyPct == null ? 0 : weeklyPct;
  if (five >= rules.sonnetAt[0] || week >= rules.sonnetAt[1]) return 'sonnet-only';
  if (five >= rules.askAt[0] || week >= rules.askAt[1]) return 'ask-before-parallel';
  return 'free';
}

/** Which window drives the class — named in the line and in the question (redteam #9). */
function bindingWindow({ tier, fivePct, weeklyPct }) {
  const rules = RULES[tier] || RULES.max5;
  const fiveScore = fivePct == null ? -1 : fivePct - rules.askAt[0];
  const weekScore = weeklyPct == null ? -1 : weeklyPct - rules.askAt[1];
  return weekScore > fiveScore ? 'week' : '5h';
}

/** A window that reset after the snapshot was written contributes no usage. */
function liveWindow(win, ts, nowMs) {
  if (!win || typeof win !== 'object') return { pct: null, resetInMinutes: null, expired: false };
  const reset = minutes(win.resetInMinutes);
  const expired = Number.isFinite(ts) && reset != null && nowMs > ts + reset * 60_000;
  return expired
    ? { pct: null, resetInMinutes: null, expired: true }
    : { pct: pct(win.pct), resetInMinutes: reset == null ? null : Math.max(0, Math.round(reset - (nowMs - ts) / 60_000)), expired: false };
}

function credentialsTier(home, sessionId) {
  const cacheFile = sessionId
    ? path.join(os.tmpdir(), `dotclaude-budget-tier-${sessionId}`)
    : null;
  if (cacheFile) {
    try {
      const cached = fs.readFileSync(cacheFile, 'utf8').trim();
      if (cached) return cached === 'unknown' ? { tier: 'unknown', label: null } : { tier: planTier(cached), label: tierLabel(planTier(cached), cached) };
    } catch {}
  }
  const creds = readJson(path.join(home, '.claude', '.credentials.json'));
  const rl = creds && creds.claudeAiOauth && creds.claudeAiOauth.rateLimitTier;
  const tier = planTier(rl);
  if (cacheFile) {
    try { fs.writeFileSync(cacheFile, tier === 'unknown' ? 'unknown' : String(rl), 'utf8'); } catch {}
  }
  return { tier, label: tier === 'unknown' ? null : tierLabel(tier, rl) };
}

/**
 * Read every input and classify. `home` / `nowMs` / `env` are overridable
 * for tests; `sessionId` enables the per-session credentials cache.
 */
function readBudget({ home = os.homedir(), nowMs = Date.now(), env = process.env, sessionId = null } = {}) {
  const override = String(env.DOTCLAUDE_BUDGET || env.EVAL_DOTCLAUDE_BUDGET || '').trim();

  const live = readJson(path.join(home, '.claude', 'usage-live.json')) || {};
  const ts = Date.parse(live.timestamp || '');
  const stale = !Number.isFinite(ts) || nowMs - ts > STALE_MS;

  // Plan: credentials first (fresh), snapshot label second (sticky).
  let { tier, label: plan } = credentialsTier(home, sessionId);
  if (tier === 'unknown' && typeof live.plan === 'string') {
    const fromLabel = planTier(live.plan);
    if (fromLabel !== 'unknown') { tier = fromLabel; plan = live.plan; }
  }

  const five = liveWindow(live.session, ts, nowMs);
  const week = liveWindow(live.weekly, ts, nowMs);

  const b = {
    plan, tier, stale,
    fivePct: five.pct, weeklyPct: week.pct,
    resetInMinutes: five.resetInMinutes, weeklyResetInMinutes: week.resetInMinutes,
    expired: five.expired || week.expired,
    override: CLASSES.includes(override) ? override : null,
  };
  b.cls = b.override || classify(b);
  b.binding = bindingWindow(b);
  return b;
}

/** The one line the hooks inject. Always present so "unknown" is visible, not silent. */
function budgetLine(b) {
  const planTxt = b.plan ? b.plan : 'plan unknown';
  const usage = b.fivePct == null && b.weeklyPct == null
    ? (b.expired ? 'usage unknown (snapshot past its reset)' : 'usage unknown')
    : `window ${b.fivePct == null ? '?' : b.fivePct + '%'}` +
      (b.resetInMinutes != null ? ` (reset ${b.resetInMinutes} min)` : '') +
      ` · week ${b.weeklyPct == null ? '?' : b.weeklyPct + '%'}` +
      (b.weeklyResetInMinutes != null && b.binding === 'week' ? ` (reset ${Math.round(b.weeklyResetInMinutes / 60)} h)` : '');
  const parts = [`[budget] ${planTxt} · ${usage}${b.stale && b.fivePct != null ? ' · stale' : ''} → ${b.cls}`];
  if (b.override) parts.push('(env override)');
  else if (b.tier === 'unknown') parts.push('(no plan info — asks once before parallel)');
  return parts.join(' ');
}

/** Short suffix for the per-prompt nudge; empty when nothing changes. */
function nudgeSuffix(b) {
  if (b.cls === 'sonnet-only') {
    const reset = b.binding === 'week'
      ? (b.weeklyResetInMinutes != null ? `, week resets in ${Math.round(b.weeklyResetInMinutes / 60)} h` : ', week is the binding limit')
      : (b.resetInMinutes != null ? `, window resets in ${b.resetInMinutes} min` : '');
    return ` · budget: sonnet-only (1 sonnet agent ≤5 calls; parallel/ceremony → ask once${reset})`;
  }
  if (b.cls === 'ask-before-parallel') {
    return ' · budget: ask-before-parallel (1-agent tier → sonnet ≤10 calls; parallel/ceremony → ask once: inline / 1 sonnet agent / full)';
  }
  return '';
}

module.exports = { RULES, CLASSES, planTier, tierLabel, classify, bindingWindow, readBudget, budgetLine, nudgeSuffix, STALE_MS };
