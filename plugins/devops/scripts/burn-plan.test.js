/**
 * Unit tests for the deterministic core of `/do-run burn` (burn-plan.js).
 * Every block pins one finding of the 2026-09-25 burn audit:
 *   H1 the uplift gate could never fire · H2 guessed constants without
 *   calibration · H3 the offer sat where burn helps least · H4 a fixed
 *   reserve and a blind gate · K3 the 5-hour window was not modelled ·
 *   M2/M3 depth spent on review passes and filler.
 */
import { describe, test, expect } from "vitest";
import bp from "./burn-plan.js";

const NOW = Date.parse("2026-09-25T10:00:00.000Z");

/** A usage-live.json snapshot `ageMin` old. */
function raw({ weeklyUsed = 70, weeklyResetMin = 30 * 60, sessionUsed = 10, sessionResetMin = 200, plan = "Max 20x", ageMin = 0, cached = false } = {}) {
  return {
    timestamp: new Date(NOW - ageMin * 60000).toISOString(),
    plan,
    weekly: { pct: weeklyUsed, resetInMinutes: weeklyResetMin },
    session: { pct: sessionUsed, resetInMinutes: sessionResetMin },
    ...(cached ? { _cached: true, _failureReason: "scraper profile not logged in" } : {}),
  };
}
const usage = (o = {}, maxAge = 10) => bp.normalizeUsage(raw(o), NOW, maxAge);
const task = (id, size = "M", priority = "P2", extra = {}) => ({ id, task: id, size, priority, ...extra });

function stateFor(plan, queue, u, extra = {}) {
  return { ...bp.newState({ slug: "t", integrationBranch: "burn/t", plan, queue, usage: u, nowMs: NOW, sessionId: "S1", ...extra }) };
}

describe("normalizeUsage — a cached number is not a reading", () => {
  test("age-corrects the reset times", () => {
    const u = usage({ weeklyResetMin: 600, sessionResetMin: 100, ageMin: 1 }, 2);
    expect(u.ok).toBe(true);
    expect(u.weeklyRemaining).toBe(30);
    expect(u.weeklyResetMin).toBeCloseTo(599, 5);
    expect(u.sessionResetMin).toBeCloseTo(99, 5);
  });

  test("cache-served, stale, future-dated and empty snapshots are rejected", () => {
    expect(usage({ cached: true }).ok).toBe(false);
    expect(usage({ ageMin: 5 }, 2).ok).toBe(false);
    expect(usage({ ageMin: -5 }).ok).toBe(false);
    expect(bp.normalizeUsage(null, NOW).ok).toBe(false);
    expect(bp.normalizeUsage({ weekly: {} }, NOW).ok).toBe(false);
  });
});

describe("offer — Q4 shows the option where budget would expire unused (H3)", () => {
  test("a light week with two days left: offered", () => {
    const o = bp.offer(usage({ weeklyUsed: 15, weeklyResetMin: 45 * 60 }));
    expect(o.offer).toBe(true);
    expect(o.projectedUnusedPct).toBeGreaterThan(70);
  });

  test("85 % used with 60 h left — on pace to hit the limit: not offered", () => {
    expect(bp.offer(usage({ weeklyUsed: 85, weeklyResetMin: 60 * 60 })).offer).toBe(false);
  });

  test("the old > 80 % rule would have shown it here; the pace rule does not", () => {
    // 82 % used after 100 h → 0.82 %/h, 68 h left → the rest gets used anyway
    const o = bp.offer(usage({ weeklyUsed: 82, weeklyResetMin: 68 * 60 }));
    expect(o.offer).toBe(false);
    expect(o.reason).toBe("on-pace");
  });

  test("minutes before the reset: not offered; unknown usage: not offered", () => {
    expect(bp.offer(usage({ weeklyUsed: 20, weeklyResetMin: 30 })).offer).toBe(false);
    expect(bp.offer(usage({ cached: true })).offer).toBe(false);
  });
});

