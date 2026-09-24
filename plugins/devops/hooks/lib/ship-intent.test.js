import { describe, test, expect } from "vitest";
import { isShipIntent, parseShipRequest, SHIP_KEYWORDS, SHIP_SLASH, KEYWORD_MAX_CHARS } from "./ship-intent.js";

// One classifier for both hooks: prompt.ship.detect turns the intent into a
// Skill('do-ship') instruction, prompt.flow.title-work marks the sidebar with
// 🚀 Shipping instead of the bare hourglass. Observed 2026-09-21: a "/do-ship"
// prompt after a change left "⏳" on the title for the whole pipeline because
// the title hook only knew the hourglass and the skill's own rename is a
// courtesy step the model sometimes skips.
describe("ship-intent", () => {
  test("slash invocations of the ship skill count, with or without arguments", () => {
    expect(isShipIntent("/do-ship")).toBe(true);
    expect(isShipIntent("/devops:do-ship")).toBe(true);
    expect(isShipIntent("  /do-ship --keep")).toBe(true);
    // the pre-PR-2 name still counts
    expect(isShipIntent("/ship")).toBe(true);
    expect(isShipIntent("/devops:ship --keep")).toBe(true);
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
    expect(isShipIntent("/do-ship?")).toBe(true);
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
    expect(isShipIntent("In `.claude/skills/do-ship/SKILL.md` (project ship extension of the dotclaude repo, Step 8) the hook path " +
      "is resolved with `ls | head -1`, which picks the oldest cache dir. Fix: prefer the marketplace clone.")).toBe(false);
    expect(isShipIntent("Ship trotzdem — mit skipChecks, die roten Befunde landen als Issue.")).toBe(true);
    expect(isShipIntent("/do-ship " + "x".repeat(400))).toBe(true);
    expect(isShipIntent("x".repeat(KEYWORD_MAX_CHARS - 8) + " ship it")).toBe(true);
    expect(isShipIntent("x".repeat(KEYWORD_MAX_CHARS) + " ship it")).toBe(false);
  });

  test("the keyword list is frozen — one source for both hooks", () => {
    expect(Object.isFrozen(SHIP_KEYWORDS)).toBe(true);
    expect(SHIP_KEYWORDS.length).toBeGreaterThan(5);
  });
});

