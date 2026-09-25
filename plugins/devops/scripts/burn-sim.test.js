/**
 * Scenario dry runs of whole burns (burn-sim.js) — the decision code of
 * burn-plan.js driven tick by tick against a synthetic account, no tokens.
 * Each scenario runs the pre-change burn (`current`, followed faithfully)
 * and this implementation (`new`); the tests pin what the change is for:
 * no lost work, no limit hit during a drain, a question after a manual
 * nudge, the chosen policy after an automatic resume, and a burn that
 * says no when it adds nothing.
 */
import { describe, test, expect } from "vitest";
import sim from "./burn-sim.js";

const results = Object.fromEntries(Object.keys(sim.SCENARIOS).map((n) => [n, sim.runScenario(n)]));
const cur = (n) => results[n].outcome.current;
const neu = (n) => results[n].outcome.new;

describe("invariants of the new burn — every scenario", () => {
  test.each(Object.keys(sim.SCENARIOS))("%s: no work lost, no limit hit during a drain, never below 0 %", (n) => {
    const o = neu(n);
    expect(o.lostWorkMin).toBe(0);
    expect(o.stopsDuringDrain).toBe(0);
    expect(o.minRemainingPct).toBeGreaterThan(0);
  });

  test.each(Object.keys(sim.SCENARIOS))("%s: a run that starts lands every core task or stops for a stated reason", (n) => {
    const o = neu(n);
    if (o.refused) return;
    const allCore = o.landedCore === o.coreTasks;
    expect(allCore || ["usage-unknown", "reserve", "window", "no-fit", "week-reset"].includes(o.endReason)).toBe(true);
  });

  test("every scenario has a readable timeline", () => {
    for (const r of Object.values(results)) {
      expect(r.timeline.new.length).toBeGreaterThan(0);
      expect(sim.formatResult(r)).toMatch(new RegExp(`■ ${r.name}`));
    }
  });
});

describe("K3 — the 5-hour window", () => {
  test("current: hard stops, one one-shot resume, then stuck in the next window", () => {
    expect(cur("five-hour-window").hardStops).toBeGreaterThanOrEqual(2);
    expect(cur("five-hour-window").endReason).toBe("stuck after a hard stop");
  });

  test("new: pauses before the window runs out and resumes after each reset — all core tasks land", () => {
    const o = neu("five-hour-window");
    expect(o.hardStops).toBe(0);
    expect(o.pauses).toBeGreaterThanOrEqual(1);
    expect(o.landedCore).toBe(o.coreTasks);
    expect(o.resumes.every((r) => r.trigger === "auto" && r.applied === "continue")).toBe(true);
  });
});

describe("K2 — a hard stop keeps the work", () => {
  test("current: the in-flight work is discarded on resume", () => {
    expect(cur("weekly-stop-other-session").lostWorkMin).toBeGreaterThan(0);
    expect(cur("manual-resume-after-limit").lostWorkMin).toBeGreaterThan(0);
  });

  test("new: salvaged and continued with the agent's context", () => {
    expect(neu("weekly-stop-other-session").lostWorkMin).toBe(0);
    expect(neu("weekly-stop-other-session").rampMin).toBe(0);
  });

  test("new: when the agent cannot be continued, a fresh agent picks up the wip branch (re-read, not redo)", () => {
    const o = neu("agent-cannot-continue");
    expect(o.lostWorkMin).toBe(0);
    expect(o.rampMin).toBeGreaterThan(0);
    expect(o.rampMin).toBeLessThan(cur("agent-cannot-continue").lostWorkMin);
  });
});

