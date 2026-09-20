import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planTier, classify, refreshDueMinutes, readBudget, maybeRefreshUsage, budgetLine, budgetSummary, nudgeSuffix, STALE_MS, FAILURE_BACKOFF_MS, REFRESH_MARKER } = require("./budget.js");

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
    expect(b.announce).toBe(true); // the positive signal: the previous reading no longer applies
    expect(budgetLine(b)).toBe("[budget] Max 5x · usage unknown (snapshot past its reset) → free — earlier limit messages and usage claims in this conversation no longer apply");
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

describe("the positive signal — a reset since the previous reading is announced, not silent", () => {
  /**
   * Incident 2026-09-20: a session that hit the weekly limit was retried after
   * the reset with a 16-char prompt. The suffix is empty for `free` and gated
   * on prompt length, no SessionStart fired, and the model carried "weekly
   * limit hit" from the transcript into its own /run-agents args. `announce`
   * is the stateless fix: the full line, naming the reset, on every prompt
   * while a window is past its reset or reset recently (PO + redteam review).
   */
  test("a fresh reading right after the weekly reset announces for a day and names the reset", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 3, resetInMinutes: 150 }, weekly: { pct: 1, resetInMinutes: 10080 - 120 }, plan: "Max 20x" },
    });
    const b = read(h);
    expect(b.recentReset).toBe("week");
    expect(b.announce).toBe(true);
    expect(budgetLine(b)).toBe("[budget] Max 20x · week reset 2 h ago · window 3% (reset 150 min) · week 1% → free — earlier limit messages and usage claims in this conversation no longer apply");
    expect(nudgeSuffix(b)).toBe(""); // the suffix contract is untouched: free stays silent there
  });

  test("a 5 h window that reset within the hour announces; one that reset 2 h ago does not", () => {
    const fresh = (resetInMinutes) => read(home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 4, resetInMinutes }, weekly: { pct: 40, resetInMinutes: 5000 }, plan: "Max 20x" },
    }));
    const recent = fresh(300 - 12);
    expect(recent.recentReset).toBe("5h");
    expect(budgetLine(recent)).toContain("5h window reset 12 min ago");
    const older = fresh(300 - 120);
    expect(older.recentReset).toBe(null);
    expect(older.announce).toBe(false);
    expect(budgetLine(older)).not.toContain("no longer apply");
  });

  test("5 h expired, week not: the week keeps its usage and drives the class (the optimism boundary)", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - 6 * 3_600_000), session: { pct: 90, resetInMinutes: 30 }, weekly: { pct: 96, resetInMinutes: 3000 }, plan: "Max 5x" },
    });
    const b = read(h);
    expect(b.fivePct).toBe(null);
    expect(b.weeklyPct).toBe(96);
    expect(b.cls).toBe("ask-before-parallel");
    expect(b.binding).toBe("week");
    expect(b.announce).toBe(true); // the 5 h reading is gone — say so
    expect(budgetLine(b)).toContain("window ? · week 96%");
  });

  test("both windows expired on a pro tier still asks — a reset never makes Pro free", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - 3 * 24 * 3_600_000), session: { pct: 96, resetInMinutes: 25 }, weekly: { pct: 99, resetInMinutes: 100 }, plan: "Pro" },
    });
    expect(read(h).cls).toBe("ask-before-parallel");
  });

  test("an env override never announces — the class is pinned, a reset changes nothing", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 3, resetInMinutes: 295 }, weekly: { pct: 1, resetInMinutes: 10000 }, plan: "Max 20x" },
    });
    expect(read(h, { env: { DOTCLAUDE_BUDGET: "sonnet-only" } }).announce).toBe(false);
  });
});

describe("a failed refresh is reported, never called 'refreshing', and not retried every prompt", () => {
  /**
   * refresh-usage-headless.js keeps the old reading on failure and stamps
   * `_cached` + `_failureReason` + `_failedAt` (markCached). Reading only the
   * timestamp made the line say "refreshing" forever and relaunched a
   * logged-out Edge every 5 min (redteam 2026-09-20 R2).
   */
  const stubRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "budget-root-"));
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(path.join(root, "scripts", "refresh-usage-headless.js"),
      "require('fs').writeFileSync(__dirname + '/called.json', '1');");
    return root;
  };
  const failed = (failedAgoMs) => {
    const h = home({
      "usage-live.json": {
        timestamp: iso(NOW - 10 * 3_600_000), session: { pct: 26, resetInMinutes: 148 }, weekly: { pct: 97, resetInMinutes: 2058 }, plan: "Max 20x",
        _cached: true, _ageMinutes: 600, _failureReason: "not logged in", _failedAt: iso(NOW - failedAgoMs),
      },
    });
    fs.mkdirSync(path.join(h, ".claude", "edge-usage-profile"));
    return h;
  };
  const clearMarker = () => { try { fs.unlinkSync(REFRESH_MARKER); } catch {} };

  test("the line names the failure and the fix; the refresh flag is overridden", () => {
    const b = read(failed(60_000));
    b.refreshing = true;
    expect(b.refreshFailed).toBe("not logged in");
    expect(budgetLine(b)).toContain("(refresh failed: not logged in — run /auto-usage)");
    expect(budgetLine(b)).not.toContain("refreshing");
  });

  test("inside the backoff no scraper is started; after it, one is", () => {
    clearMarker();
    const root = stubRoot();
    const recent = failed(5 * 60_000);
    expect(maybeRefreshUsage(read(recent), { home: recent, nowMs: NOW, env: {}, pluginRoot: root })).toBe(false);
    expect(fs.existsSync(path.join(root, "scripts", "called.json"))).toBe(false);
    const old = failed(FAILURE_BACKOFF_MS + 60_000);
    expect(maybeRefreshUsage(read(old), { home: old, nowMs: NOW, env: {}, pluginRoot: root })).toBe(true);
    clearMarker();
  });
});

