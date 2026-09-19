import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planTier, classify, readBudget, maybeRefreshUsage, budgetLine, nudgeSuffix, STALE_MS, REFRESH_MARKER } = require("./budget.js");

/**
 * The budget class is the delegation policy's fourth input. What must hold
 * (red-team + PO review 2026-09-14):
 *  - a Pro plan asks before a parallel spawn from 0 % (user decision);
 *  - Max 20x stays free until the window is nearly gone;
 *  - the credentials tier beats the sticky snapshot label (an upgrade must
 *    not be shadowed by an old "Pro" label);
 *  - a snapshot whose window has reset contributes NO usage — the morning
 *    after a 96 % evening must not be sonnet-only all day;
 *  - unknown plan + unknown usage asks, never silently free;
 *  - the credentials file never leaks anything but the tier string.
 */

const NOW = Date.parse("2026-09-14T20:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

function home(files) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "budget-home-"));
  fs.mkdirSync(path.join(h, ".claude"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(h, ".claude", name), JSON.stringify(body));
  }
  return h;
}

const read = (h, extra = {}) => readBudget({ home: h, nowMs: NOW, env: {}, ...extra });

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
  test("Pro asks from 0 % and is sonnet-only at 70 % / 85 %", () => {
    expect(classify({ tier: "pro", fivePct: 0, weeklyPct: 0 })).toBe("ask-before-parallel");
    expect(classify({ tier: "pro", fivePct: null, weeklyPct: null })).toBe("ask-before-parallel");
    expect(classify({ tier: "pro", fivePct: 69, weeklyPct: 84 })).toBe("ask-before-parallel");
    expect(classify({ tier: "pro", fivePct: 70, weeklyPct: 0 })).toBe("sonnet-only");
    expect(classify({ tier: "pro", fivePct: 0, weeklyPct: 85 })).toBe("sonnet-only");
  });

  test("Max 5x / Max 20x are free until their thresholds", () => {
    expect(classify({ tier: "max5", fivePct: 79, weeklyPct: 89 })).toBe("free");
    expect(classify({ tier: "max5", fivePct: 80, weeklyPct: 0 })).toBe("ask-before-parallel");
    expect(classify({ tier: "max5", fivePct: 0, weeklyPct: 98 })).toBe("sonnet-only");
    expect(classify({ tier: "max20", fivePct: 89, weeklyPct: 94 })).toBe("free");
    expect(classify({ tier: "max20", fivePct: 90, weeklyPct: 0 })).toBe("ask-before-parallel");
    expect(classify({ tier: "max20", fivePct: 98, weeklyPct: 0 })).toBe("sonnet-only");
  });

  test("unknown tier: no usage → ask; with usage → Max 5x rules", () => {
    expect(classify({ tier: "unknown", fivePct: null, weeklyPct: null })).toBe("ask-before-parallel");
    expect(classify({ tier: "unknown", fivePct: 10, weeklyPct: null })).toBe("free");
    expect(classify({ tier: "unknown", fivePct: 80, weeklyPct: null })).toBe("ask-before-parallel");
  });
});

