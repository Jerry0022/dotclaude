import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  planArm,
  planCancel,
  readMarker,
  writeMarker,
  clearMarker,
  computeShutdownDelaySeconds,
  isCacheFresh,
  FIVE_HOURS_SEC,
  FLOOR_SEC,
  REFRESH_MAX_AGE_MIN,
} from "./autonomous-shutdown-timer.js";

// Fixed "now" so age-correction is deterministic.
const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const atNow = (resetInMinutes, ageMin = 0) => ({
  timestamp: new Date(NOW - ageMin * 60000).toISOString(),
  session: { pct: 30, resetInMinutes },
});

describe("computeShutdownDelaySeconds — reset-window mapping", () => {
  test("fresh snapshot, full window → ~5h, capped exactly at 5h", () => {
    const r = computeShutdownDelaySeconds(atNow(300), NOW);
    expect(r.seconds).toBe(FIVE_HOURS_SEC);
    expect(r.source).toBe("reset-window"); // 300min == cap, not over → not 'capped'
  });

  test("mid window (180 min remaining) → 180 min timer", () => {
    const r = computeShutdownDelaySeconds(atNow(180), NOW);
    expect(r.seconds).toBe(180 * 60);
    expect(r.minutes).toBe(180);
    expect(r.source).toBe("reset-window");
  });

  test("just above floor (120 min) → unchanged", () => {
    const r = computeShutdownDelaySeconds(atNow(120), NOW);
    expect(r.seconds).toBe(120 * 60);
    expect(r.source).toBe("reset-window");
  });
});

describe("computeShutdownDelaySeconds — floor guards short windows", () => {
  test("20 min remaining → floored to 90 min", () => {
    const r = computeShutdownDelaySeconds(atNow(20), NOW);
    expect(r.seconds).toBe(FLOOR_SEC);
    expect(r.minutes).toBe(90);
    expect(r.source).toBe("reset-window-floored");
  });

  test("exactly at floor boundary (90 min) → not flagged floored", () => {
    const r = computeShutdownDelaySeconds(atNow(90), NOW);
    expect(r.seconds).toBe(FLOOR_SEC);
    expect(r.source).toBe("reset-window");
  });
});

describe("computeShutdownDelaySeconds — cap guards long/over windows", () => {
  test("override-style >5h is capped", () => {
    const r = computeShutdownDelaySeconds(atNow(600), NOW);
    expect(r.seconds).toBe(FIVE_HOURS_SEC);
    expect(r.source).toBe("reset-window-capped");
  });
});

describe("computeShutdownDelaySeconds — age correction", () => {
  test("200 min remaining but snapshot 60 min old → 140 min effective", () => {
    const r = computeShutdownDelaySeconds(atNow(200, 60), NOW);
    expect(r.minutes).toBe(140);
    expect(r.source).toBe("reset-window");
  });

  test("window already elapsed after age correction → fallback 5h", () => {
    // 30 min remaining at snapshot, but 45 min have passed → period reset.
    const r = computeShutdownDelaySeconds(atNow(30, 45), NOW);
    expect(r.seconds).toBe(FIVE_HOURS_SEC);
    expect(r.source).toBe("fallback-5h");
  });
});

describe("computeShutdownDelaySeconds — fallback to 5h", () => {
  test.each([
    ["null usage", null],
    ["empty object", {}],
    ["missing session", { timestamp: new Date(NOW).toISOString() }],
    ["missing timestamp", { session: { resetInMinutes: 120 } }],
    ["non-numeric resetInMinutes", atNow("nope")],
    ["zero resetInMinutes", atNow(0)],
    ["negative resetInMinutes", atNow(-10)],
  ])("%s → fallback 5h", (_label, usage) => {
    const r = computeShutdownDelaySeconds(usage, NOW);
    expect(r.seconds).toBe(FIVE_HOURS_SEC);
    expect(r.source).toBe("fallback-5h");
  });

  test("stale snapshot (>5h old) → fallback 5h", () => {
    const r = computeShutdownDelaySeconds(atNow(180, 6 * 60), NOW);
    expect(r.seconds).toBe(FIVE_HOURS_SEC);
    expect(r.source).toBe("fallback-5h");
  });

  test("future-dated snapshot (clock skew) → fallback 5h", () => {
    const r = computeShutdownDelaySeconds(atNow(180, -30), NOW);
    expect(r.seconds).toBe(FIVE_HOURS_SEC);
    expect(r.source).toBe("fallback-5h");
  });
});

