import { describe, test, expect } from "vitest";
import { isShipIntent, SHIP_KEYWORDS, SHIP_SLASH } from "./ship-intent.js";

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

  test("the keyword list is frozen — one source for both hooks", () => {
    expect(Object.isFrozen(SHIP_KEYWORDS)).toBe(true);
    expect(SHIP_KEYWORDS.length).toBeGreaterThan(5);
  });
});
