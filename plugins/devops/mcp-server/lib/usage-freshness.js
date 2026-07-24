/**
 * @module usage-freshness
 * @version 0.1.0
 * @plugin devops
 * @description Shared staleness policy for the usage pipeline. One verdict
 *   (assessFreshness) feeds every consumer, one gate (isLiveSnapshot) decides
 *   both baseline advancement and delta computation — so a cache-served
 *   snapshot can never masquerade as live movement again, and every scraper
 *   failure mode maps to a human-readable reason (describeScrapeFailure).
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Percent bars older than this render as an explicit "no current data" note
// instead — a 33-day-old 93% bar is worse than no bar.
export const STALE_BARS_MAX_AGE_MIN = 360;

/**
 * Single source of truth for "how old is this snapshot and may we show bars".
 * @param {object|null} data  parsed usage-live.json
 * @param {number} nowMs
 * @returns {{ ageMinutes: number, cached: boolean, expired: boolean }}
 */
export function assessFreshness(data, nowMs) {
  const ts = data && data.timestamp ? Date.parse(data.timestamp) : NaN;
  const ageMinutes = Number.isFinite(ts) ? Math.round((nowMs - ts) / 60_000) : Infinity;
  return {
    ageMinutes,
    cached: !!(data && data._cached),
    expired: ageMinutes > STALE_BARS_MAX_AGE_MIN,
  };
}

/**
 * May this snapshot advance the delta baseline / produce deltas?
 * Cache-served data must not — advancing the baseline onto stale data is what
 * froze the card at "+0%" for a month.
 */
export function isLiveSnapshot(data) {
  return !!(data && data.session && !data._cached);
}

/**
 * Map an execSync error (or exit code) from the scraper to a reason string.
 * Covers the undocumented failure classes too: exit 1 (node-level crash, e.g.
 * MODULE_NOT_FOUND after a mid-session plugin update dangles the baked path)
 * and status null (execSync timeout/kill — err.status is null then, which the
 * old code rendered as no reason at all).
 * @param {{ status?: number|null, signal?: string }} err
 */
export function describeScrapeFailure(err) {
  const status = err ? err.status : undefined;
  if (status === null || status === undefined) {
    return "scraper timed out or was killed (no exit code" + (err && err.signal ? `, signal ${err.signal}` : "") + ")";
  }
  const reasons = {
    1: "scraper crashed with exit 1 — node-level failure (e.g. script path dangling after a plugin update, or an uncaught exception)",
    2: "scraper profile not logged in — no window opened (automatic path); run /auto-usage once to log in",
    3: "usage data parse error",
    4: "CDP connection failed",
    5: "scraper instance could not launch (Edge not installed?)",
  };
  return reasons[status] || `scrape exit code ${status}`;
}

/**
 * Resolve a script inside the NEWEST plugin-cache version dir that actually
 * ships it. Baked absolute paths dangle when ss.plugin.update rebuilds the
 * cache mid-session (the "scrape exit code 1" incident) — resolving at call
 * time survives that.
 * @param {string} baseDir   e.g. ~/.claude/plugins/cache/dotclaude/devops
 * @param {string[]} relParts e.g. ['scripts', 'refresh-usage-headless.js']
 * @returns {string|null} absolute path, or null when nothing matches
 */
export function pickNewestVersionScript(baseDir, relParts) {
  let versions;
  try {
    versions = readdirSync(baseDir)
      .filter((d) => /^\d+\.\d+\.\d+/.test(d))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return null;
  }
  for (let i = versions.length - 1; i >= 0; i--) {
    const candidate = join(baseDir, versions[i], ...relParts);
    try { if (existsSync(candidate)) return candidate; } catch {}
  }
  return null;
}
