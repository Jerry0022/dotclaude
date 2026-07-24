#!/usr/bin/env node
/**
 * autonomous-shutdown-timer.js — Fail-safe OS shutdown timer for run-autonomous.
 *
 * Armed at the START of an autonomous run (Step 5) whenever the user chose
 * "Ja, herunterfahren". It shells out to Windows `shutdown.exe /s /t <seconds>`
 * IMMEDIATELY, so the PC powers off even if the session later wedges (token
 * exhaustion, Anthropic API hang, stuck subagent) and never reaches Step 8's
 * in-session shutdown. This is the inner, early safety net; the 8h Scheduled-Task
 * watchdog (autonomous-watchdog.js) remains the outer net for the case where even
 * this `shutdown.exe` call could not be placed.
 *
 * Timer length — "remaining 5h-period + floor" (user choice):
 *   - FRESHEN first (arm, no override): when ~/.claude/usage-live.json is stale
 *     (older than REFRESH_MAX_AGE_MIN, or absent), best-effort run the headless
 *     refresh-usage scraper (`--no-login`, bounded) so the timer tracks the REAL
 *     remaining window instead of silently defaulting to the flat-5h fallback. A
 *     warm cache (native statusLine writer) skips the scrape entirely.
 *   - Read `session.resetInMinutes` from the (now-fresh) snapshot and age-correct
 *     it against the snapshot `timestamp`.
 *   - Clamp to [90 min, 5 h]. The 90-min FLOOR stops a near-empty token window
 *     from cutting off still-running work; the 5 h CAP is one full token period.
 *   - Fall back to 5 h if usage data is missing, stale (>5 h old), or the period
 *     already reset — "5h passt im Zweifelsfall immer".
 *
 * Because the timer is UNCONDITIONAL, Step 8 must `cancel` it the moment it runs:
 *   - COMPLETED / INTERRUPTED → cancel, then place the graceful 60s shutdown.
 *   - BLOCKED                 → cancel, place NO shutdown (user must intervene).
 *   - reaching Step 8 at all proves the session is alive, so the deliberate
 *     Step 8 decision always supersedes this blind timer.
 *
 * Subcommands (stdout: JSON):
 *   arm [resetMinutesOverride]   Place `shutdown /s /t <seconds>`. Optional numeric
 *                                override skips BOTH the usage refresh and the
 *                                usage-file read (testing / when the caller already
 *                                knows resetInMinutes).
 *                                → { ok, armed, seconds, minutes, source }
 *   cancel                       Run `shutdown /a`. A "nothing scheduled" result is
 *                                treated as success (idempotent).
 *                                → { ok, cancelled, noPending }
 *
 * Platform: Windows-only (uses shutdown.exe). No-op on other platforms.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const USAGE_JSON_PATH = path.join(os.homedir(), '.claude', 'usage-live.json');

const FIVE_HOURS_SEC = 5 * 60 * 60; // 18000 — fallback & hard cap (one token period)
const FLOOR_SEC = 90 * 60;          // 5400  — min, guards against cutting off live work
const MAX_STALE_MIN = 300;          // usage older than a full window → unreliable → fallback
const REFRESH_MAX_AGE_MIN = 3;      // cache younger than this is fresh enough → skip the scrape

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
  process.exit(1);
}

function ok(extra) {
  process.stdout.write(JSON.stringify({ ok: true, ...extra }) + '\n');
  process.exit(0);
}

/**
 * Pure timer-length resolver — no I/O, exported for tests.
 * @param {object|null} usageData  Parsed usage-live.json (or null/garbage).
 * @param {number} nowMs           Current epoch ms (injected for determinism).
 * @returns {{seconds:number, minutes:number, source:string, effectiveMin?:number}}
 */
