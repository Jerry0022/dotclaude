#!/usr/bin/env node
/**
 * autonomous-resume-schedule.js — Compute WHEN the auto-resume cron should fire.
 *
 * Used by devops-autonomous Step 4e. When the user opted into auto-resume
 * ($AUTO_RESUME=yes, only possible when shutdown=no), a one-shot session cron is
 * armed that — once the 5h token window has reset — nudges hard-capped Claude
 * worktrees to continue with »weiter« (Step 0.2).
 *
 * Timing — "just after the current window resets, else a flat 5h":
 *   - The CLI first FRESHENS usage: when ~/.claude/usage-live.json is stale (older
 *     than REFRESH_MAX_AGE_MIN, or absent), it best-effort runs the headless
 *     refresh-usage scraper (`--no-login`, bounded) so the REAL remaining window is
 *     used instead of silently defaulting to the flat-5h fallback. A warm cache
 *     (native statusLine writer, terminal sessions) skips the scrape entirely.
 *   - Read `session.resetInMinutes` from the (now-fresh) snapshot and age-correct
 *     it against the snapshot `timestamp`.
 *   - Fire at `now + effectiveMin + BUFFER`. The BUFFER (15 min) pushes the fire
 *     moment PAST the reset boundary (clock skew, scrape lag) — the cron must wake
 *     up when budget is truly back, not a hair before. effectiveMin is clamped to
 *     one full window (≤ 5h) defensively.
 *   - Fall back to a flat 5h whenever usage data is missing, stale (>5h old),
 *     future-dated, or already reset. 5h is always safe: the active window started
 *     at or before "now", so its reset is at or before now+5h ("im Zweifel 5h").
 *
 * Unlike autonomous-shutdown-timer.js there is NO 90-min floor: firing close to
 * an imminent reset is exactly what we want (don't wait a needless 5h), and the
 * 5h CAP applies to the window estimate, not to the BUFFER on top of it.
 *
 * CLI (stdout: JSON):
 *   (no subcommand)   → { ok, delayMinutes, cron, fireAtLocal, source }
 *                       `cron` is a ready-to-use 5-field expression in LOCAL time
 *                       for a one-shot CronCreate — no LLM date math needed.
 *
 * The pure resolver (computeResumeDelayMinutes) does only file-read + date math and
 * is fully cross-platform; the CLI additionally best-effort refreshes usage first.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const USAGE_JSON_PATH = path.join(os.homedir(), '.claude', 'usage-live.json');

const WINDOW_MAX_MIN = 5 * 60; // 300 — one full token period (cap & flat fallback)
const RESET_BUFFER_MIN = 15;   // pad past the reset boundary so budget is truly back
const MAX_STALE_MIN = 300;     // usage older than a full window → unreliable → fallback
const REFRESH_MAX_AGE_MIN = 3; // cache younger than this is fresh enough → skip the scrape

/**
 * Pure delay resolver — no I/O, exported for tests.
 * @param {object|null} usageData  Parsed usage-live.json (or null/garbage).
 * @param {number} nowMs           Current epoch ms (injected for determinism).
 * @returns {{delayMinutes:number, source:string, effectiveMin?:number}}
 */
function computeResumeDelayMinutes(usageData, nowMs) {
  const fallback = { delayMinutes: WINDOW_MAX_MIN, source: 'fallback-5h' };

  const resetMin = usageData && usageData.session && usageData.session.resetInMinutes;
  const ts = usageData && usageData.timestamp;
  if (typeof resetMin !== 'number' || !Number.isFinite(resetMin) || resetMin <= 0) {
    return fallback;
  }
  if (!ts) return fallback;

  const ageMin = (nowMs - new Date(ts).getTime()) / 60000;
  if (!Number.isFinite(ageMin) || ageMin < 0 || ageMin > MAX_STALE_MIN) {
    return fallback; // stale or future-dated snapshot → unreliable
  }

  const effectiveMin = resetMin - ageMin;
  if (effectiveMin <= 0) return fallback; // period already reset → assume a fresh 5h

  // Clamp the window estimate to one full period, then add the buffer ON TOP so
  // we always land after the reset, never on it.
  const windowMin = Math.min(effectiveMin, WINDOW_MAX_MIN);
  const delayMinutes = Math.round(windowMin) + RESET_BUFFER_MIN;
  const source = effectiveMin > WINDOW_MAX_MIN ? 'reset-window-capped' : 'reset-window';

  return { delayMinutes, source, effectiveMin: Math.round(effectiveMin) };
}

/**
 * Build a one-shot 5-field cron expression for `fireAtMs` in LOCAL time.
 * Day-of-week is left `*` so the (day-of-month, month) pair pins the date.
 * @param {number} fireAtMs  Absolute epoch ms when the cron should fire.
 * @returns {string} "M H D Mo *"
 */
function toCronExpression(fireAtMs) {
  const d = new Date(fireAtMs);
  return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
}

function readUsageJson() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Is the cached usage snapshot recent enough to trust without a re-scrape?
 * Pure — exported for tests.
 * @param {object|null} usageData  Parsed usage-live.json (or null/garbage).
 * @param {number} nowMs           Current epoch ms.
 * @returns {boolean}
 */
function isCacheFresh(usageData, nowMs) {
  const ts = usageData && usageData.timestamp;
  if (!ts) return false;
  const ageMin = (nowMs - new Date(ts).getTime()) / 60000;
  return Number.isFinite(ageMin) && ageMin >= 0 && ageMin <= REFRESH_MAX_AGE_MIN;
}

/**
 * Best-effort freshen usage-live.json via the headless scraper so the resume cron
 * fires on the REAL remaining window instead of the flat-5h fallback. Bounded and
 * fully swallowed: a slow/broken/logged-out scrape must never delay or break
 * scheduling — we simply fall through to whatever the cache (or 5h fallback) holds.
 */
function refreshUsageBestEffort() {
  try {
    const scraper = path.join(__dirname, 'refresh-usage-headless.js');
    spawnSync(process.execPath, [scraper, '--no-login', '--quiet'], {
      cwd: os.tmpdir(), // always-local CWD — a UNC session dir can't break the spawn
      timeout: 90_000,
      stdio: 'ignore',
    });
  } catch {
    // ignore — scheduling proceeds on the existing snapshot
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// --- CLI entry (skipped when require()'d by tests) ---
if (require.main === module) {
  // Freshen first so a stale desktop-session cache doesn't silently force flat 5h.
  if (!isCacheFresh(readUsageJson(), Date.now())) refreshUsageBestEffort();
  // Capture `now` AFTER the (possibly ~60s) scrape: a fresh snapshot's timestamp
  // must be ≤ now, else age-correction reads it as future-dated → flat-5h fallback.
  const now = Date.now();
  const plan = computeResumeDelayMinutes(readUsageJson(), now);
  const fireAtMs = now + plan.delayMinutes * 60000;
  const f = new Date(fireAtMs);
  const fireAtLocal =
    `${f.getFullYear()}-${pad2(f.getMonth() + 1)}-${pad2(f.getDate())} ` +
    `${pad2(f.getHours())}:${pad2(f.getMinutes())}`;
  process.stdout.write(
    JSON.stringify({
      ok: true,
      delayMinutes: plan.delayMinutes,
      cron: toCronExpression(fireAtMs),
      fireAtLocal,
      source: plan.source,
    }) + '\n',
  );
}

module.exports = {
  computeResumeDelayMinutes,
  isCacheFresh,
  toCronExpression,
  WINDOW_MAX_MIN,
  RESET_BUFFER_MIN,
  MAX_STALE_MIN,
  REFRESH_MAX_AGE_MIN,
};