describe("calibrationFor — defaults scale by plan, measurements replace them (H2)", () => {
  test("Pro costs 20× Max 20x per task until measured", () => {
    const max = bp.calibrationFor(null, "Max 20x");
    const pro = bp.calibrationFor(null, "Pro");
    expect(pro.unitCostPct / max.unitCostPct).toBeCloseTo(20, 5);
    expect(max.source.unitCost).toBe("default");
  });

  test("three recorded runs switch to their median", () => {
    const cal = bp.calibrationFor({ "Max 20x": { laneHourlyPct: [1, 2, 9], unitCostPct: [0.3, 0.1, 0.2] } }, "Max 20x");
    expect(cal.laneHourlyPct).toBe(2);
    expect(cal.unitCostPct).toBe(0.2);
    expect(cal.source.laneHourly).toBe("measured (3)");
  });

  test("calibrationSamples + recordCalibration keep the last ten", () => {
    let c = null;
    for (let i = 0; i < 12; i++) c = bp.recordCalibration(c, "Max 20x", { laneHourlyPct: i + 1, unitCostPct: 0.1 });
    expect(c["Max 20x"].laneHourlyPct).toHaveLength(10);
    expect(c["Max 20x"].laneHourlyPct[0]).toBe(3);
  });

  test("a finished run yields a sample normalized to standard depth", () => {
    const u = usage();
    const plan = bp.derivePlan({ usage: u, queue: [task("p0", "L", "P0")] });
    let s = stateFor(plan, [task("p0", "L", "P0")], u);
    s = bp.claimTask(s, "p0", NOW);
    s = bp.landTask(s, "p0", { sha: "abc" }, NOW + 60 * 60000);
    const sample = bp.calibrationSamples(s, u.weeklyRemaining - 4, NOW + 60 * 60000);
    expect(sample.unitCostPct).toBeCloseTo(4 / (5 * 2.0), 5); // L weight 5 at max (2.0)
    expect(sample.laneHourlyPct).toBeCloseTo(4 / 2.0, 5);
    expect(bp.calibrationSamples(s, u.weeklyRemaining - 1, NOW + 60 * 60000)).toBeNull(); // < 2 % is noise
  });
});

describe("landTask — a merge that stays local says so", () => {
  test("pushed defaults to true; --pushed=false (session on main, no remote) is recorded", () => {
    const u = usage();
    const q = [task("p0", "M", "P0"), task("p1", "M", "P1")];
    const plan = bp.derivePlan({ usage: u, queue: q });
    let s = stateFor(plan, q, u);
    s = bp.claimTask(s, "p0", NOW);
    s = bp.claimTask(s, "p1", NOW);
    s = bp.landTask(s, "p0", { sha: "a1" }, NOW + 1);
    s = bp.landTask(s, "p1", { sha: "b2", pushed: false }, NOW + 2);
    expect(s.done.map((t) => [t.id, t.pushed])).toEqual([["p0", true], ["p1", false]]);
  });
});

