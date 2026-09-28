import { describe, test, expect } from "vitest";
import {
  shouldDelegate, shipDelegateInstruction, threshold, shipSavingEstimate, DEFAULT_THRESHOLD, SUBAGENT_FLOOR,
  promotionOfArgs, shouldDelegateSkillCall, delegatedSpawnTooSmall,
} from "./ship-delegate.js";

// A /do-ship at session end re-reads a ~434 k context ~25 times (measured over
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

  // Measured on 7 delegated ships (2026-09-27/28): the subagent starts at
  // 72–75 k and writes that context to the cache once; break-even near 170 k,
  // +28 % cost at 115 k. The default keeps a margin so delegating never costs more.
  test("the default sits above break-even and counts the subagent's cache write", () => {
    expect(DEFAULT_THRESHOLD).toBe(250_000);
    expect(SUBAGENT_FLOOR).toBe(75_000);
    expect(shipSavingEstimate(DEFAULT_THRESHOLD)).toBe("≈ 2.4 M");
    expect(shipSavingEstimate(800_000)).toBe("≈ 15 M");
    expect(shipSavingEstimate(140_000)).toBe("≈ 0.0 M");
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

// prompt.ship.detect sees only user prompts; pre.ship.delegate applies the same
// threshold to a do-ship the model starts through the Skill tool (concept
// finalize, do-run backlog, an autonomous ship) and stops a delegation that
// would cost more than the inline ship.
describe("ship-delegate — Skill-tool ships", () => {
  const env = {};

  test("a large-context do-ship Skill call goes to a subagent, whatever its free-text args", () => {
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "", tokens: 951_000, env })).toBe(true);
    expect(shouldDelegateSkillCall({ skill: "do-ship", args: "--queued=1/4 --keep  (backlog-runner, issue #583)", tokens: 286_000, env })).toBe(true);
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "--from=auto-concept finalize part C", tokens: 573_000, env })).toBe(true);
  });

  test("the subagent itself, a resume, --inline, other skills and small contexts pass", () => {
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "--delegated --keep", tokens: 900_000, env })).toBe(false);
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "--resume", tokens: 900_000, env })).toBe(false);
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "--inline", tokens: 900_000, env })).toBe(false);
    expect(shouldDelegateSkillCall({ skill: "devops:auto-harden", args: "", tokens: 900_000, env })).toBe(false);
    expect(shouldDelegateSkillCall({ skill: "devops:do-shipment", args: "", tokens: 900_000, env })).toBe(false);
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "", tokens: 200_000, env })).toBe(false);
    expect(shouldDelegateSkillCall({ skill: "devops:do-ship", args: "", tokens: null, env })).toBe(false);
  });

  test("promotion args: a leading channel word, a named version", () => {
    expect(promotionOfArgs("stable 0.193.0")).toEqual({ promote: true, version: "0.193.0" });
    expect(promotionOfArgs("beta")).toEqual({ promote: true, version: null });
    expect(promotionOfArgs("promote")).toEqual({ promote: true, version: null });
    expect(promotionOfArgs("--keep ship to stable later")).toEqual({ promote: false, version: null });
    expect(promotionOfArgs("")).toEqual({ promote: false, version: null });
  });

  test("a delegated spawn below the threshold costs more than inline and is stopped", () => {
    const spawn = 'Use Skill("devops:do-ship") with args "--delegated". session_id: s. lang: de.';
    expect(delegatedSpawnTooSmall({ prompt: spawn, tokens: 115_000, env })).toBe(true);
    expect(delegatedSpawnTooSmall({ prompt: spawn, tokens: 400_000, env })).toBe(false);
    expect(delegatedSpawnTooSmall({ prompt: spawn, tokens: null, env })).toBe(false);
    expect(delegatedSpawnTooSmall({ prompt: spawn.replace("--delegated", "--delegated --resume"), tokens: 115_000, env })).toBe(false);
    expect(delegatedSpawnTooSmall({ prompt: "Review the diff", tokens: 115_000, env })).toBe(false);
    expect(delegatedSpawnTooSmall({ prompt: spawn, tokens: 115_000, env: { DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "0" } })).toBe(false);
  });
});
