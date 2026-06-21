import { describe, test, expect } from "vitest";
import {
  parseUsageText,
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
