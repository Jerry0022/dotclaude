/**
 * @module budget
 * @version 0.3.0
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
 *   A snapshot past its window reset or older than STALE_MS (the Desktop app
 *   never runs the statusLine writer, so the file is only as fresh as the last
 *   completion card — typically last night's) triggers ONE detached
 *   `refresh-usage-headless.js --quiet --no-login` (maybeRefreshUsage) —
 *   exactly what the completion card does, minus the wait: the hook never
 *   blocks on Edge, the per-prompt re-read picks the fresh file up. Rate-
 *   limited by a tmp marker (REFRESH_COOLDOWN_MS) so parallel sessions and
 *   every prompt of a session don't stack scrapers; skipped where the
 *   scraper profile does not exist (a host that never ran a manual usage refresh, the
 *   eval sandbox) or DEVOPS_COMPLETION_NO_USAGE=1 (tests, CI).
 *
 *   The class is read at SessionStart and on every prompt (cheap JSON). The
 *   credentials tier is cached per session (`dotclaude-budget-tier-<sid>`) so
 *   the credentials file is parsed once, not per prompt (redteam #14).
 *
 *   Silence means `free` — the per-prompt suffix only speaks when the class
 *   tightens. That contract broke once (2026-09-20): a session that had hit
 *   the weekly limit was retried after the reset with a 16-char prompt; no
 *   suffix (short prompt), no SessionStart (the process never restarted),
 *   and the model carried "weekly limit hit" from the transcript into its
 *   own /auto-agents args. So a window that reset since the previous reading
 *   is a POSITIVE signal (`announce`): the full line goes out on every prompt
 *   while the snapshot is past its reset or the window reset recently
 *   (RECENT_RESET_*), regardless of prompt length, and names the reset so it
 *   outranks an earlier limit message. Stateless on purpose — a per-session
 *   "last emitted" marker would bring compaction, parallel-session and
 *   tmp-cleanup failure modes for the same effect (PO + redteam 2026-09-20).
 *
 *   A scraper failure rewrites the snapshot with `_cached` + `_failureReason`
 *   but the OLD timestamp, so the line reports the failure instead of
 *   "refreshing" and no new scraper is started inside FAILURE_BACKOFF_MS
 *   (redteam 2026-09-20 R2).
 *
 *   No persisted answer on purpose: the one budget question is asked once per
 *   session and the answer lives in the conversation — a new session asks
 *   again (user decision, 2026-09-14).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STALE_MS = 3 * 60 * 60 * 1000; // snapshot older than 3 h → flagged (still used unless its window reset)
// Usage is monotonic until a reset, so an ageing snapshot can only drift
// optimistic — the class it shows may already be one step tighter. The
// refresh is due when the worst-case burn since the reading could have
// crossed the next threshold: headroom (%) × window fill time. A Pro 5 h
// window drains under a ceremony (7 agents, 3 opus·high) in about half an
// hour; Max 5x / 20x have 5× / 20× the budget, so the same 30 min mean a
// fifth / a twentieth of the drift. Snapshots at sonnet-only have no next
// threshold: only the reset informs (the `expired` path), never age.
const WINDOW_FILL_MIN = { pro: 30, max5: 150, max20: 600 };
const WEEK_TO_WINDOW = 8; // the weekly budget is roughly this many 5 h windows
const REFRESH_MIN_AGE_MS = 5 * 60 * 1000; // never more often than the cooldown
// A reset this close makes a reading now worthless — the `expired` path
// refreshes right after it instead.
const RESET_IMMINENT_MIN = 10;
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // one detached scraper per 5 min, machine-wide
const FAILURE_BACKOFF_MS = 30 * 60 * 1000; // a scraper that just failed is not relaunched every prompt
const REFRESH_MARKER = path.join(os.tmpdir(), 'dotclaude-usage-refresh');

// "Window reset recently" — the positive signal window after a reset. 5 h:
// the first hour; weekly: the first day (the user typically returns hours
// after the morning reset, not minutes).
const FIVE_H_MIN = 300;
const WEEK_MIN = 10080;
const RECENT_RESET_5H_MIN = 60;
const RECENT_RESET_WEEK_MIN = 24 * 60;

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
 * Which window reset recently, judged from the corrected reset countdown: a
 * 5 h window with more than 240 min left reset within the last hour.
 */