describe("derivePlan — depth first, breadth to fill, a gate that can say no", () => {
  test("typical case: one lane at max, a real uplift, leftover reported honestly", () => {
    const p = bp.derivePlan({ usage: usage({ weeklyUsed: 85, weeklyResetMin: 30 * 60 }), queue: [task("p0", "M", "P0")] });
    expect(p.ok).toBe(true);
    expect(p.profile).toBe("max");
    expect(p.lanes).toBe(1);
    expect(p.uplift).toBeGreaterThanOrEqual(bp.UPLIFT_FLOOR);
    expect(p.leftoverPct).toBeGreaterThan(5); // the queue cannot use it all — says so
  });

  test("H1: the uplift gate refuses when a normal run spends the budget anyway", () => {
    const queue = Array.from({ length: 9 }, (_, i) => task(`t${i}`, "L", i ? "P2" : "P0"));
    const p = bp.derivePlan({ usage: usage({ weeklyUsed: 88, weeklyResetMin: 20 * 60 }), queue });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe("no-uplift");
    expect(p.uplift).toBeLessThan(bp.UPLIFT_FLOOR);
  });

  test("little spendable budget caps the depth at deep", () => {
    const p = bp.derivePlan({ usage: usage({ weeklyUsed: 86, weeklyResetMin: 20 * 60 }), queue: [task("p0", "S", "P0")] });
    expect(p.ok).toBe(true);
    expect(p.profile).toBe("deep");
  });

  test("the core queue fits at deep but not at max → deep (finish the user's tasks)", () => {
    // 10 L core tasks: standard 10 %, deep 15 %, max 20 % — spendable ≈ 17 %
    const queue = Array.from({ length: 10 }, (_, i) => task(`t${i}`, "L", i ? "P2" : "P0"));
    const p = bp.derivePlan({ usage: usage({ weeklyUsed: 78, weeklyResetMin: 30 * 60 }), queue });
    expect(p.ok).toBe(true);
    expect(p.profile).toBe("deep");
  });

  test("little time adds lanes; the reserve grows with them", () => {
    const queue = Array.from({ length: 16 }, (_, i) => task(`t${i}`, "L", i ? "P2" : "P0"));
    const p = bp.derivePlan({ usage: usage({ weeklyUsed: 50, weeklyResetMin: 3.5 * 60 }), queue });
    expect(p.ok).toBe(true);
    expect(p.lanes).toBe(4);
    const cal = bp.calibrationFor(null, "Max 20x");
    expect(p.reservePct).toBeCloseTo(4 * bp.taskCost("L", p.profile, cal), 1);
    expect(p.reservePct).toBeGreaterThan(bp.RESERVE_PCT);
  });

  test("filler never counts toward the uplift and never runs deeper than standard", () => {
    const queue = [task("p0", "M", "P0"), task("f1", "S", "P4", { source: "discovery" }), task("lint", "S", "P1", { mechanical: true })];
    const p = bp.derivePlan({ usage: usage(), queue });
    const cal = bp.calibrationFor(null, "Max 20x");
    expect(p.costStandardCorePct).toBeCloseTo(bp.taskCost("M", "standard", cal) + bp.taskCost("S", "standard", cal), 5);
    expect(bp.taskProfile(queue[1], "max")).toBe("standard");
    expect(bp.taskProfile(queue[2], "max")).toBe("standard");
    expect(bp.taskProfile(queue[0], "max")).toBe("max");
  });

  test("refuses without usage, without tasks and right before the reset", () => {
    expect(bp.derivePlan({ usage: usage({ cached: true }), queue: [task("p0")] }).reason).toBe("usage-unknown");
    expect(bp.derivePlan({ usage: usage(), queue: [] }).reason).toBe("empty-queue");
    expect(bp.derivePlan({ usage: usage({ weeklyResetMin: 20 }), queue: [task("p0")] }).reason).toBe("reset-imminent");
  });
});

describe("profiles — M2: no PO review, no second QA", () => {
  test("deep and max add only a redteam pass", () => {
    expect(bp.PROFILES.deep.passes).toEqual(["redteam"]);
    expect(bp.PROFILES.max.passes).toEqual(["redteam"]);
    expect(bp.PROFILES.standard.passes).toEqual([]);
  });

  test("max upgrades qa to opus; deep upgrades only the implementers", () => {
    expect(bp.modelOverrides("max")).toMatchObject({ core: "opus", frontend: "opus", qa: "opus" });
    expect(bp.modelOverrides("deep").qa).toBeUndefined();
    expect(bp.modelOverrides("standard")).toEqual({});
  });
});