describe("the user's requests — manual nudge asks, auto-resume follows the answer given up front", () => {
  test("manual 'weiter' after a limit: current burns on silently; new asks once and the default switches it off", () => {
    expect(cur("manual-resume-after-limit").questions).toBe(0);
    expect(cur("manual-resume-after-limit").burnActiveAtEnd).toBe(true);
    const o = neu("manual-resume-after-limit");
    expect(o.questions).toBe(1);
    expect(o.resumes).toEqual([expect.objectContaining({ trigger: "manual", requested: "off", applied: "off" })]);
    expect(o.burnActiveAtEnd).toBe(false);
    expect(o.spentPct).toBeLessThan(cur("manual-resume-after-limit").spentPct);
  });

  test("no filler starts after the burn was switched off", () => {
    const tl = results["manual-resume-after-limit"].timeline.new;
    const resumeAt = tl.findIndex((l) => /resume \(manual\)/.test(l));
    expect(resumeAt).toBeGreaterThan(-1);
    expect(tl.slice(resumeAt).some((l) => /spawn f\d/.test(l))).toBe(false);
  });

  test("a full window without auto-resume pauses (never ends); the user's later 'weiter' is asked", () => {
    expect(cur("window-pause-manual").hardStops).toBe(1);
    expect(cur("window-pause-manual").questions).toBe(0);
    const o = neu("window-pause-manual");
    expect(o.hardStops).toBe(0);
    expect(o.pauses).toBe(1);
    expect(o.questions).toBe(1);
    expect(o.resumes).toEqual([expect.objectContaining({ trigger: "manual", applied: "off" })]);
    expect(o.landedCore).toBe(o.coreTasks);
    expect(o.landedFiller).toBe(0);
  });

  test("auto-resume with 'Burn abschalten' (F7): no question, burn off after the pause", () => {
    const o = neu("auto-resume-burn-off");
    expect(o.questions).toBe(0);
    expect(o.hardStops).toBe(0);
    expect(o.resumes).toEqual([expect.objectContaining({ trigger: "auto", applied: "off" })]);
    expect(o.burnActiveAtEnd).toBe(false);
  });

  test("auto-resume with 'Burn fortsetzen' (F7, recommended): keeps burning, re-derived", () => {
    expect(neu("five-hour-window").burnActiveAtEnd).toBe(true);
  });

  test("a nudge after the weekly reset: the user asked to continue, the burn still goes off", () => {
    const o = neu("weekly-stop-other-session");
    expect(o.resumes).toEqual([expect.objectContaining({ requested: "continue", applied: "off", why: "week-reset" })]);
    expect(cur("weekly-stop-other-session").burnActiveAtEnd).toBe(true); // current burns the fresh week
  });
});

describe("H4 — reserve and blind usage", () => {
  test("current: four lanes overrun the fixed 5 % reserve and hit the limit during the drain", () => {
    expect(cur("multi-lane-drain").stopsDuringDrain).toBeGreaterThanOrEqual(1);
    expect(cur("multi-lane-drain").minRemainingPct).toBe(0);
  });

  test("new: the reserve covers every busy lane — no stop, all core landed", () => {
    const o = neu("multi-lane-drain");
    expect(o.hardStops).toBe(0);
    expect(o.landedCore).toBe(o.coreTasks);
  });

  test("current: a blind scraper runs the account into the weekly limit", () => {
    expect(cur("usage-blind").hardStops).toBe(1);
    expect(cur("usage-blind").minRemainingPct).toBe(0);
  });

  test("new: holds, works on carefully in blind mode, drains before the limit", () => {
    const o = neu("usage-blind");
    expect(o.hardStops).toBe(0);
    expect(o.endReason).toBe("usage-unknown");
    expect(o.landedCore).toBeGreaterThan(1);
    expect(o.minRemainingPct).toBeGreaterThan(5);
  });
});

describe("H1 / M3 — a burn that adds nothing refuses; filler stays shallow", () => {
  test("no-uplift: current starts anyway, new refuses", () => {
    expect(cur("no-uplift").spentPct).toBeGreaterThan(0);
    expect(neu("no-uplift").refused).toBe("no-uplift");
    expect(neu("no-uplift").spentPct).toBe(0);
  });

  test("filler-heavy: same work landed, a fraction of the filler spend", () => {
    expect(neu("filler-heavy").landedFiller).toBe(cur("filler-heavy").landedFiller);
    expect(neu("filler-heavy").fillerSpentPct).toBeLessThan(cur("filler-heavy").fillerSpentPct / 2);
  });

  test("happy path: nothing to fix, nothing broken", () => {
    expect(neu("happy-path")).toMatchObject({ landedCore: 4, hardStops: 0, questions: 0, endReason: "queue-empty" });
  });
});