describe("age-based refresh — due when the class may have tightened, plan-scaled, never at the limit", () => {
  /**
   * Usage is monotonic until a reset. A reading is worth refreshing only when
   * the worst-case burn since then could have crossed the next threshold:
   * headroom × window fill time (Pro 30 min, Max 5x 150, Max 20x 600). At
   * 99 % nothing above can change — only the reset informs (expired path),
   * and a reset a few minutes away makes a reading now worthless.
   */
  const stubRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "budget-root-"));
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(path.join(root, "scripts", "refresh-usage-headless.js"),
      "require('fs').writeFileSync(__dirname + '/called.json', '1');");
    return root;
  };
  const clearMarker = () => { try { fs.unlinkSync(REFRESH_MARKER); } catch {} };
  const snap = ({ ageMin, five, week, plan, reset = 200, weekReset = 5000 }) => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW - ageMin * 60_000), session: { pct: five, resetInMinutes: reset }, weekly: { pct: week, resetInMinutes: weekReset }, plan },
    });
    fs.mkdirSync(path.join(h, ".claude", "edge-usage-profile"));
    return h;
  };
  const refreshes = (h, root) => { clearMarker(); const r = maybeRefreshUsage(read(h), { home: h, nowMs: NOW, env: {}, pluginRoot: root }); clearMarker(); return r; };

  test("due time = headroom × fill time: Max 20x at 85 % → 30 min, Pro at 10 % → 18 min, Max 20x at 40 % → the 3 h cap", () => {
    expect(refreshDueMinutes({ tier: "max20", fivePct: 85, weeklyPct: 10 })).toBe(30);   // 5 pts to askAt 90 × 600/100
    expect(refreshDueMinutes({ tier: "pro", fivePct: 10, weeklyPct: 10 })).toBe(18);     // 60 pts to sonnetAt 70 × 30/100
    expect(refreshDueMinutes({ tier: "max20", fivePct: 40, weeklyPct: 10 })).toBe(180);  // capped at STALE_MS
    expect(refreshDueMinutes({ tier: "max5", fivePct: 79, weeklyPct: 10 })).toBe(5);     // 1 pt × 150/100 = 1.5 → floor 5
  });

  test("the weekly window counts too, at a slower rate: Max 20x week 93 % → 96 min", () => {
    expect(refreshDueMinutes({ tier: "max20", fivePct: 10, weeklyPct: 93 })).toBe(96); // 2 pts to askAt 95 × 600 × 8 / 100
  });

  test("the same 31 min: Max 20x at 85 % refreshes, Max 20x at 40 % does not, Pro at 40 % does", () => {
    const root = stubRoot();
    expect(refreshes(snap({ ageMin: 31, five: 85, week: 10, plan: "Max 20x" }), root)).toBe(true);
    expect(refreshes(snap({ ageMin: 31, five: 40, week: 10, plan: "Max 20x" }), root)).toBe(false);
    expect(refreshes(snap({ ageMin: 31, five: 40, week: 10, plan: "Pro" }), root)).toBe(true);
    expect(refreshes(snap({ ageMin: 10, five: 85, week: 10, plan: "Max 20x" }), root)).toBe(false); // not due yet
  });

  test("at the limit (99 % / sonnet-only) age never refreshes — the reset does", () => {
    const root = stubRoot();
    const limit = snap({ ageMin: 45, five: 99, week: 99, plan: "Max 20x", reset: 90 });
    const b = read(limit);
    expect(b.cls).toBe("sonnet-only");
    expect(b.refreshDueMinutes).toBe(null);
    expect(refreshes(limit, root)).toBe(false);
    // The same reading once its window has passed → expired → refresh.
    const past = snap({ ageMin: 100, five: 99, week: 99, plan: "Max 20x", reset: 90 });
    expect(read(past).expired).toBe(true);
    expect(refreshes(past, root)).toBe(true);
  });

  test("a reset 7 min away skips the due refresh — a reading now is obsolete in minutes", () => {
    const root = stubRoot();
    expect(refreshes(snap({ ageMin: 40, five: 85, week: 10, plan: "Max 20x", reset: 47 }), root)).toBe(false); // 47 − 40 = 7 min left
    expect(refreshes(snap({ ageMin: 40, five: 85, week: 10, plan: "Max 20x", reset: 100 }), root)).toBe(true); // 60 min left → due
  });
});

describe("budgetSummary — the block get_usage returns", () => {
  test("carries class, binding, the reset/failure flags and the rendered line", () => {
    const b = readBudget({
      home: fs.mkdtempSync(path.join(os.tmpdir(), "budget-empty-")), nowMs: NOW, env: {},
      snapshot: { timestamp: iso(NOW), session: { pct: 3, resetInMinutes: 290 }, weekly: { pct: 1, resetInMinutes: 5000 }, plan: "Max 20x" },
    });
    expect(budgetSummary(b)).toEqual({
      plan: "Max 20x", tier: "max20", cls: "free", binding: "5h",
      expired: false, recentReset: "5h", refreshFailed: null, refreshDueMinutes: 180, override: null,
      line: budgetLine(b),
    });
  });

  test("snapshot: null classifies without touching the disk — unknown asks", () => {
    const h = home({
      "usage-live.json": { timestamp: iso(NOW), session: { pct: 99, resetInMinutes: 10 }, weekly: { pct: 99, resetInMinutes: 100 }, plan: "Max 5x" },
    });
    const b = readBudget({ home: h, nowMs: NOW, env: {}, snapshot: null });
    expect(b.fivePct).toBe(null);
    expect(b.cls).toBe("ask-before-parallel"); // not the disk file's sonnet-only
  });
});