describe("readBudget", () => {
  test("fresh Max 20x session is free; the line names window + week", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - 60_000), session: { pct: 56, resetInMinutes: 52 }, weekly: { pct: 43, resetInMinutes: 7942 }, plan: "Max 20x" },
    });
    const b = read(h);
    expect(b).toMatchObject({ plan: "Max 20x", tier: "max20", fivePct: 56, weeklyPct: 43, resetInMinutes: 51, stale: false, cls: "free", binding: "5h" });
    expect(budgetLine(b)).toBe("[budget] Max 20x · window 56% (reset 51 min) · week 43% → free");
    expect(nudgeSuffix(b)).toBe("");
  });

  test("credentials tier beats a sticky snapshot label; only the tier string surfaces", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 3, resetInMinutes: 200 }, weekly: { pct: 10, resetInMinutes: 5000 }, plan: "Pro" },
      ".credentials.json": { claudeAiOauth: { accessToken: "SECRET", refreshToken: "ALSO-SECRET", rateLimitTier: "default_claude_max_20x" } },
    });
    const b = read(h);
    expect(b.tier).toBe("max20");
    expect(b.cls).toBe("free");
    expect(JSON.stringify(b) + budgetLine(b) + nudgeSuffix(b)).not.toMatch(/SECRET/);
  });

  test("Pro from credentials asks before parallel at 0 %, with the sonnet 1-agent suffix", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 0, resetInMinutes: 300 }, weekly: { pct: 0, resetInMinutes: 9000 }, plan: "Max Plan" },
      ".credentials.json": { claudeAiOauth: { rateLimitTier: "default_claude_pro" } },
    });
    const b = read(h);
    expect(b.cls).toBe("ask-before-parallel");
    expect(nudgeSuffix(b)).toContain("1-agent tier → sonnet ≤10 calls");
    expect(nudgeSuffix(b)).toContain("inline / 1 sonnet agent / full");
  });

  test("a snapshot whose window has reset contributes no usage (morning-after Desktop session)", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - 10 * 60 * 60_000), session: { pct: 96, resetInMinutes: 25 }, weekly: { pct: 40, resetInMinutes: 4000 }, plan: "Pro" },
    });
    const b = read(h);
    expect(b.fivePct).toBeNull();
    expect(b.resetInMinutes).toBeNull();
    expect(b.weeklyPct).toBe(40); // the week has NOT reset
    expect(b.cls).toBe("ask-before-parallel"); // Pro by plan only — never sonnet-only from a dead 96 %
    expect(budgetLine(b)).toContain("window ?");
  });

  test("a fully expired snapshot reads as usage unknown, and says why", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - 20 * 24 * 60 * 60_000), session: { pct: 96, resetInMinutes: 25 }, weekly: { pct: 99, resetInMinutes: 100 }, plan: "Max 5x" },
    });
    const b = read(h);
    expect(b.cls).toBe("free");
    expect(budgetLine(b)).toBe("[budget] Max 5x · usage unknown (snapshot past its reset) → free");
  });

  test("weekly-driven sonnet-only names the week as the binding limit, not the 5h window", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 5, resetInMinutes: 280 }, weekly: { pct: 98, resetInMinutes: 1500 }, plan: "Max 5x" },
    });
    const b = read(h);
    expect(b.cls).toBe("sonnet-only");
    expect(b.binding).toBe("week");
    expect(nudgeSuffix(b)).toContain("week resets in 25 h");
    expect(budgetLine(b)).toContain("week 98% (reset 25 h)");
  });

  test("stale-but-not-expired snapshot is flagged and still classified", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - STALE_MS - 60_000), session: { pct: 72, resetInMinutes: 400 }, weekly: { pct: 20, resetInMinutes: 5000 }, plan: "Pro" },
    });
    const b = read(h);
    expect(b.stale).toBe(true);
    expect(b.cls).toBe("sonnet-only");
    expect(budgetLine(b)).toContain("· stale");
  });

  test("no files at all → unknown plan asks before parallel, visibly", () => {
    const b = read(fs.mkdtempSync(path.join(os.tmpdir(), "budget-empty-")));
    expect(b.cls).toBe("ask-before-parallel");
    expect(budgetLine(b)).toBe("[budget] plan unknown · usage unknown → ask-before-parallel (no plan info — asks once before parallel)");
  });

  test("env override wins and is labelled (EVAL_* form for eval runs)", () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), "budget-empty-"));
    expect(read(h, { env: { EVAL_DOTCLAUDE_BUDGET: "free" } }).cls).toBe("free");
    expect(budgetLine(read(h, { env: { DOTCLAUDE_BUDGET: "sonnet-only" } }))).toContain("→ sonnet-only (env override)");
    expect(read(h, { env: { DOTCLAUDE_BUDGET: "nonsense" } }).cls).toBe("ask-before-parallel");
  });

  test("credentials are parsed once per session (cache file), then never re-read", () => {
    const h = home({ ".credentials.json": { claudeAiOauth: { rateLimitTier: "default_claude_max_5x" } } });
    const sid = `vitest-budget-${process.pid}-${Date.now()}`;
    expect(read(h, { sessionId: sid }).tier).toBe("max5");
    fs.unlinkSync(path.join(h, ".claude", ".credentials.json"));
    expect(read(h, { sessionId: sid }).tier).toBe("max5"); // served from the session cache
    fs.unlinkSync(path.join(os.tmpdir(), `dotclaude-budget-tier-${sid}`));
  });
});