function recentReset(five, week) {
  if (week.resetInMinutes != null && week.resetInMinutes > WEEK_MIN - RECENT_RESET_WEEK_MIN) return 'week';
  if (five.resetInMinutes != null && five.resetInMinutes > FIVE_H_MIN - RECENT_RESET_5H_MIN) return '5h';
  return null;
}

/** Percent points to the next class threshold above `pct`; null at sonnet-only. */
function headroom(pct, askAt, sonnetAt) {
  if (pct == null) return null;
  if (pct < askAt) return askAt - pct;
  if (pct < sonnetAt) return sonnetAt - pct;
  return null;
}

/**
 * Minutes after which a reading is due for a refresh because the class may
 * have tightened since — plan-scaled (see WINDOW_FILL_MIN). Null when age
 * cannot change the class (sonnet-only on every window, env override, no
 * usage at all): then only a reset informs.
 */
function refreshDueMinutes({ tier, fivePct, weeklyPct, override }) {
  if (override) return null;
  const rules = RULES[tier] || RULES.max5;
  const fill = WINDOW_FILL_MIN[RULES[tier] ? tier : 'max5'];
  const due = [];
  const five = headroom(fivePct, rules.askAt[0], rules.sonnetAt[0]);
  if (five != null) due.push(five * fill / 100);
  const week = headroom(weeklyPct, rules.askAt[1], rules.sonnetAt[1]);
  if (week != null) due.push(week * fill * WEEK_TO_WINDOW / 100);
  if (!due.length) return null;
  return Math.round(Math.min(STALE_MS, Math.max(REFRESH_MIN_AGE_MS, Math.min(...due) * 60_000)) / 60_000);
}

/**
 * Read every input and classify. `home` / `nowMs` / `env` are overridable
 * for tests; `sessionId` enables the per-session credentials cache;
 * `snapshot` replaces the disk read with an in-memory usage object (the MCP
 * server classifies the data it is about to return, not a disk re-read).
 */
function readBudget({ home = os.homedir(), nowMs = Date.now(), env = process.env, sessionId = null, snapshot = undefined } = {}) {
  const override = String(env.DOTCLAUDE_BUDGET || env.EVAL_DOTCLAUDE_BUDGET || '').trim();

  const live = (snapshot === undefined ? readJson(path.join(home, '.claude', 'usage-live.json')) : snapshot) || {};
  const ts = Date.parse(live.timestamp || '');
  const ageMs = Number.isFinite(ts) ? nowMs - ts : null;
  const stale = ageMs == null || ageMs > STALE_MS;
  // A failed scrape keeps the old reading and stamps why (refresh-usage-headless
  // markCached) — the line must say "failed", never "refreshing".
  const failedAt = live._cached ? Date.parse(live._failedAt || '') : NaN;
  const refreshFailed = live._cached && typeof live._failureReason === 'string' ? live._failureReason : null;

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
    ageMinutes: ageMs == null ? null : Math.round(ageMs / 60_000),
    fivePct: five.pct, weeklyPct: week.pct,
    resetInMinutes: five.resetInMinutes, weeklyResetInMinutes: week.resetInMinutes,
    expired: five.expired || week.expired,
    recentReset: recentReset(five, week),
    refreshFailed,
    failedAgeMs: Number.isFinite(failedAt) ? nowMs - failedAt : null,
    override: CLASSES.includes(override) ? override : null,
  };
  b.cls = b.override || classify(b);
  b.binding = bindingWindow(b);
  // The positive signal: the previous reading no longer applies. Emitted in
  // full on every prompt while true (no prompt-length gate) — see header.
  b.announce = !b.override && (b.expired || b.recentReset != null);
  b.refreshDueMinutes = refreshDueMinutes(b);
  return b;
}

/**
 * Kick off a detached usage refresh when the snapshot can no longer classify
 * (past its reset), is old enough for the class to have tightened
 * (refreshDueMinutes — plan-scaled), or older than STALE_MS. A reading at
 * 99 % is never refreshed for age: nothing above it can change, the reset
 * will (expired). A reset RESET_IMMINENT_MIN away also skips: the reading
 * would be obsolete in minutes, the expired path refreshes right after.
 * Returns true when a scraper was started; false when nothing was needed or
 * the refresh is not possible here. Never throws, never waits: the
 * SessionStart hook has a 10 s budget and a cold Edge launch can take
 * longer — the next prompt re-reads the file. A scrape that failed inside
 * FAILURE_BACKOFF_MS is not retried — a logged-out profile would otherwise
 * relaunch Edge every 5 min.
 */