describe("gate — the decision before every spawn", () => {
  const u0 = usage({ weeklyUsed: 70, weeklyResetMin: 30 * 60, sessionUsed: 10 });
  const queue = [task("p0", "M", "P0"), task("i1", "L"), task("i2", "M")];
  const plan = bp.derivePlan({ usage: u0, queue });
  const fresh = (o) => bp.normalizeUsage(raw(o), NOW, bp.USAGE_FRESH_MIN);

  test("spawn claims the head task: it is in flight before the agent starts", () => {
    const s = stateFor(plan, queue, u0);
    const g = bp.gate(s, fresh({}), NOW, null);
    expect(g.decision).toBe("spawn");
    expect(g.task.id).toBe("p0");
    expect(g.state.inFlight.map((t) => t.id)).toEqual(["p0"]);
    expect(g.state.queue.map((t) => t.id)).toEqual(["i1", "i2"]);
    expect(g.foreground).toBe(true);
    expect(g.passes).toEqual(["redteam"]);
  });

  test("peek decides without claiming", () => {
    const s = stateFor(plan, queue, u0);
    const g = bp.gate(s, fresh({}), NOW, null, { claim: false });
    expect(g.decision).toBe("spawn");
    expect(g.state.inFlight).toHaveLength(0);
  });

  test("lanes full → wait", () => {
    const s = bp.claimTask(stateFor(plan, queue, u0), "p0", NOW);
    expect(bp.gate(s, fresh({}), NOW, null).decision).toBe("wait");
  });

  test("H4: unreadable usage holds twice, then goes blind — one lane, half the budget, 1.5× estimates", () => {
    let s = stateFor(plan, queue, u0);
    const blind = fresh({ cached: true });
    let g = bp.gate(s, blind, NOW, null);
    expect(g.decision).toBe("hold");
    g = bp.gate(g.state, blind, NOW, null);
    expect(g.decision).toBe("hold");
    g = bp.gate(g.state, blind, NOW, null);
    expect(g.decision).toBe("spawn");
    expect(g.blind).toBe(true);
    // a second lane is never opened blind
    const g2 = bp.gate(g.state, blind, NOW, null);
    expect(g2.decision).toBe("wait");
    expect(g2.reason).toBe("blind-lane-busy");
  });

  test("blind mode ends in a drain when its allowance is used up", () => {
    const tight = usage({ weeklyUsed: 92, weeklyResetMin: 30 * 60 });
    const p = { ...plan, profile: "max", lanes: 1 };
    let s = stateFor(p, [task("a", "L", "P0"), task("b", "L")], tight);
    s.holds = bp.HOLD_LIMIT - 1;
    const g = bp.gate(s, fresh({ cached: true }), NOW, null);
    // allowance = 0.5 × (8 − 5) = 1.5 %; one L at max costs 2 % × 1.5 → no fit
    expect(g.decision).toBe("finish");
    expect(g.reason).toBe("usage-unknown");
  });

  test("a fresh reading ends blind mode", () => {
    let s = stateFor(plan, queue, u0);
    s.holds = bp.HOLD_LIMIT - 1;
    s = bp.gate(s, fresh({ cached: true }), NOW, null).state;
    expect(s.blind).toBeTruthy();
    s.inFlight = [];
    const g = bp.gate(s, fresh({}), NOW, null);
    expect(g.state.blind).toBeUndefined();
    expect(g.state.events.some((e) => e.type === "blind-end")).toBe(true);
  });

  test("the dynamic reserve drains before the limit", () => {
    const s = stateFor(plan, queue, u0);
    const g = bp.gate(s, fresh({ weeklyUsed: 96 }), NOW, null);
    expect(g.decision).toBe("finish");
    expect(g.reason).toBe("reserve");
    expect(g.state.drained).toBe(true);
  });

  test("a week that reset since the start drains (the burned budget is gone)", () => {
    const s = stateFor(plan, queue, u0);
    const later = NOW + 31 * 60 * 60000;
    const g = bp.gate(s, bp.normalizeUsage(raw({ weeklyUsed: 2, ageMin: -31 * 60 }), later, 2), later, null);
    expect(g.reason).toBe("week-reset");
  });

  test("K3: a task that would overrun the 5-hour window is not started — the run pauses, it does not end", () => {
    const s = stateFor(plan, [task("big", "L", "P0")], u0);
    // default rate: 3 %/h weekly × 10 → 30 %/h per lane; L = 40 min → +20 %
    const g = bp.gate(s, fresh({ sessionUsed: 80 }), NOW, null);
    expect(g.decision).toBe("pause");
    expect(g.reason).toBe("window");
    expect(g.state.status).toBe("paused");
    expect(g.state.drained).toBe(false);
    // no auto-resume armed → no cron: the user's own "weiter" resumes (and is asked)
    expect(g.resumeCron).toBeNull();
  });

  test("…and with auto-resume armed it pauses until the reset, with a cron to arm", () => {
    const s = stateFor(plan, [task("big", "L", "P0")], u0, { autoArmed: true });
    const g = bp.gate(s, fresh({ sessionUsed: 80, sessionResetMin: 90 }), NOW, null);
    expect(g.decision).toBe("pause");
    expect(g.state.status).toBe("paused");
    expect(Date.parse(g.resumeAt) - NOW).toBe((90 + bp.RESUME_BUFFER_MIN) * 60000);
    expect(g.resumeCron).toMatch(/^\d+ \d+ \d+ \d+ \*$/);
  });

  test("…a smaller task that still fits the window goes first", () => {
    const s = stateFor(plan, [task("big", "L", "P0"), task("small", "S")], u0);
    const g = bp.gate(s, fresh({ sessionUsed: 80 }), NOW, null);
    expect(g.decision).toBe("spawn");
    expect(g.task.id).toBe("small");
  });

  test("…while lanes are busy the gate waits instead of pausing", () => {
    let s = stateFor({ ...plan, lanes: 2 }, [task("a", "S", "P0"), task("big", "L")], u0, { autoArmed: true });
    s = bp.claimTask(s, "a", NOW);
    const g = bp.gate(s, fresh({ sessionUsed: 85 }), NOW, null);
    expect(g.decision).toBe("wait");
    expect(g.reason).toBe("window");
  });

  test("…a window this fresh takes any task (no infinite wait for a huge one)", () => {
    const s = stateFor(plan, [task("big", "L", "P0")], u0);
    const g = bp.gate(s, fresh({ sessionUsed: 3 }), NOW, null);
    expect(g.decision).toBe("spawn");
  });

  test("the window rate is measured from readings once there are some", () => {
    const s = stateFor(plan, queue, u0);
    s.readings = [
      { at: new Date(NOW - 60 * 60000).toISOString(), weeklyRemaining: 30, sessionUsed: 10, lanesBusy: 1 },
      { at: new Date(NOW).toISOString(), weeklyRemaining: 29, sessionUsed: 22, lanesBusy: 1 },
    ];
    const r = bp.sessionRatePerLane(s, "max", bp.calibrationFor(null, "Max 20x"));
    expect(r.source).toBe("measured");
    expect(r.rate).toBeCloseTo(12, 5);
  });

  test("two tasks on the same file never run at once", () => {
    let s = stateFor({ ...plan, lanes: 2 }, [task("a", "S", "P0", { files: ["x.js"] }), task("b", "S", "P2", { files: ["x.js"] })], u0);
    s = bp.claimTask(s, "a", NOW);
    const g = bp.gate(s, fresh({}), NOW, null);
    expect(g.decision).toBe("wait");
    expect(g.reason).toBe("file-conflict");
  });

  test("a new 5-hour window asks for a re-armed resume cron", () => {
    const s = stateFor(plan, queue, u0, { autoArmed: true });
    const g = bp.gate(s, fresh({ sessionResetMin: 120 }), NOW, null);
    expect(g.rearmResumeCron).toBeTruthy();
    s.resume.cronFor = g.rearmResumeCron.windowResetAt;
    const g2 = bp.gate(s, fresh({ sessionResetMin: 120 }), NOW, null);
    expect(g2.rearmResumeCron).toBeNull();
  });

  test("burn off: standard profile, no overrides, fixed reserve", () => {
    const s = bp.burnOff(stateFor(plan, queue, u0), "test", NOW);
    const g = bp.gate(s, fresh({}), NOW, null);
    expect(g.taskProfile).toBe("standard");
    expect(g.models).toEqual({});
    expect(g.passes).toEqual([]);
  });

  test("finished and paused runs never spawn", () => {
    const s = stateFor(plan, queue, u0);
    expect(bp.gate(bp.finishState(s, "COMPLETED", NOW), fresh({}), NOW, null).decision).toBe("stop");
    expect(bp.gate(bp.pauseState(s, { reason: "window" }, NOW), fresh({}), NOW, null).decision).toBe("stop");
  });
});

