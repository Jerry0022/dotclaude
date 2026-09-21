import { describe, test, expect } from "vitest";
import { isShipIntent, SHIP_KEYWORDS, SHIP_SLASH, KEYWORD_MAX_CHARS } from "./ship-intent.js";

// One classifier for both hooks: prompt.ship.detect turns the intent into a
// Skill('ship') instruction, prompt.flow.title-work marks the sidebar with
// 🚀 Shipping instead of the bare hourglass. Observed 2026-09-21: a "/ship"
// prompt after a change left "⏳" on the title for the whole pipeline because
// the title hook only knew the hourglass and the skill's own rename is a
// courtesy step the model sometimes skips.
describe("ship-intent", () => {
  test("slash invocations of the ship skill count, with or without arguments", () => {
    expect(isShipIntent("/ship")).toBe(true);
    expect(isShipIntent("/devops:ship")).toBe(true);
    expect(isShipIntent("  /ship --keep")).toBe(true);
    expect(isShipIntent("/Ship it")).toBe(true);
    expect(SHIP_SLASH.test("/shipping-list")).toBe(false);
  });

  test("direct keywords in German and English", () => {
    for (const p of ["ship it", "Shippen bitte", "ab damit", "mach nen PR", "merge it", "push and merge",
      "das kann rein", "fertig", "ausliefern", "raushauen", "release", "PR erstellen"]) {
      expect(isShipIntent(p), p).toBe(true);
    }
  });

  test("a question is a status request, not a ship order", () => {
    for (const p of ["fertig?", "Fertig ?", "ship it?", "können wir das releasen?"]) {
      expect(isShipIntent(p), p).toBe(false);
    }
    expect(isShipIntent("/ship?")).toBe(true);
  });

  test("ordinary prompts are not a ship", () => {
    for (const p of ["fix the login bug", "warum ist die Card halb?", "erkläre mir das", "", "   ", undefined, null]) {
      expect(isShipIntent(p), String(p)).toBe(false);
    }
  });

  // Observed 2026-09-21: two long prompts that merely MENTIONED a ship ("the
  // project ship extension …", "… und NICHT erneut geshipped … ein ship war")
  // were marked 🚀 Shipping. A keyword is an order only in a short prompt.
  test("a keyword in long prose is a mention, not an order — the slash form has no limit", () => {
    const prose = "außerdem wenn einmal etwas shipped wurde steht der chat titel auf shipped, auch wenn nach dem " +
      "initialen ship weitergearbeitet wurde und NICHT erneut geshipped. Das sollte sich ändern, ich würde " +
      "erst sanduhr und dann ready erwarten und ship immer nur wenn das letzte was gemacht wurde ein ship war";
    expect(prose.length).toBeGreaterThan(KEYWORD_MAX_CHARS);
    expect(isShipIntent(prose)).toBe(false);
    expect(isShipIntent("In `.claude/skills/ship/SKILL.md` (project ship extension of the dotclaude repo, Step 8) the hook path " +
      "is resolved with `ls | head -1`, which picks the oldest cache dir. Fix: prefer the marketplace clone.")).toBe(false);
    expect(isShipIntent("Ship trotzdem — mit skipChecks, die roten Befunde landen als Issue.")).toBe(true);
    expect(isShipIntent("/ship " + "x".repeat(400))).toBe(true);
    expect(isShipIntent("x".repeat(KEYWORD_MAX_CHARS - 8) + " ship it")).toBe(true);
    expect(isShipIntent("x".repeat(KEYWORD_MAX_CHARS) + " ship it")).toBe(false);
  });

  test("the keyword list is frozen — one source for both hooks", () => {
    expect(Object.isFrozen(SHIP_KEYWORDS)).toBe(true);
    expect(SHIP_KEYWORDS.length).toBeGreaterThan(5);
  });
});