// Skill restructure PR 2 — promote folded into do-ship: "ship" goes to alpha;
// naming beta or stable means "ship if anything is unshipped, then promote".
// The channel must be the OBJECT of a ship/promote/release/heben verb, never a
// noun in passing.
describe("parseShipRequest — target channel", () => {
  const cases = [
    // en
    ["promote stable", true, "stable"],
    ["promote to stable bitte", true, "stable"],
    ["Promote to beta", true, "beta"],
    ["release beta", true, "beta"],
    ["release stable", true, "stable"],
    ["ship stable", true, "stable"],
    ["ship it to stable", true, "stable"],
    ["Promote v0.171.0 to stable", true, "stable"],
    // de
    ["auf stable heben", true, "stable"],
    ["jetzt auf beta heben!", true, "beta"],
    ["stable promoten", true, "stable"],
    ["ship, dann direkt nach stable", true, "stable"],
    ["ship und dann auf stable", true, "stable"],
    ["ship alles nach stable", true, "stable"],
    ["erst beta, dann auf stable heben", true, "stable"],
    // slash forms
    ["/do-ship stable", true, "stable"],
    ["/do-ship promote beta", true, "beta"],
    ["/ship beta --keep", true, "beta"],
    ["/promote stable", true, "stable"],
    ["jetzt /promote stable", true, "stable"],
  ];
  test.each(cases)("%s → promote=%s channel=%s", (prompt, promote, channel) => {
    const r = parseShipRequest(prompt);
    expect(r.ship).toBe(true);
    expect(r.promote).toBe(promote);
    expect(r.channel).toBe(channel);
  });

  test("a bare promotion names no channel — do-ship asks which one", () => {
    for (const p of ["promote", "promote it", "jetzt promoten", "/promote", "/do-ship promote", "Promote!"]) {
      expect(parseShipRequest(p), p).toMatchObject({ ship: true, promote: true, channel: null });
    }
  });

  test("a plain ship is alpha — no promotion", () => {
    for (const p of ["ship", "ship it", "release", "/do-ship", "/do-ship --keep", "ab damit"]) {
      expect(parseShipRequest(p), p).toMatchObject({ ship: true, promote: false, channel: null });
    }
    expect(parseShipRequest("ship to alpha")).toMatchObject({ ship: true, promote: false, channel: "alpha" });
  });

  test("a named version travels with the promotion", () => {
    expect(parseShipRequest("Promote v0.171.0 to stable").version).toBe("0.171.0");
    expect(parseShipRequest("/do-ship stable 0.170.2").version).toBe("0.170.2");
    expect(parseShipRequest("promote stable").version).toBe(null);
    expect(parseShipRequest("ship it").version).toBe(null);
  });

  test("negatives — a channel word or 'promote' in passing is no order", () => {
    for (const p of [
      "promote the idea to the team",
      "promote this function to a class",
      "the stable API is broken",
      "fix the promote to stable flow",
      "bring the stable version back",
      "the `/promote` skill is gone",
      "promote to stable?",
      "sollen wir auf stable heben?",
      "der beta tester meldet einen crash",
    ]) {
      expect(parseShipRequest(p), p).toMatchObject({ ship: false, promote: false });
    }
    // a ship order that merely mentions a channel noun stays a plain ship
    expect(parseShipRequest("stable release notes need fixing, ship it")).toMatchObject({ ship: true, promote: false, channel: null });
    expect(parseShipRequest("release to beta testers")).toMatchObject({ promote: false, channel: null });
  });

  test("a mid-prompt /promote in long prose is a mention, not an order", () => {
    const prose = "Der /promote Button in der Card hat früher direkt promotet, das soll jetzt anders laufen — " +
      "bitte die Card-Texte prüfen und die Tooltips anpassen, damit klar ist, dass do-ship das übernimmt und erst shippt.";
    expect(prose.length).toBeGreaterThan(KEYWORD_MAX_CHARS);
    expect(parseShipRequest(prose).ship).toBe(false);
  });

  // Red-team R1: stable tags are irreversible, and a negated channel used to
  // resolve to stable — prompt.ship.detect mandated args "stable" and do-ship
  // promoted without asking. A negation near the channel or the promote verb
  // means no channel: a plain ship to alpha (or no ship at all).
  test.each([
    "ship, aber nicht auf stable",
    "ship it but don't promote to stable",
    "ship it but do not promote to stable",
    "ship it, not to stable",
    "ship, kein stable",
    "ship, keine Promotion auf stable",
    "ship ohne promote",
    "ship ohne promote auf stable",
    "ship, no promotion",
    "ship it, no promotion to stable",
    "ship, bloß nicht nach stable",
    "ship und nie auf stable",
    "ship it, never to stable",
    "ship without promoting to stable",
    "ship to stable, not yet",
    "ship to stable — lieber nicht",
    "/do-ship not stable",
    "/do-ship nicht stable",
  ])("negated channel → plain ship to alpha: %s", (p) => {
    expect(parseShipRequest(p)).toMatchObject({ ship: true, promote: false, channel: null });
  });

  test("negated channel without a ship keyword → no order at all", () => {
    for (const p of ["nicht auf stable heben", "auf stable heben, lieber nicht", "don't promote to stable", "kein stable"]) {
      expect(parseShipRequest(p), p).toMatchObject({ promote: false, channel: null });
    }
    // a negated slash channel falls back to a bare promotion — do-ship asks
    expect(parseShipRequest("/promote nicht stable")).toMatchObject({ promote: true, channel: null });
  });

  test("positives survive the negation guard", () => {
    expect(parseShipRequest("promote stable, nicht beta")).toMatchObject({ promote: true, channel: "stable" });
    expect(parseShipRequest("don't wait, ship to stable")).toMatchObject({ promote: true, channel: "stable" });
    expect(parseShipRequest("promote to stable and don't forget the changelog")).toMatchObject({ promote: true, channel: "stable" });
    expect(parseShipRequest("ship und dann auf stable")).toMatchObject({ promote: true, channel: "stable" });
  });

  // Red-team R2(c): only a semver ADJACENT to the promotion phrase is the
  // target — a version elsewhere is context ("fixes the 0.170.2 regression").
  test.each([
    ["promote stable 0.170.2", "0.170.2"],
    ["promote stable v0.170.2", "0.170.2"],
    ["promote 0.170.2 auf stable", "0.170.2"],
    ["ship 0.170.2 to stable", "0.170.2"],
    ["Promote v0.171.0 to stable", "0.171.0"],
    ["/do-ship stable 0.170.2", "0.170.2"],
    ["/promote 0.170.2", "0.170.2"],
    ["promote 0.193.0", "0.193.0"],
    ["promote stable, fixes 0.170.2 regression", null],
    ["promote stable — the 0.170.2 bug is fixed", null],
    ["auf stable heben, 0.170.2 war kaputt", null],
  ])("version adjacency: %s → %s", (p, v) => {
    expect(parseShipRequest(p).version).toBe(v);
  });

  test("isShipIntent counts a promotion — the title hook marks it like a ship", () => {
    expect(isShipIntent("promote stable")).toBe(true);
    expect(isShipIntent("auf beta heben")).toBe(true);
    expect(isShipIntent("promote the idea to the team")).toBe(false);
  });
});
