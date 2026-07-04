import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseUsageText,
  mapApiUsage,
  writeJsonAtomic,
  isMarkerPending,
  shouldOpenLoginWindow,
  LOGIN_RETRY_AFTER_MS,
} from "./refresh-usage-headless.js";

// Fixed "now" so the age math is deterministic.
const NOW = Date.parse("2026-06-18T12:00:00.000Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

describe("isMarkerPending — login-once retry window", () => {
  test("retry window is 30 minutes", () => {
    expect(LOGIN_RETRY_AFTER_MS).toBe(30 * 60 * 1000);
  });

  test("a window opened just now is pending → no reopen", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(0) }, NOW)).toBe(true);
  });

  test("opened 10 min ago → still pending (within window)", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(10) }, NOW)).toBe(true);
  });

  test("opened 29 min ago → still pending", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(29) }, NOW)).toBe(true);
  });

  test("opened 31 min ago → expired, one retry allowed", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(31) }, NOW)).toBe(false);
  });

  test.each([
    ["null marker", null],
    ["undefined marker", undefined],
    ["empty object", {}],
    ["missing openedAt", { pid: 1234 }],
    ["unparseable openedAt", { openedAt: "not-a-date" }],
  ])("%s → not pending (fail open, allow a fresh window)", (_label, marker) => {
    expect(isMarkerPending(marker, NOW)).toBe(false);
  });
});

describe("shouldOpenLoginWindow — login-window policy", () => {
  test("--no-login mode never opens a window (automatic card path)", () => {
    expect(shouldOpenLoginWindow({ noLogin: true, loginPending: false })).toBe(false);
    expect(shouldOpenLoginWindow({ noLogin: true, loginPending: true })).toBe(false);
  });

  test("manual run with no pending window may open one", () => {
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: false })).toBe(true);
  });

  test("manual run never stacks onto an already-pending window", () => {
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: true })).toBe(false);
  });
});

describe("mapApiUsage — claude.ai internal usage API → usage-live.json schema", () => {
  // Shape captured live from GET /api/organizations/{id}/usage on 2026-07-04.
  const apiUsage = {
    five_hour: { utilization: 80.0, resets_at: new Date(NOW + 150 * 60_000).toISOString() },
    seven_day: { utilization: 45.4, resets_at: new Date(NOW + 2 * 24 * 60 * 60_000).toISOString() },
    seven_day_sonnet: null,
    limits: [
      { kind: "session", group: "session", percent: 80, severity: "warning" },
      { kind: "weekly_all", group: "weekly", percent: 45, severity: "normal" },
    ],
  };
  const apiRateLimits = { rate_limit_tier: "default_claude_max_5x" };

  test("maps five_hour/seven_day onto session/weekly with rounded pcts", () => {
    const snap = mapApiUsage(apiUsage, apiRateLimits, NOW);
    expect(snap.session).toEqual({ pct: 80, resetInMinutes: 150 });
    expect(snap.weekly.pct).toBe(45);
    expect(snap.weekly.resetInMinutes).toBe(2 * 24 * 60);
  });

  test("weekly resetDay/resetTime are null (API carries durations, not day strings)", () => {
    const snap = mapApiUsage(apiUsage, apiRateLimits, NOW);
    expect(snap.weekly.resetDay).toBeNull();
    expect(snap.weekly.resetTime).toBeNull();
  });

  test("stamps a fresh timestamp from nowMs and no _cached markers", () => {
    const snap = mapApiUsage(apiUsage, apiRateLimits, NOW);
    expect(snap.timestamp).toBe(new Date(NOW).toISOString());
    expect(snap._cached).toBeUndefined();
    expect(snap._ageMinutes).toBeUndefined();
  });

  test("plan label is humanized from the rate_limit_tier", () => {
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "default_claude_max_5x" }, NOW).plan).toBe("Max 5x");
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "default_claude_max_20x" }, NOW).plan).toBe("Max 20x");
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "default_claude_pro" }, NOW).plan).toBe("Pro");
  });

  test("missing/unknown rate limits fall back to the generic plan label", () => {
    expect(mapApiUsage(apiUsage, null, NOW).plan).toBe("Max Plan");
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "something_new" }, NOW).plan).toBe("Max Plan");
  });

  test("weeklySonnet omitted when seven_day_sonnet is null, mapped when present", () => {
    expect(mapApiUsage(apiUsage, null, NOW).weeklySonnet).toBeUndefined();
    const withSonnet = { ...apiUsage, seven_day_sonnet: { utilization: 12.4 } };
    expect(mapApiUsage(withSonnet, null, NOW).weeklySonnet).toEqual({ pct: 12 });
  });

  test("missing seven_day → weekly null, session still mapped", () => {
    const snap = mapApiUsage({ five_hour: apiUsage.five_hour }, null, NOW);
    expect(snap.session.pct).toBe(80);
    expect(snap.weekly).toBeNull();
  });

  test("invalid or missing five_hour utilization → null (don't write garbage)", () => {
    expect(mapApiUsage(null, null, NOW)).toBeNull();
    expect(mapApiUsage({}, null, NOW)).toBeNull();
    expect(mapApiUsage({ five_hour: { utilization: "NaN%" } }, null, NOW)).toBeNull();
    expect(mapApiUsage({ five_hour: { utilization: null } }, null, NOW)).toBeNull();
  });

  test("resets_at in the past clamps to 0; missing resets_at → null", () => {
    const past = { five_hour: { utilization: 5, resets_at: new Date(NOW - 60_000).toISOString() } };
    expect(mapApiUsage(past, null, NOW).session.resetInMinutes).toBe(0);
    const none = { five_hour: { utilization: 5 } };
    expect(mapApiUsage(none, null, NOW).session.resetInMinutes).toBeNull();
  });

  test("utilization beyond [0,100] is clamped — an over-quota 118% must not overflow the bar", () => {
    const over = { five_hour: { utilization: 118.5 }, seven_day: { utilization: -3 } };
    const snap = mapApiUsage(over, null, NOW);
    expect(snap.session.pct).toBe(100);
    expect(snap.weekly.pct).toBe(0);
  });

  test("seven_day present but without utilization → weekly null (renderers need a pct; a bare resets_at is not renderable)", () => {
    const shape = { five_hour: { utilization: 9 }, seven_day: { resets_at: new Date(NOW + 60_000).toISOString() } };
    expect(mapApiUsage(shape, null, NOW).weekly).toBeNull();
  });
});

