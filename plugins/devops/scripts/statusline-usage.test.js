import { describe, test, expect } from "vitest";
import {
  validPct,
  resetInMinutes,
  buildSnapshot,
  snapshotChanged,
  renderStatusLine,
} from "./statusline-usage.js";

// Fixed "now" so epoch→minutes mapping is deterministic.
const NOW = Date.parse("2026-06-06T12:00:00.000Z");
const NOW_SEC = NOW / 1000;

const hostJson = (fivePct, fiveResetMinFromNow, sevenPct, sevenResetMinFromNow) => ({
  model: { display_name: "Opus 4.8" },
  rate_limits: {
    five_hour: { used_percentage: fivePct, resets_at: NOW_SEC + fiveResetMinFromNow * 60 },
    seven_day: { used_percentage: sevenPct, resets_at: NOW_SEC + sevenResetMinFromNow * 60 },
  },
});

describe("validPct — trust gate (also defuses #52326 epoch leak)", () => {
  test.each([
    [0, true], [42, true], [100, true],
    [-1, false], [101, false], [NaN, false], [Infinity, false],
    [NOW_SEC, false], // epoch-sized leak must be rejected
    ["42", false], [null, false], [undefined, false],
  ])("%s → %s", (v, ok) => {
    expect(validPct(v)).toBe(ok);
  });
});

describe("resetInMinutes — epoch seconds → minutes from now", () => {
  test("180 min ahead → 180", () => {
    expect(resetInMinutes(NOW_SEC + 180 * 60, NOW)).toBe(180);
  });
  test("already passed → floored at 0", () => {
    expect(resetInMinutes(NOW_SEC - 60, NOW)).toBe(0);
  });
  test("missing / non-numeric → null", () => {
    expect(resetInMinutes(undefined, NOW)).toBe(null);
    expect(resetInMinutes("nope", NOW)).toBe(null);
  });
});

describe("buildSnapshot — happy path", () => {
  test("both windows valid → full schema-correct snapshot", () => {
    const snap = buildSnapshot(hostJson(42, 180, 18, 2880), null, NOW);
    expect(snap).toEqual({
      timestamp: new Date(NOW).toISOString(),
      session: { pct: 42, resetInMinutes: 180 },
      weekly: { pct: 18, resetDay: null, resetTime: null, resetInMinutes: 2880 },
      plan: "Max Plan",
    });
  });
});

describe("buildSnapshot — gap handling (#40094 / #52326 / pre-first-response)", () => {
  test("no rate_limits at all → null (don't overwrite)", () => {
    expect(buildSnapshot({ model: { display_name: "Opus" } }, null, NOW)).toBe(null);
  });

  test("epoch-leaked five_hour pct (>100) → window rejected, carried from prev", () => {
    const prev = {
      timestamp: "old",
      session: { pct: 40, resetInMinutes: 200 },
      weekly: { pct: 17, resetDay: null, resetTime: null, resetInMinutes: 3000 },
      plan: "Max Plan",
    };
    const host = hostJson(NOW_SEC /* leaked */, 180, 18, 2880);
    const snap = buildSnapshot(host, prev, NOW);
    expect(snap.session).toEqual(prev.session); // carried over, not clobbered
    expect(snap.weekly.pct).toBe(18); // weekly was valid → updated
  });

  test("seven_day window absent → weekly carried from prev, session updated", () => {
    const prev = {
      session: { pct: 40, resetInMinutes: 200 },
      weekly: { pct: 17, resetDay: null, resetTime: null, resetInMinutes: 3000 },
    };
    const host = { rate_limits: { five_hour: { used_percentage: 50, resets_at: NOW_SEC + 60 * 60 } } };
    const snap = buildSnapshot(host, prev, NOW);
    expect(snap.session).toEqual({ pct: 50, resetInMinutes: 60 });
    expect(snap.weekly).toEqual(prev.weekly);
  });

  test("both windows invalid AND no prev → null", () => {
    const host = { rate_limits: { five_hour: { used_percentage: 999 }, seven_day: {} } };
    expect(buildSnapshot(host, null, NOW)).toBe(null);
  });

  test("preserves prior weeklySonnet and plan label", () => {
    const prev = { weeklySonnet: { pct: 9 }, plan: "Max Plan 20x" };
    const snap = buildSnapshot(hostJson(42, 180, 18, 2880), prev, NOW);
    expect(snap.weeklySonnet).toEqual({ pct: 9 });
    expect(snap.plan).toBe("Max Plan 20x");
  });
});

describe("snapshotChanged — throttle helper", () => {
  const base = { session: { pct: 42, resetInMinutes: 180 }, weekly: { pct: 18, resetInMinutes: 2880 } };
  test("no prev → changed", () => expect(snapshotChanged(null, base)).toBe(true));
  test("identical values → unchanged", () => {
    expect(snapshotChanged({ ...base }, { ...base })).toBe(false);
  });
  test("pct moved → changed", () => {
    expect(snapshotChanged(base, { ...base, session: { pct: 43, resetInMinutes: 180 } })).toBe(true);
  });
});

describe("renderStatusLine — terminal line", () => {
  test("with data → model · 5h · Wk", () => {
    const snap = { session: { pct: 42 }, weekly: { pct: 18 } };
    expect(renderStatusLine(snap, { model: { display_name: "Opus 4.8" } }))
      .toBe("Opus 4.8  ·  5h 42%  ·  Wk 18%");
  });
  test("no snapshot → just the model name", () => {
    expect(renderStatusLine(null, { model: { display_name: "Opus 4.8" } })).toBe("Opus 4.8");
  });
  test("no snapshot, no model → empty", () => {
    expect(renderStatusLine(null, {})).toBe("");
  });
});
