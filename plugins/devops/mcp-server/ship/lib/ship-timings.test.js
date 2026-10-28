import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordTiming, summarizeShip, shipDurationTest, outcomeOf, extrasOf } from "./ship-timings.js";

const tmp = [];
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function mkFile() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ship-timings-"));
  tmp.push(d);
  return path.join(d, "t.jsonl");
}
const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const base = (file, over = {}) => ({ cwd: os.tmpdir(), repo: "r", branch: "feat/x", file, startedAt: Date.parse("2026-10-26T10:00:00Z"), ...over });

describe("recordTiming", () => {
  test("appends one JSON line with the documented fields", () => {
    const file = mkFile();
    recordTiming(base(file, { tool: "ship_build", durationMs: 130_000, result: { success: true, testsReused: { x: 1 }, steps: [{ step: "test", durationMs: 90_000 }], load: { lockWaitMs: 4000 } } }));
    const [e] = lines(file);
    expect(e).toMatchObject({ ts: "2026-10-26T10:00:00.000Z", repo: "r", branch: "feat/x", tool: "ship_build", durationMs: 130_000, outcome: "success", repeat: 1, testsReused: true, lockWaitMs: 4000, stepMs: { test: 90_000 } });
  });

  test("repeat counts the same tool within one ship; a new preflight resets it", () => {
    const file = mkFile();
    recordTiming(base(file, { tool: "ship_preflight", durationMs: 1 }));
    recordTiming(base(file, { tool: "ship_build", durationMs: 1, result: { success: false } }));
    recordTiming(base(file, { tool: "ship_build", durationMs: 1 }));
    recordTiming(base(file, { tool: "ship_build", durationMs: 1, branch: "other" }));
    recordTiming(base(file, { tool: "ship_preflight", durationMs: 1 }));
    recordTiming(base(file, { tool: "ship_build", durationMs: 1 }));
    expect(lines(file).map((e) => e.repeat)).toEqual([1, 1, 2, 1, 1, 1]);
    expect(lines(file)[1].outcome).toBe("blocked");
  });

  test("rotates to the newer half past the size cap", () => {
    const file = mkFile();
    for (let i = 0; i < 20; i++) recordTiming(base(file, { tool: "ship_cleanup", durationMs: i, maxBytes: 2000 }));
    const kept = lines(file);
    expect(kept.length).toBeLessThan(20);
    expect(kept.at(-1).durationMs).toBe(19);
    expect(fs.statSync(file).size).toBeLessThan(2000 + 400);
  });

  test("never throws, even for an unwritable target or garbage input", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-timings-"));
    tmp.push(dir);
    expect(recordTiming(base(dir, { tool: "ship_build", durationMs: 1 }))).toBeNull(); // a directory, not a file
    expect(() => recordTiming(undefined)).not.toThrow();
    expect(() => recordTiming({})).not.toThrow();
  });
});

describe("summarizeShip", () => {
  test("matches by the repo key of cwd + branch", async () => {
    const file = mkFile();
    const { repoKey } = await import("./ship-timings.js");
    const repo = repoKey(os.tmpdir());
    const t0 = Date.parse("2026-10-26T10:00:00Z");
    const rec = (tool, off, ms) => recordTiming({ cwd: os.tmpdir(), repo, branch: "feat/x", file, tool, startedAt: t0 + off, durationMs: ms });
    rec("ship_preflight", 0, 5000);
    rec("ship_build", 10_000, 100_000);
    rec("ship_build", 130_000, 20_000);
    rec("ship_release", 160_000, 60_000);
    const s = summarizeShip({ cwd: os.tmpdir(), branch: "feat/x", file });
    expect(s.totalMs).toBe(220_000);
    expect(s.perTool).toEqual({ ship_preflight: 5000, ship_build: 120_000, ship_release: 60_000 });
    expect(s.repeats).toEqual({ ship_build: 2 });
    expect(summarizeShip({ cwd: os.tmpdir(), branch: "nope", file })).toBeNull();
  });

  test("null without a file, never throws on a corrupt one", () => {
    const file = mkFile();
    expect(summarizeShip({ cwd: os.tmpdir(), branch: "b", file })).toBeNull();
    fs.writeFileSync(file, "not json\n{broken");
    expect(summarizeShip({ cwd: os.tmpdir(), branch: "b", file })).toBeNull();
    // No args reads the real timings file — a ship running on this branch makes it non-null.
    expect(() => summarizeShip()).not.toThrow();
  });
});

describe("helpers", () => {
  test("shipDurationTest formats the card entry", () => {
    const s = { totalMs: 460_000, perTool: { ship_build: 130_000, ship_release: 75_000 }, repeats: {} };
    expect(shipDurationTest(s)).toEqual({ method: "Ship-Dauer", result: "7:40 min (Build 2:10 · Release 1:15)" });
    expect(shipDurationTest(s, "en").method).toBe("Ship duration");
    expect(shipDurationTest(null)).toBeNull();
  });
  test("outcomeOf / extrasOf", () => {
    expect(outcomeOf({ error: true })).toBe("error");
    expect(outcomeOf({ success: false })).toBe("blocked");
    expect(outcomeOf({ success: true })).toBe("success");
    expect(extrasOf("ship_release", { checks: { waitedMs: 7000 } })).toEqual({ checksWaitMs: 7000 });
  });
});
