import { describe, test, expect } from "vitest";
import { shipCompactAdvice, threshold, shipCostEstimate, shipSavingEstimate, DEFAULT_THRESHOLD, POST_COMPACT_FLOOR, COMPACT_FOCUS } from "./ship-compact.js";

// A /do-ship at session end re-reads a ~434 k context ~16 times (measured over
// 10 sessions, 2026-09-21) — a quarter of the session's tokens. Only the user
// can compact, so the hook has to stop the ship BEFORE the pipeline pays and
// hand over the exact /compact command. Careful: threshold, one-shot opt-out,
// env off-switch, never on an unknown context size.
describe("ship-compact", () => {
  const env = {};

  test("below the threshold the ship just runs", () => {
    expect(shipCompactAdvice({ tokens: 120_000, prompt: "/do-ship", env })).toBeNull();
    expect(shipCompactAdvice({ tokens: DEFAULT_THRESHOLD - 1, prompt: "ship it", env })).toBeNull();
  });

  test("at or above the threshold the advice replaces the ship", () => {
    const out = shipCompactAdvice({ tokens: 434_000, prompt: "/do-ship", env });
    expect(out).toContain("[ship-compact]");
    expect(out).toContain("434 k");
    expect(out).toContain("Do NOT start the ship pipeline");
    // The stop ends in a card: the card carries saving, command and buttons.
    expect(out).toContain("render_completion_card");
    expect(out).toContain('variant: "ship-blocked"');
    expect(out).toContain("compact: { tokens: 434000 }");
    expect(out).toContain("Ohne Kompaktieren shippen");
    expect(out).toContain("ship --no-compact");
    expect(shipCompactAdvice({ tokens: DEFAULT_THRESHOLD, prompt: "/do-ship", env })).not.toBeNull();
  });

  test("the focus keeps what the user asked to keep", () => {
    for (const must of ["Prompts", "Absichten", "Probleme", "Branch", "Test-Kommando", "offene Punkte"]) {
      expect(COMPACT_FOCUS).toContain(must);
    }
    expect(COMPACT_FOCUS).not.toContain("\n");
  });

  test("--no-compact skips the stop for this one ship", () => {
    expect(shipCompactAdvice({ tokens: 700_000, prompt: "/do-ship --no-compact", env })).toBeNull();
    expect(shipCompactAdvice({ tokens: 700_000, prompt: "ship it --no-compact bitte", env })).toBeNull();
    expect(shipCompactAdvice({ tokens: 700_000, prompt: "/do-ship --no-compaction", env })).not.toBeNull();
  });

  test("never twice in a row: the ship prompt after an advice runs", () => {
    // 2026-09-22: advice, "ship", advice again, /compact, advice again (stale
    // size), /compact, advice again, then "/do-ship --no-compact". The second
    // ship prompt is the user's informed answer.
    expect(shipCompactAdvice({ tokens: 434_000, prompt: "/do-ship", advisedBefore: true, env })).toBeNull();
    expect(shipCompactAdvice({ tokens: 434_000, prompt: "/do-ship", advisedBefore: false, env })).not.toBeNull();
  });

  test("a promotion-only run (nothing unshipped) is never stopped — it is ~4 calls, not ~16", () => {
    expect(shipCompactAdvice({ tokens: 700_000, prompt: "promote stable", promotionOnly: true, env })).toBeNull();
    expect(shipCompactAdvice({ tokens: 700_000, prompt: "promote stable", promotionOnly: false, env })).not.toBeNull();
  });

  test("the default is high enough that compacting pays: ≥ 4 M saved", () => {
    expect(DEFAULT_THRESHOLD).toBe(350_000);
    expect(POST_COMPACT_FLOOR).toBe(100_000);
    expect(shipSavingEstimate(DEFAULT_THRESHOLD)).toBe("≈ 4.0 M");
    expect(shipCompactAdvice({ tokens: 285_000, prompt: "ship", env })).toBeNull();
    expect(shipSavingEstimate(50_000)).toBe("≈ 0.0 M");
  });

  test("an unknown context size never stops a ship", () => {
    expect(shipCompactAdvice({ tokens: null, prompt: "/do-ship", env })).toBeNull();
    expect(shipCompactAdvice({ tokens: undefined, prompt: "/do-ship", env })).toBeNull();
  });

  test("DOTCLAUDE_SHIP_COMPACT_THRESHOLD overrides, 0 disables, garbage falls back", () => {
    expect(threshold({})).toBe(DEFAULT_THRESHOLD);
    expect(threshold({ DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "300000" })).toBe(300_000);
    expect(threshold({ DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "0" })).toBe(0);
    expect(threshold({ DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "lots" })).toBe(DEFAULT_THRESHOLD);
    expect(threshold({ DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "-5" })).toBe(DEFAULT_THRESHOLD);
    expect(shipCompactAdvice({ tokens: 900_000, prompt: "/do-ship", env: { DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "0" } })).toBeNull();
    expect(shipCompactAdvice({ tokens: 250_000, prompt: "/do-ship", env: { DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "300000" } })).toBeNull();
  });

  test("cost estimate is ~16 re-reads", () => {
    expect(shipCostEstimate(434_000)).toBe("≈ 6.9 M");
    expect(shipCostEstimate(800_000)).toBe("≈ 13 M");
  });
});