describe("maybeRefreshUsage — a dead snapshot starts one detached scraper", () => {
  /**
   * The Desktop app never runs the statusLine writer, so usage-live.json is
   * only as fresh as the last completion card — the morning-after session
   * classified on "week 97 %" from last night with the 5 h window unknown.
   * The fix is what the card does, minus the wait: spawn the headless
   * scraper (--no-login) detached and let the next prompt re-read the file.
   */
  const stubRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "budget-root-"));
    fs.mkdirSync(path.join(root, "scripts"));
    // The stub records its argv next to itself instead of launching Edge.
    fs.writeFileSync(path.join(root, "scripts", "refresh-usage-headless.js"),
      "require('fs').writeFileSync(__dirname + '/called.json', JSON.stringify(process.argv.slice(2)));");
    return root;
  };
  const withProfile = (h) => { fs.mkdirSync(path.join(h, ".claude", "edge-usage-profile")); return h; };
  const dead = () => withProfile(home({
    "usage-live.json": { timestamp: iso(NOW - 10 * 3_600_000), session: { pct: 26, resetInMinutes: 148 }, weekly: { pct: 97, resetInMinutes: 2058 }, plan: "Max 20x" },
  }));
  const waitFor = async (file) => { for (let i = 0; i < 100 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 50)); };
  const clearMarker = () => { try { fs.unlinkSync(REFRESH_MARKER); } catch {} };

  test("expired snapshot + scraper profile → spawns --quiet --no-login and says so in the line", async () => {
    clearMarker();
    const root = stubRoot();
    const h = dead();
    const b = read(h);
    expect(b.expired).toBe(true);
    expect(b.cls).toBe("ask-before-parallel"); // week 97 % still counts; the 5 h window is unknown
    b.refreshing = maybeRefreshUsage(b, { home: h, nowMs: NOW, env: {}, pluginRoot: root });
    expect(b.refreshing).toBe(true);
    expect(budgetLine(b)).toContain("→ ask-before-parallel (snapshot refreshing");
    await waitFor(path.join(root, "scripts", "called.json"));
    expect(JSON.parse(fs.readFileSync(path.join(root, "scripts", "called.json"), "utf8"))).toEqual(["--quiet", "--no-login"]);
  });

  test("second call inside the cooldown does nothing — parallel sessions and every prompt must not stack scrapers", () => {
    const root = stubRoot();
    const h = dead();
    const b = read(h);
    expect(maybeRefreshUsage(b, { home: h, nowMs: NOW + 60_000, env: {}, pluginRoot: root })).toBe(false);
    expect(fs.existsSync(path.join(root, "scripts", "called.json"))).toBe(false);
  });

  test("never spawns when: snapshot is live, no scraper profile, env override, DEVOPS_COMPLETION_NO_USAGE, or no script", () => {
    clearMarker();
    const root = stubRoot();
    const live = withProfile(home({
      "usage-live.json": { timestamp: iso(NOW - 60_000), session: { pct: 26, resetInMinutes: 148 }, weekly: { pct: 50, resetInMinutes: 2058 }, plan: "Max 20x" },
    }));
    expect(maybeRefreshUsage(read(live), { home: live, nowMs: NOW, env: {}, pluginRoot: root })).toBe(false);
    const noProfile = home({
      "usage-live.json": { timestamp: iso(NOW - 10 * 3_600_000), session: { pct: 26, resetInMinutes: 148 }, weekly: { pct: 97, resetInMinutes: 2058 }, plan: "Max 20x" },
    });
    expect(maybeRefreshUsage(read(noProfile), { home: noProfile, nowMs: NOW, env: {}, pluginRoot: root })).toBe(false);
    const h = dead();
    expect(maybeRefreshUsage(read(h, { env: { DOTCLAUDE_BUDGET: "free" } }), { home: h, nowMs: NOW, env: {}, pluginRoot: root })).toBe(false);
    expect(maybeRefreshUsage(read(h), { home: h, nowMs: NOW, env: { DEVOPS_COMPLETION_NO_USAGE: "1" }, pluginRoot: root })).toBe(false);
    expect(maybeRefreshUsage(read(h), { home: h, nowMs: NOW, env: {}, pluginRoot: fs.mkdtempSync(path.join(os.tmpdir(), "budget-noscript-")) })).toBe(false);
    expect(fs.existsSync(path.join(root, "scripts", "called.json"))).toBe(false);
    clearMarker();
  });
});
