import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planTier, classify, readBudget, budgetLine, nudgeSuffix, STALE_MS } = require("./budget.js");

/**
 * The budget class is the delegation policy's fourth input. What must hold:
 * a Pro plan is tight from 0 % (the parallel-tier question is asked there
 * even on a fresh window — user decision 2026-09-14); Max 20x stays
 * comfortable until the window is nearly gone; missing data never tightens
 * on its own and never crashes a hook.
 */

function home(files) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "budget-home-"));
  fs.mkdirSync(path.join(h, ".claude"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(h, ".claude", name), JSON.stringify(body));
  }
  return h;
}

describe("planTier", () => {
  test("labels from usage-live.json and rateLimitTier both resolve", () => {
    expect(planTier("Max 20x")).toBe("max20");
    expect(planTier("Max 5x")).toBe("max5");
    expect(planTier("Pro")).toBe("pro");
    expect(planTier("default_claude_max_20x")).toBe("max20");
    expect(planTier("default_claude_max_5x")).toBe("max5");
    expect(planTier("default_claude_pro")).toBe("pro");
    expect(planTier("Max Plan")).toBe("unknown"); // the status line's placeholder
    expect(planTier(null)).toBe("unknown");
  });
});

describe("classify", () => {
  test("Pro is tight at 0 % and critical at 70 % / 85 %", () => {
    expect(classify({ tier: "pro", fivePct: 0, weeklyPct: 0 })).toBe("tight");
    expect(classify({ tier: "pro", fivePct: 69, weeklyPct: 84 })).toBe("tight");
    expect(classify({ tier: "pro", fivePct: 70, weeklyPct: 0 })).toBe("critical");
    expect(classify({ tier: "pro", fivePct: 0, weeklyPct: 85 })).toBe("critical");
  });

  test("Max 5x / Max 20x are comfortable until their thresholds", () => {
    expect(classify({ tier: "max5", fivePct: 79, weeklyPct: 89 })).toBe("comfortable");
    expect(classify({ tier: "max5", fivePct: 80, weeklyPct: 0 })).toBe("tight");
    expect(classify({ tier: "max5", fivePct: 0, weeklyPct: 98 })).toBe("critical");
    expect(classify({ tier: "max20", fivePct: 89, weeklyPct: 94 })).toBe("comfortable");
    expect(classify({ tier: "max20", fivePct: 90, weeklyPct: 0 })).toBe("tight");
    expect(classify({ tier: "max20", fivePct: 98, weeklyPct: 0 })).toBe("critical");
  });

  test("unknown tier uses the Max 5x rules; missing usage counts as 0", () => {
    expect(classify({ tier: "unknown", fivePct: null, weeklyPct: null })).toBe("comfortable");
    expect(classify({ tier: "unknown", fivePct: 80, weeklyPct: null })).toBe("tight");
  });
});

describe("readBudget", () => {
  test("reads the live snapshot; fresh Max 20x session is comfortable", () => {
    const h = home({
      "usage-live.json": { timestamp: new Date().toISOString(), session: { pct: 56, resetInMinutes: 52 }, weekly: { pct: 43 }, plan: "Max 20x" },
    });
    const b = readBudget(h);
    expect(b).toMatchObject({ plan: "Max 20x", tier: "max20", fivePct: 56, weeklyPct: 43, resetInMinutes: 52, stale: false, cls: "comfortable" });
    expect(budgetLine(b)).toBe("[budget] Max 20x · 5h 56% (reset 52 min) · week 43% → comfortable");
    expect(nudgeSuffix(b)).toBe("");
  });

  test("plan placeholder falls back to the credentials tier; only that key is touched", () => {
    const h = home({
      "usage-live.json": { timestamp: new Date().toISOString(), session: { pct: 3 }, weekly: { pct: 10 }, plan: "Max Plan" },
      ".credentials.json": { claudeAiOauth: { accessToken: "SECRET", rateLimitTier: "default_claude_pro" } },
    });
    const b = readBudget(h);
    expect(b.tier).toBe("pro");
    expect(b.cls).toBe("tight");
    expect(budgetLine(b)).not.toContain("SECRET");
    expect(nudgeSuffix(b)).toContain("ask once");
  });

  test("stale snapshot is flagged but still classified", () => {
    const old = new Date(Date.now() - STALE_MS - 60_000).toISOString();
    const h = home({ "usage-live.json": { timestamp: old, session: { pct: 72, resetInMinutes: 5 }, weekly: { pct: 20 }, plan: "Pro" } });
    const b = readBudget(h);
    expect(b.stale).toBe(true);
    expect(b.cls).toBe("critical");
    expect(budgetLine(b)).toContain("· stale");
    expect(nudgeSuffix(b)).toContain("reset in 5 min");
  });

  test("no files at all → unknown, comfortable, visible in the line", () => {
    const b = readBudget(fs.mkdtempSync(path.join(os.tmpdir(), "budget-empty-")));
    expect(b.cls).toBe("comfortable");
    expect(budgetLine(b)).toBe("[budget] plan unknown · usage unknown → comfortable (no plan info — Max 5x rules)");
  });
});
