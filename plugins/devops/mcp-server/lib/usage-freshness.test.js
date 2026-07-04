import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assessFreshness,
  isLiveSnapshot,
  describeScrapeFailure,
  pickNewestVersionScript,
  STALE_BARS_MAX_AGE_MIN,
} from "./usage-freshness.js";

const NOW = Date.parse("2026-07-04T10:00:00.000Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

describe("assessFreshness — one shared staleness verdict", () => {
  test("fresh live snapshot: young age, not cached, not expired", () => {
    const f = assessFreshness({ timestamp: minutesAgo(2), session: { pct: 10 } }, NOW);
    expect(f.ageMinutes).toBe(2);
    expect(f.cached).toBe(false);
    expect(f.expired).toBe(false);
  });

  test("cached marker is surfaced", () => {
    const f = assessFreshness({ timestamp: minutesAgo(40), _cached: true }, NOW);
    expect(f.cached).toBe(true);
    expect(f.expired).toBe(false); // 40min is stale-ish but bars still meaningful
  });

  test("a 33-day-old snapshot is expired — bars must not render", () => {
    const f = assessFreshness({ timestamp: minutesAgo(47_520), _cached: true }, NOW);
    expect(f.expired).toBe(true);
    expect(f.ageMinutes).toBe(47_520);
  });

  test(`expiry cutoff is ${STALE_BARS_MAX_AGE_MIN} minutes`, () => {
    expect(assessFreshness({ timestamp: minutesAgo(STALE_BARS_MAX_AGE_MIN - 1) }, NOW).expired).toBe(false);
    expect(assessFreshness({ timestamp: minutesAgo(STALE_BARS_MAX_AGE_MIN + 1) }, NOW).expired).toBe(true);
  });

  test("null data / missing timestamp → expired with infinite age", () => {
    expect(assessFreshness(null, NOW).expired).toBe(true);
    expect(assessFreshness({}, NOW).expired).toBe(true);
    expect(assessFreshness({ timestamp: "garbage" }, NOW).expired).toBe(true);
  });
});

describe("isLiveSnapshot — gate for baseline advancement AND delta computation", () => {
  test("live snapshot with session data → true", () => {
    expect(isLiveSnapshot({ session: { pct: 5 }, timestamp: minutesAgo(1) })).toBe(true);
  });

  test("cache-marked snapshot must NEVER advance the baseline (the +0% bug)", () => {
    expect(isLiveSnapshot({ session: { pct: 93 }, _cached: true })).toBe(false);
  });

  test("null / missing session → false", () => {
    expect(isLiveSnapshot(null)).toBe(false);
    expect(isLiveSnapshot({ weekly: { pct: 1 } })).toBe(false);
  });
});

describe("describeScrapeFailure — every execSync outcome gets a real reason", () => {
  test("exit 2 → login required", () => {
    expect(describeScrapeFailure({ status: 2 })).toMatch(/not logged in/i);
  });

  test("exit 3 / 4 / 5 keep their specific reasons", () => {
    expect(describeScrapeFailure({ status: 3 })).toMatch(/parse/i);
    expect(describeScrapeFailure({ status: 4 })).toMatch(/CDP/i);
    expect(describeScrapeFailure({ status: 5 })).toMatch(/launch/i);
  });

  test("exit 1 → crash hint incl. the dangling-plugin-path class", () => {
    const reason = describeScrapeFailure({ status: 1 });
    expect(reason).toMatch(/exit 1/i);
    expect(reason).toMatch(/crash|module/i);
  });

  test("status null (execSync timeout/kill) is NOT silent — names the timeout", () => {
    expect(describeScrapeFailure({ status: null, signal: "SIGTERM" })).toMatch(/time(d )?out|killed/i);
  });

  test("unknown numeric code falls back to a generic labelled reason", () => {
    expect(describeScrapeFailure({ status: 42 })).toMatch(/42/);
  });
});

describe("pickNewestVersionScript — runtime scraper resolution survives plugin updates", () => {
  let base;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), "usage-freshness-test-")); });
  afterEach(() => { try { rmSync(base, { recursive: true, force: true }); } catch {} });

  const addVersion = (v, withScript) => {
    const dir = join(base, v, "scripts");
    mkdirSync(dir, { recursive: true });
    if (withScript) writeFileSync(join(dir, "refresh-usage-headless.js"), "// stub");
  };

  test("picks the numerically newest version that has the script", () => {
    addVersion("0.9.0", true);
    addVersion("0.107.1", true);
    const picked = pickNewestVersionScript(base, ["scripts", "refresh-usage-headless.js"]);
    expect(picked).toContain("0.107.1");
  });

  test("skips a newer version dir that lacks the script", () => {
    addVersion("0.9.0", true);
    addVersion("0.108.0", false);
    const picked = pickNewestVersionScript(base, ["scripts", "refresh-usage-headless.js"]);
    expect(picked).toContain("0.9.0");
  });

  test("no candidates → null (caller falls back to its baked path)", () => {
    expect(pickNewestVersionScript(base, ["scripts", "refresh-usage-headless.js"])).toBeNull();
    expect(pickNewestVersionScript(join(base, "does-not-exist"), ["scripts", "x.js"])).toBeNull();
  });
});