describe("recalibrate — depth before breadth, one step per cooldown", () => {
  const u0 = usage({ weeklyUsed: 60, weeklyResetMin: 30 * 60 });
  const queue = [task("p0", "L", "P0"), task("i1", "L"), task("i2", "L")];

  test("under-burning raises the profile before it adds a lane", () => {
    const s = stateFor({ ...bp.derivePlan({ usage: u0, queue }), profile: "deep" }, queue, u0);
    s.plan.requiredPerHour = 4;
    const later = NOW + 60 * 60000;
    const change = bp.recalibrate(s, { ...u0, weeklyRemaining: 39.5 }, later);
    expect(change).toEqual({ profile: "max" });
    expect(bp.recalibrate(s, { ...u0, weeklyRemaining: 39.5 }, later + 60000)).toBeNull(); // cooldown
    const next = bp.recalibrate(s, { ...u0, weeklyRemaining: 39 }, later + 31 * 60000);
    expect(next).toEqual({ lanes: 2 });
  });

  test("over-burning only drops lanes", () => {
    const s = stateFor({ ...bp.derivePlan({ usage: u0, queue }), lanes: 3 }, queue, u0);
    s.plan.requiredPerHour = 1;
    const change = bp.recalibrate(s, { ...u0, weeklyRemaining: 36 }, NOW + 60 * 60000);
    expect(change).toEqual({ lanes: 2 });
  });
});