describe("isCacheFresh — gate for the pre-arm usage refresh", () => {
  test("fresh snapshot (0 min old) → no scrape needed", () => {
    expect(isCacheFresh(atNow(180, 0), NOW)).toBe(true);
  });

  test("exactly at the age boundary → still fresh", () => {
    expect(isCacheFresh(atNow(180, REFRESH_MAX_AGE_MIN), NOW)).toBe(true);
  });

  test("just past the age boundary → stale, must refresh", () => {
    expect(isCacheFresh(atNow(180, REFRESH_MAX_AGE_MIN + 1), NOW)).toBe(false);
  });

  test.each([
    ["null usage", null],
    ["empty object", {}],
    ["missing timestamp", { session: { resetInMinutes: 120 } }],
  ])("%s → not fresh (must refresh)", (_label, usage) => {
    expect(isCacheFresh(usage, NOW)).toBe(false);
  });

  test("future-dated snapshot (clock skew) → not fresh", () => {
    expect(isCacheFresh(atNow(180, -5), NOW)).toBe(false);
  });
});

describe("child-process bounds (audit 2026-10-20)", () => {
  test("every shutdown.exe call carries a timeout", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "autonomous-shutdown-timer.js"), "utf8");
    const calls = src.match(/spawnSync\([^;]*;/gs).filter((c) => /exe|shutdownExe/.test(c));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c).toMatch(/timeout:/);
  });
});

describe("owner marker — several sessions share ONE Windows shutdown (H1)", () => {
  const T = Date.parse("2026-10-20T12:00:00.000Z");
  const H = 60 * 60 * 1000;

  test("arm keeps another session's LATER pending shutdown", () => {
    expect(planArm({ sessionId: "s1", fireAt: T + 4 * H }, "s2", T + 2 * H, T).action).toBe("keep");
    expect(planArm({ sessionId: "s1", fireAt: T + 2 * H }, "s2", T + 2 * H, T).action).toBe("keep");
  });

  test("arm replaces another session's shutdown only when ours fires later", () => {
    expect(planArm({ sessionId: "s1", fireAt: T + 2 * H }, "s2", T + 4 * H, T).action).toBe("arm");
  });

  test("arm re-arms freely over our own, a stale, or a missing marker", () => {
    expect(planArm({ sessionId: "s2", fireAt: T + 4 * H }, "s2", T + 2 * H, T).action).toBe("arm");
    expect(planArm({ sessionId: "s1", fireAt: T - 1 }, "s2", T + 2 * H, T).action).toBe("arm");
    expect(planArm(null, "s2", T + 2 * H, T).action).toBe("arm");
  });

  test("cancel only when the marker names our session (or is stale / missing)", () => {
    expect(planCancel({ sessionId: "s1", fireAt: T + H }, "s2", T).action).toBe("leave");
    expect(planCancel({ sessionId: "s2", fireAt: T + H }, "s2", T).action).toBe("cancel");
    expect(planCancel({ sessionId: "s1", fireAt: T - 1 }, "s2", T).action).toBe("cancel");
    expect(planCancel(null, "s2", T).action).toBe("cancel");
  });

  test("marker round-trips through a file; garbage reads as no marker", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shutdown-marker-"));
    const file = path.join(dir, "sub", "owner.json");
    try {
      writeMarker({ sessionId: "s1", fireAt: T + H }, file);
      expect(readMarker(file)).toEqual({ sessionId: "s1", fireAt: T + H });
      fs.writeFileSync(file, "{not json");
      expect(readMarker(file)).toBe(null);
      clearMarker(file);
      expect(readMarker(file)).toBe(null);
      clearMarker(file); // idempotent
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