function maybeRefreshUsage(b, { home = os.homedir(), nowMs = Date.now(), env = process.env, pluginRoot = null } = {}) {
  if (!b || b.override) return false;
  const aged = b.ageMinutes != null && b.refreshDueMinutes != null && b.ageMinutes >= b.refreshDueMinutes;
  if (!(b.stale || b.expired || aged)) return false;
  if (!b.expired && b.resetInMinutes != null && b.resetInMinutes <= RESET_IMMINENT_MIN) return false;
  if (b.refreshFailed && b.failedAgeMs != null && b.failedAgeMs < FAILURE_BACKOFF_MS) return false;
  if (env.DEVOPS_COMPLETION_NO_USAGE === '1') return false;
  // Only where the scraper has run before — a host without the dedicated
  // Edge profile (never ran a manual usage refresh; the eval sandbox's fresh HOME) must
  // not start launching browsers from a hook.
  try { if (!fs.statSync(path.join(home, '.claude', 'edge-usage-profile')).isDirectory()) return false; } catch { return false; }
  try {
    const last = Number(fs.readFileSync(REFRESH_MARKER, 'utf8'));
    if (Number.isFinite(last) && nowMs - last < REFRESH_COOLDOWN_MS) return false;
  } catch {}
  const root = pluginRoot || env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
  const script = path.join(root, 'scripts', 'refresh-usage-headless.js');
  try { fs.accessSync(script); } catch { return false; }
  try {
    fs.writeFileSync(REFRESH_MARKER, String(nowMs), 'utf8');
    const child = spawn(process.execPath, [script, '--quiet', '--no-login'], {
      detached: true, stdio: 'ignore', windowsHide: true, env,
    });
    child.unref();
    return true;
  } catch { return false; }
}

/** "5h window reset 12 min ago" / "week reset 3 h ago" — the named transition. */
function resetNote(b) {
  if (b.recentReset === 'week') return `week reset ${Math.max(0, Math.round((WEEK_MIN - b.weeklyResetInMinutes) / 60))} h ago`;
  if (b.recentReset === '5h') return `5h window reset ${Math.max(0, FIVE_H_MIN - b.resetInMinutes)} min ago`;
  return null;
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
  const note = resetNote(b);
  const parts = [`[budget] ${planTxt}${note ? ' · ' + note : ''} · ${usage}${b.stale && b.fivePct != null ? ' · stale' : ''} → ${b.cls}`];
  if (b.refreshFailed) parts.push(`(refresh failed: ${b.refreshFailed} — say "refresh usage" to log in once)`);
  else if (b.refreshing) parts.push('(snapshot refreshing — the per-prompt budget line has the live class)');
  if (b.override) parts.push('(env override)');
  else if (b.tier === 'unknown') parts.push('(no plan info — asks once before parallel)');
  // The positive signal names what it outranks — the transcript may still
  // carry "You've hit your weekly limit" or the model's own earlier plan text.
  if (b.announce) parts.push('— earlier limit messages and usage claims in this conversation no longer apply');
  return parts.join(' ');
}

/** The structured block the `get_usage` MCP tool returns next to the numbers. */
function budgetSummary(b) {
  return {
    plan: b.plan, tier: b.tier, cls: b.cls, binding: b.binding,
    expired: b.expired, recentReset: b.recentReset, refreshFailed: b.refreshFailed,
    refreshDueMinutes: b.refreshDueMinutes, override: b.override, line: budgetLine(b),
  };
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

module.exports = {
  RULES, CLASSES, planTier, tierLabel, classify, bindingWindow, refreshDueMinutes, readBudget, maybeRefreshUsage,
  budgetLine, budgetSummary, nudgeSuffix,
  STALE_MS, REFRESH_COOLDOWN_MS, FAILURE_BACKOFF_MS, REFRESH_MARKER, RESET_IMMINENT_MIN, WINDOW_FILL_MIN, WEEK_TO_WINDOW,
  RECENT_RESET_5H_MIN, RECENT_RESET_WEEK_MIN,
};