describe("applyResume — continue, switch off, end", () => {
  const u0 = usage({ weeklyUsed: 60, weeklyResetMin: 30 * 60 });
  const queue = [task("p0", "L", "P0"), task("i1", "M"), task("f1", "S", "P4", { source: "discovery" })];
  const base = () => bp.pauseState(stateFor(bp.derivePlan({ usage: u0, queue }), queue, u0), { reason: "window" }, NOW);

  test("off: standard depth on one lane, filler dropped, run continues", () => {
    const r = bp.applyResume(base(), { trigger: "manual", choice: "off", usage: u0, nowMs: NOW + 1 });
    expect(r.applied).toBe("off");
    expect(r.state.burn.active).toBe(false);
    expect(r.state.profile).toBe("standard");
    expect(r.state.lanes).toBe(1);
    expect(r.state.queue.map((t) => t.id)).toEqual(["p0", "i1"]);
    expect(r.state.skipped.map((t) => t.id)).toEqual(["f1"]);
    expect(r.state.status).toBe("running");
  });

  test("continue: plan re-derived from the CURRENT usage", () => {
    const later = usage({ weeklyUsed: 88, weeklyResetMin: 20 * 60 });
    const r = bp.applyResume(base(), { trigger: "auto", choice: "continue", usage: later, nowMs: NOW + 1 });
    expect(r.applied).toBe("continue");
    expect(r.state.burn.active).toBe(true);
    expect(r.state.plan.remainingAtStart).toBe(12);
    expect(r.state.profile).toBe("deep"); // < 10 % spendable now
  });

  test("continue after the weekly reset turns the burn off", () => {
    const s = base();
    const later = NOW + 31 * 60 * 60000;
    const r = bp.applyResume(s, { trigger: "manual", choice: "continue", usage: bp.normalizeUsage(raw({ weeklyUsed: 1, ageMin: -31 * 60 }), later, 10), nowMs: later });
    expect(r.applied).toBe("off");
    expect(r.why).toBe("week-reset");
    expect(Date.parse(r.state.weekResetAt)).toBeGreaterThan(later);
  });

  test("continue without a burnable budget falls back to off, with the reason", () => {
    const r = bp.applyResume(base(), { trigger: "auto", choice: "continue", usage: usage({ weeklyUsed: 97 }), nowMs: NOW + 1 });
    expect(r.applied).toBe("off");
    expect(r.why).toBe("no-budget");
  });

  test("end drains", () => {
    const r = bp.applyResume(base(), { trigger: "manual", choice: "end", usage: u0, nowMs: NOW + 1 });
    expect(r.state.drained).toBe(true);
    expect(r.state.drainReason).toBe("user-ended");
  });

  test("records the resume so the hook stays quiet afterwards", () => {
    const r = bp.applyResume(base(), { trigger: "manual", choice: "off", usage: u0, nowMs: NOW + 1, sessionId: "S9" });
    expect(r.state.lastResume).toMatchObject({ trigger: "manual", requested: "off", applied: "off" });
    expect(r.state.sessionId).toBe("S9");
  });
});

