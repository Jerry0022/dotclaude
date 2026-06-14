import { describe, test, expect } from "vitest";
import {
  computeResumeDelayMinutes,
  toCronExpression,
  WINDOW_MAX_MIN,
  RESET_BUFFER_MIN,
} from "./autonomous-resume-schedule.js";

// Fixed "now" so age-correction is deterministic.
const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const atNow = (resetInMinutes, ageMin = 0) => ({
  timestamp: new Date(NOW - ageMin * 60000).toISOString(),
  session: { pct: 30, resetInMinutes },
});

describe("computeResumeDelayMinutes — reset-window mapping", () => {
  test("mid window (180 min remaining) → 180 + buffer", () => {
    const r = computeResumeDelayMinutes(atNow(180), NOW);
    expect(r.delayMinutes).toBe(180 + RESET_BUFFER_MIN);
    expect(r.source).toBe("reset-window");
    expect(r.effectiveMin).toBe(180);
  });

  test("imminent reset (3 min remaining) → fires soon, NO floor", () => {
    const r = computeResumeDelayMinutes(atNow(3), NOW);
    expect(r.delayMinutes).toBe(3 + RESET_BUFFER_MIN); // 13 — not floored to 90+
    expect(r.source).toBe("reset-window");
  });

  test("full window (300 min) → 300 + buffer, not flagged capped", () => {
    const r = computeResumeDelayMinutes(atNow(300), NOW);
    expect(r.delayMinutes).toBe(WINDOW_MAX_MIN + RESET_BUFFER_MIN);
    expect(r.source).toBe("reset-window");
  });

  test("over-window estimate (>5h) → clamped to 5h + buffer, flagged capped", () => {
    const r = computeResumeDelayMinutes(atNow(600), NOW);
    expect(r.delayMinutes).toBe(WINDOW_MAX_MIN + RESET_BUFFER_MIN);
    expect(r.source).toBe("reset-window-capped");
  });
});

describe("computeResumeDelayMinutes — age correction", () => {
  test("200 min remaining but snapshot 60 min old → 140 + buffer", () => {
    const r = computeResumeDelayMinutes(atNow(200, 60), NOW);
    expect(r.delayMinutes).toBe(140 + RESET_BUFFER_MIN);
    expect(r.effectiveMin).toBe(140);
    expect(r.source).toBe("reset-window");
  });

  test("window already elapsed after age correction → fallback 5h", () => {
    // 30 min remaining at snapshot, but 45 min have passed → period reset.
    const r = computeResumeDelayMinutes(atNow(30, 45), NOW);
    expect(r.delayMinutes).toBe(WINDOW_MAX_MIN);
    expect(r.source).toBe("fallback-5h");
  });
});

describe("computeResumeDelayMinutes — fallback to flat 5h (no buffer)", () => {
  test.each([
    ["null usage", null],
    ["empty object", {}],
    ["missing session", { timestamp: new Date(NOW).toISOString() }],
    ["missing timestamp", { session: { resetInMinutes: 120 } }],
    ["non-numeric resetInMinutes", atNow("nope")],
    ["zero resetInMinutes", atNow(0)],
    ["negative resetInMinutes", atNow(-10)],
  ])("%s → fallback 5h", (_label, usage) => {
    const r = computeResumeDelayMinutes(usage, NOW);
    expect(r.delayMinutes).toBe(WINDOW_MAX_MIN);
    expect(r.source).toBe("fallback-5h");
  });

  test("stale snapshot (>5h old) → fallback 5h", () => {
    const r = computeResumeDelayMinutes(atNow(180, 6 * 60), NOW);
    expect(r.delayMinutes).toBe(WINDOW_MAX_MIN);
    expect(r.source).toBe("fallback-5h");
  });

  test("future-dated snapshot (clock skew) → fallback 5h", () => {
    const r = computeResumeDelayMinutes(atNow(180, -30), NOW);
    expect(r.delayMinutes).toBe(WINDOW_MAX_MIN);
    expect(r.source).toBe("fallback-5h");
  });

  test("fallback delay carries NO buffer (flat 5h == 300)", () => {
    const r = computeResumeDelayMinutes(null, NOW);
    expect(r.delayMinutes).toBe(300);
  });
});

describe("toCronExpression — local-time 5-field one-shot", () => {
  test("builds M H D Mo * from local time, month is 1-based", () => {
    // Construct a known LOCAL time to avoid TZ flakiness in assertions.
    const local = new Date(2026, 5, 4, 14, 26, 0); // 2026-06-04 14:26 local (month idx 5 = June)
    expect(toCronExpression(local.getTime())).toBe("26 14 4 6 *");
  });

  test("rolls into next day/month correctly via Date arithmetic", () => {
    const local = new Date(2026, 0, 31, 23, 55, 0); // Jan 31 23:55 local
    const fireAt = local.getTime() + 30 * 60000; // +30 min → Feb 1 00:25
    expect(toCronExpression(fireAt)).toBe("25 0 1 2 *");
  });
});
