import { describe, test, expect } from "vitest";
import { shouldDelegate, shipDelegateInstruction, threshold, shipSavingEstimate, DEFAULT_THRESHOLD, SUBAGENT_FLOOR } from "./ship-delegate.js";

// A /do-ship at session end re-reads a ~434 k context ~16 times (measured over
// 10 sessions, 2026-09-21). No hook can compact, but the pipeline only needs a
// brief of the conversation: above the threshold the main session briefs a
// fresh-context subagent, and the user types nothing extra.
describe("ship-delegate — when", () => {
  const env = {};

  test("below the threshold the ship runs inline", () => {
    expect(shouldDelegate({ tokens: 120_000, prompt: "/do-ship", env })).toBe(false);
    expect(shouldDelegate({ tokens: DEFAULT_THRESHOLD - 1, prompt: "ship it", env })).toBe(false);
  });

  test("at or above the threshold it is delegated — every time, no second prompt", () => {
    expect(shouldDelegate({ tokens: DEFAULT_THRESHOLD, prompt: "/do-ship", env })).toBe(true);
    expect(shouldDelegate({ tokens: 434_000, prompt: "ship", env })).toBe(true);
  });

  test("--inline and the old --no-compact keep one ship inline", () => {
    expect(shouldDelegate({ tokens: 700_000, prompt: "/do-ship --inline", env })).toBe(false);
    expect(shouldDelegate({ tokens: 700_000, prompt: "ship it --no-compact bitte", env })).toBe(false);
    expect(shouldDelegate({ tokens: 700_000, prompt: "/do-ship --inlined", env })).toBe(true);
  });

  test("a promotion-only run and an unknown size stay inline", () => {
    expect(shouldDelegate({ tokens: 700_000, prompt: "promote stable", promotionOnly: true, env })).toBe(false);
    expect(shouldDelegate({ tokens: null, prompt: "/do-ship", env })).toBe(false);
    expect(shouldDelegate({ tokens: undefined, prompt: "/do-ship", env })).toBe(false);
  });

  test("the new variable wins, the old one still works, 0 disables, garbage falls back", () => {
    expect(threshold({})).toBe(DEFAULT_THRESHOLD);
    expect(threshold({ DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "300000" })).toBe(300_000);
    expect(threshold({ DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "300000" })).toBe(300_000);
    expect(threshold({ DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "250000", DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "300000" })).toBe(250_000);
    expect(threshold({ DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "", DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "0" })).toBe(0);
    expect(threshold({ DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "lots" })).toBe(DEFAULT_THRESHOLD);
    expect(threshold({ DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "-5" })).toBe(DEFAULT_THRESHOLD);
    expect(shouldDelegate({ tokens: 900_000, prompt: "/do-ship", env: { DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "0" } })).toBe(false);
  });

  test("the default already pays: ≥ 2 M saved per ship", () => {
    expect(DEFAULT_THRESHOLD).toBe(200_000);
    expect(SUBAGENT_FLOOR).toBe(50_000);
    expect(shipSavingEstimate(DEFAULT_THRESHOLD)).toBe("≈ 2.4 M");
    expect(shipSavingEstimate(800_000)).toBe("≈ 12 M");
    expect(shipSavingEstimate(20_000)).toBe("≈ 0.0 M");
  });
});

describe("ship-delegate — the instruction", () => {
  const out = shipDelegateInstruction({ tokens: 434_000, pluginRoot: "C:\\plug\\devops\\1.0.0", env: {} });

  test("keeps the pipeline out of the main context", () => {
    expect(out).toContain("[ship-delegate]");
    expect(out).toContain("434 k");
    expect(out).toContain("Do NOT run the pipeline in this context");
  });

  test("briefs one foreground general-purpose agent that runs do-ship --delegated", () => {
    expect(out).toContain('subagent_type: "general-purpose"');
    expect(out).toContain(`model: "<this session's model family`);
    expect(out).toContain("run_in_background: false");
    expect(out).toContain('Skill("devops:do-ship") with args "--delegated"');
    for (const part of ["verbatim", "functional changes", "findings and decisions with their why", "tests that ran", "validation", "open points"]) {
      expect(out).toContain(part);
    }
  });

  test("routes decisions back through the main session and renders the card there", () => {
    expect(out).toContain('"status": "decision"');
    expect(out).toContain("AskUserQuestion");
    expect(out).toContain("SendMessage");
    expect(out).toContain('"status": "done"');
    expect(out).toContain("render_completion_card");
    expect(out).toContain("ExitWorktree");
  });

  test("the subagent renders with this session's id; the parent only shows the card and sets keep/no-watch", () => {
    const withId = shipDelegateInstruction({ tokens: 434_000, pluginRoot: "/p", sessionId: "sess-42", env: {} });
    expect(withId).toContain("session_id: sess-42");
    expect(withId).toContain("--keep when the user announced");
    expect(withId).toContain("--no-watch");
    expect(withId).toContain('"titlePrefix", "widgetFile" | "markdown"');
    expect(withId).toContain("no second render_completion_card");
  });

  test("passes the channel on and names the mode doc with forward slashes", () => {
    expect(shipDelegateInstruction({ tokens: 434_000, skillArgs: "stable", pluginRoot: "/p", env: {} }))
      .toContain('with args "--delegated stable"');
    expect(out).toContain("C:/plug/devops/1.0.0/skills/do-ship/modes/delegated.md");
  });
});
