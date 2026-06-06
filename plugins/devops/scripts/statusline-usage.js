#!/usr/bin/env node
/**
 * @script statusline-usage
 * @version 0.1.0
 * @plugin devops
 *
 * Native usage source for the completion-card battery line.
 *
 * Claude Code pipes the session JSON to a `statusLine` command on stdin. That
 * JSON carries the live subscription rate limits:
 *   rate_limits.five_hour.used_percentage / .resets_at  (epoch SECONDS)
 *   rate_limits.seven_day.used_percentage / .resets_at
 * This script maps them onto the EXISTING usage-live.json schema (the same shape
 * refresh-usage-headless.js produces) and writes ~/.claude/usage-live.json — so
 * the warm cache stays minute-fresh with ZERO browser scrape and ZERO extra
 * Claude turn (the host runs this command on every status-line render).
 *
 * It ALSO prints a one-line status string to stdout, so it doubles as a real
 * status line. The Edge scraper (refresh-usage-headless.js) stays the lazy
 * fallback for this source's gaps: rate_limits is absent before the first API
 * response and for some Max OAuth logins (anthropics/claude-code#40094),
 * weeklySonnet + exact plan tier are not in the JSON, and a known bug can leak
 * an epoch-sized number into used_percentage (#52326 — guarded by rejecting >100).
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const USAGE_JSON_PATH = path.join(os.homedir(), '.claude', 'usage-live.json');
// Rewrite at most this often when values are unchanged — but DO bump the
// timestamp past this age so the MCP server's warm-freshness check keeps
// hitting the fast path while the user is active.
const WRITE_THROTTLE_MS = 5000;

/** A used_percentage is only trusted as a finite number in [0,100]. The >100
 *  reject also defuses the epoch-leak bug (anthropics/claude-code#52326). */
function validPct(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

/** Epoch-seconds reset stamp → whole minutes from `nowMs`, floored at 0.
 *  Returns null when the stamp is missing/non-numeric. */
function resetInMinutes(resetsAtSec, nowMs) {
  if (typeof resetsAtSec !== 'number' || !Number.isFinite(resetsAtSec)) return null;
  return Math.max(0, Math.round((resetsAtSec * 1000 - nowMs) / 60000));
}

/**
 * Build the usage-live.json snapshot from the host status JSON, merging with the
 * previous on-disk snapshot so an absent/invalid window never clobbers a good
 * value (#40094 / pre-first-API-response). Returns null when NEITHER window has
 * trustworthy native data AND nothing can be carried over — caller then leaves
 * the file untouched and lets the scraper fallback handle it.
 *
 * @param {object} statusJson  parsed host stdin JSON
 * @param {object|null} prev   parsed previous usage-live.json (or null)
 * @param {number} nowMs       Date.now()
 */
function buildSnapshot(statusJson, prev, nowMs) {
  const rl = statusJson && statusJson.rate_limits;
  const five = rl && rl.five_hour;
  const seven = rl && rl.seven_day;

  const sessionValid = !!(five && validPct(five.used_percentage));
  const weeklyValid = !!(seven && validPct(seven.used_percentage));

  // No usable native window at all → signal "don't write".
  if (!sessionValid && !weeklyValid) return null;

  const session = sessionValid
    ? { pct: five.used_percentage, resetInMinutes: resetInMinutes(five.resets_at, nowMs) }
    : ((prev && prev.session) || null);

  const weekly = weeklyValid
    ? {
        pct: seven.used_percentage,
        resetDay: null,  // native source carries duration only, no day/time string
        resetTime: null,
        resetInMinutes: resetInMinutes(seven.resets_at, nowMs),
      }
    : ((prev && prev.weekly) || null);

  // Need at least one real window to justify a write.
  if (!session && !weekly) return null;

  const snapshot = {
    timestamp: new Date(nowMs).toISOString(),
    session,
    weekly,
    plan: (prev && prev.plan) || 'Max Plan', // tier not in JSON — keep last/known label
  };
  // weeklySonnet is not exposed natively — preserve a prior value if present,
  // otherwise omit (matches the scraper emitting `undefined` when absent).
  if (prev && prev.weeklySonnet) snapshot.weeklySonnet = prev.weeklySonnet;
  return snapshot;
}

/** True when `next` differs from `prev` on any user-visible field, so we can
 *  skip churny sub-throttle rewrites that would only bump the timestamp. */
function snapshotChanged(prev, next) {
  if (!prev) return true;
  const a = prev.session || {}, b = next.session || {};
  const c = prev.weekly || {}, d = next.weekly || {};
  return a.pct !== b.pct || a.resetInMinutes !== b.resetInMinutes
      || c.pct !== d.pct || c.resetInMinutes !== d.resetInMinutes;
}

/** Compact one-line status string for the terminal status line. */
function renderStatusLine(snapshot, statusJson) {
  const model = statusJson && statusJson.model && statusJson.model.display_name;
  if (!snapshot) return model || '';
  const parts = [];
  if (model) parts.push(model);
  if (snapshot.session) parts.push(`5h ${snapshot.session.pct}%`);
  if (snapshot.weekly) parts.push(`Wk ${snapshot.weekly.pct}%`);
  return parts.join('  ·  ');
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

/** Atomic write (tmp + rename) so a concurrent reader never sees a partial file. */
function writeAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin available */ }
  let statusJson = null;
  try { statusJson = JSON.parse(raw); } catch { statusJson = null; }

  const prev = readJson(USAGE_JSON_PATH);
  const nowMs = Date.now();

  let display = prev;
  if (statusJson) {
    const snapshot = buildSnapshot(statusJson, prev, nowMs);
    if (snapshot) {
      const prevTs = prev && prev.timestamp ? Date.parse(prev.timestamp) : 0;
      const stale = !prevTs || (nowMs - prevTs) > WRITE_THROTTLE_MS;
      if (snapshotChanged(prev, snapshot) || stale) {
        try { writeAtomic(USAGE_JSON_PATH, snapshot); display = snapshot; }
        catch { /* non-fatal — status line still prints */ }
      }
    }
  }

  process.stdout.write(renderStatusLine(display, statusJson));
}

if (require.main === module) main();

module.exports = {
  main,
  validPct,
  resetInMinutes,
  buildSnapshot,
  snapshotChanged,
  renderStatusLine,
};