describe("state transitions", () => {
  const u0 = usage();
  const queue = [task("p0", "M", "P0"), task("i1", "M")];
  const s0 = () => stateFor(bp.derivePlan({ usage: u0, queue }), queue, u0);

  test("claim → land", () => {
    let s = bp.claimTask(s0(), "p0", NOW, { agent: "core", agentId: "A1", branch: "burn/t-core-1" });
    s = bp.landTask(s, "p0", { sha: "abc1234" }, NOW + 1);
    expect(s.done[0]).toMatchObject({ id: "p0", sha: "abc1234", pushed: true, agentId: "A1" });
  });

  test("requeue keeps the wip branch and the priority order", () => {
    let s = bp.claimTask(s0(), "p0", NOW, { branch: "burn/t-core-1" });
    s = bp.requeueTask(s, "p0", { branch: "burn/t-core-1", note: "after a hard stop" }, NOW + 1);
    expect(s.queue.map((t) => t.id)).toEqual(["p0", "i1"]);
    expect(s.queue[0]).toMatchObject({ branch: "burn/t-core-1", requeues: 1 });
  });

  test("events are capped and every transition beats the heartbeat", () => {
    let s = s0();
    for (let i = 0; i < 250; i++) s = bp.setResumePolicy(s, { auto: i % 2 ? "off" : "continue" }, NOW + i);
    expect(s.events.length).toBeLessThanOrEqual(200);
    expect(s.heartbeatAt).toBe(new Date(NOW + 249).toISOString());
  });
});

describe("classifyInFlight — resume actions (K2)", () => {
  const base = { id: "t", branch: "b", worktree: "w", worktreeExists: true, commitsAhead: 0, dirty: false, wip: false, agentId: null, sessionId: null };

  test("a dirty worktree is salvaged, never ignored", () => {
    const c = bp.classifyInFlight({ ...base, dirty: true });
    expect(c.salvage).toBe(true);
    expect(c.action).toBe("requeue-with-branch");
  });

  test("same session and a known agent → continue it with its context", () => {
    expect(bp.classifyInFlight({ ...base, dirty: true, agentId: "A1", sessionId: "S1" }, { sessionId: "S1" }).action).toBe("continue-agent");
    expect(bp.classifyInFlight({ ...base, agentId: "A1", sessionId: "S1" }, { sessionId: "S2" }).action).toBe("requeue");
  });

  test("finished commits merge; wip commits requeue on their branch; nothing requeues", () => {
    expect(bp.classifyInFlight({ ...base, commitsAhead: 2 }).action).toBe("merge");
    expect(bp.classifyInFlight({ ...base, commitsAhead: 2, wip: true }).action).toBe("requeue-with-branch");
    expect(bp.classifyInFlight(base).action).toBe("requeue");
  });
});