function computeShutdownDelaySeconds(usageData, nowMs) {
  const fallback = {
    seconds: FIVE_HOURS_SEC,
    minutes: FIVE_HOURS_SEC / 60,
    source: 'fallback-5h',
  };

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

  const rawSec = Math.round(effectiveMin * 60);
  const seconds = Math.min(Math.max(rawSec, FLOOR_SEC), FIVE_HOURS_SEC);
  let source = 'reset-window';
  if (rawSec < FLOOR_SEC) source = 'reset-window-floored';
  else if (rawSec > FIVE_HOURS_SEC) source = 'reset-window-capped';

  return {
    seconds,
    minutes: Math.round(seconds / 60),
    source,
    effectiveMin: Math.round(effectiveMin),
  };
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
 * Best-effort freshen usage-live.json via the headless scraper so the fail-safe
 * timer tracks the REAL remaining window instead of the flat-5h fallback. Bounded
 * and fully swallowed: a slow/broken/logged-out scrape must never delay arming past
 * its 90s cap or throw — we fall through to whatever the cache (or 5h) holds. The
 * 5h fallback keeps this net safe even if the refresh yields nothing.
 */
function refreshUsageBestEffort() {
  try {
    const scraper = path.join(__dirname, 'refresh-usage-headless.js');
    spawnSync(process.execPath, [scraper, '--no-login', '--quiet'], {
      cwd: safeCwd(), // always-local CWD — a UNC session dir can't break the spawn
      timeout: 90_000,
      stdio: 'ignore',
    });
  } catch {
    // ignore — arming proceeds on the existing snapshot
  }
}

function shutdownExe() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(root, 'System32', 'shutdown.exe');
}

// Force a guaranteed-local CWD so a UNC working directory (e.g. session running
// from \\nas\share\...) can't break the native shutdown.exe invocation.
function safeCwd() {
  const home = os.homedir();
  return home && !home.startsWith('\\\\') ? home : os.tmpdir();
}

function runArm(argv) {
  const override = argv[0];
  let plan;
  if (override !== undefined) {
    const m = Number(override);
    if (!Number.isFinite(m)) fail(`arm: resetMinutesOverride must be numeric, got "${override}"`);
    plan = computeShutdownDelaySeconds(
      { session: { resetInMinutes: m }, timestamp: new Date(0).toISOString() },
      0, // age 0 → use override verbatim (clamped)
    );
  } else {
    // Freshen first so a stale desktop-session cache doesn't force the flat-5h
    // fallback; scrape only when the cache is actually stale (bounded, best-effort).
    // Read `now` AFTER the scrape so a fresh timestamp isn't seen as future-dated
    // (which would bounce it to the 5h fallback).
    if (!isCacheFresh(readUsageJson(), Date.now())) refreshUsageBestEffort();
    plan = computeShutdownDelaySeconds(readUsageJson(), Date.now());
  }

  const exe = shutdownExe();
  const cwd = safeCwd();

  // Idempotent re-arm: clear any pre-existing scheduled shutdown first.
  spawnSync(exe, ['/a'], { encoding: 'utf8', cwd });

  const msg =
    `Claude autonomous fail-safe — PC shuts down in ${plan.minutes} min unless the ` +
    `task finishes first. Run 'shutdown /a' to abort.`;
  const res = spawnSync(exe, ['/s', '/t', String(plan.seconds), '/c', msg],
    { encoding: 'utf8', cwd });

  if (res.status !== 0) {
    fail(`shutdown /s failed (status ${res.status}): ` +
      `${(res.stderr || res.stdout || '').trim()}`);
  }
  ok({ armed: true, seconds: plan.seconds, minutes: plan.minutes, source: plan.source });
}

function runCancel() {
  const res = spawnSync(shutdownExe(), ['/a'], { encoding: 'utf8', cwd: safeCwd() });
  if (res.status === 0) ok({ cancelled: true, noPending: false });
  // /a returns non-zero (error 1116) when no shutdown was scheduled — that's the
  // benign "nothing to cancel" case, not a failure.
  const noPending = /1116|no shutdown|kein Herunterfahren|wurde nicht|not in progress/i
    .test((res.stderr || '') + (res.stdout || ''));
  if (noPending) ok({ cancelled: false, noPending: true });
  fail(`shutdown /a failed (status ${res.status}): ` +
    `${(res.stderr || res.stdout || '').trim()}`);
}

// --- CLI entry (skipped when require()'d by tests) ---
if (require.main === module) {
  if (process.platform !== 'win32') {
    ok({ skipped: true, reason: 'non-windows platform' });
  }
  const [, , subcmd, ...args] = process.argv;
  if (subcmd === 'arm') runArm(args);
  else if (subcmd === 'cancel') runCancel();
  else fail(`Unknown subcommand: ${subcmd || '(empty)'}. Use: arm | cancel`);
}

module.exports = {
  computeShutdownDelaySeconds,
  isCacheFresh,
  FIVE_HOURS_SEC,
  FLOOR_SEC,
  MAX_STALE_MIN,
  REFRESH_MAX_AGE_MIN,
};