describe("writeJsonAtomic — persistence must survive Windows rename contention", () => {
  let dir;
  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} dir = null; }
  });

  test("writes parseable JSON content to the target path", () => {
    dir = mkdtempSync(join(tmpdir(), "usage-atomic-test-"));
    const target = join(dir, "usage-live.json");
    writeJsonAtomic(target, { session: { pct: 7 } });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ session: { pct: 7 } });
  });

  test("falls back to a direct write when renameSync throws (EPERM with a concurrent open reader on NTFS)", () => {
    dir = mkdtempSync(join(tmpdir(), "usage-atomic-test-"));
    const target = join(dir, "usage-live.json");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const err = new Error("EPERM: operation not permitted");
      err.code = "EPERM";
      throw err;
    });
    writeJsonAtomic(target, { session: { pct: 42 } });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ session: { pct: 42 } });
  });
});

describe("parseUsageText — claude.ai usage scrape", () => {
  const sample = [
    "Aktuelle Nutzung",
    "42 % verwendet",
    "Zurücksetzung in 2 Std. 30 Min.",
    "Alle Modelle",
    "18 % verwendet",
    "Zurücksetzung Mi., 09:00",
  ].join("\n");

  test("extracts session + weekly percentages", () => {
    const parsed = parseUsageText(sample);
    expect(parsed).not.toBeNull();
    expect(parsed.session.pct).toBe(42);
    expect(parsed.weekly.pct).toBe(18);
  });

  test("parses the session reset duration to minutes", () => {
    const parsed = parseUsageText(sample);
    expect(parsed.session.resetInMinutes).toBe(150); // 2h 30m
  });

  test("English wording is parsed too", () => {
    const en = "Current usage\n7 % used\nResets in 45 min\nAll Models\n3 % used";
    const parsed = parseUsageText(en);
    expect(parsed.session.pct).toBe(7);
    expect(parsed.session.resetInMinutes).toBe(45);
    expect(parsed.weekly.pct).toBe(3);
  });

  test("fewer than two percentages → null (don't write garbage)", () => {
    expect(parseUsageText("42 % verwendet")).toBeNull();
    expect(parseUsageText("no usage here at all")).toBeNull();
  });
});
