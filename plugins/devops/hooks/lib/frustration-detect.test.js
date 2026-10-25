import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { detect, isFlagged, claimsDone, stripNoise, targetRefs } = require("./frustration-detect.js");

function run(prompts, ctx = {}) {
  let state = null;
  let last;
  for (const p of prompts) {
    const [text, c] = Array.isArray(p) ? p : [p, {}];
    last = detect(text, state, { ...ctx, ...c });
    state = last.state;
  }
  return last;
}

describe("frustration-detect", () => {
  test("three rounds of strong correction after a done-claim flag", () => {
    const r = run([
      ["that's still wrong in app.js", { claimedDone: true }],
      ["it's still wrong, app.js again not working", { claimedDone: true }],
      ["I already said it is wrong, immer noch app.js", { claimedDone: true }],
    ]);
    expect(r.rounds).toBe(3);
    expect(r.score).toBeGreaterThanOrEqual(6);
    expect(r.flagged).toBe(true);
    expect(r.signals).toContain("T2");
  });

  test("two rounds never flag", () => {
    const r = run([["not what I asked", { claimedDone: true }], ["not what I asked again", { claimedDone: true }]]);
    expect(r.flagged).toBe(false);
  });

  test("design tuning with weak phrases stays silent", () => {
    const r = run(["a bit bigger please", "a bit more spacing, again", "slightly smaller, nochmal", "etwas kleiner nochmal"]);
    expect(r.rounds).toBe(4);
    expect(r.score).toBeLessThan(6);
    expect(r.flagged).toBe(false);
  });

  test("acknowledgment resets the episode", () => {
    const r = run(["that's still wrong in a.js", "not what I asked", "perfekt, danke"]);
    expect(r.rounds).toBe(0);
    expect(r.score).toBe(0);
    expect(r.signals).toEqual(["C1"]);
  });

  test("a different explicit target opens a new episode", () => {
    const r = run(["still wrong in a.js", "still wrong in a.js", "still wrong in b.js"]);
    expect(r.rounds).toBe(1);
  });

  test("pasted logs and code blocks do not count", () => {
    const text = "here:\n```\nerror: still failing again not working\n```\n> still wrong";
    expect(stripNoise(text)).not.toMatch(/still/);
    expect(run([text]).score).toBe(0);
  });

  test("snooze phrase sets snoozed and blocks the flag", () => {
    const r = run(["nicht mehr vorschlagen"]);
    expect(r.state.snoozed).toBe(true);
    expect(isFlagged({ ...r.state, rounds: 5, score: 20 })).toBe(false);
  });

  test("cooldown after an offer: needs 3 more rounds and +6 score", () => {
    const st = { rounds: 4, score: 7, offer: { rounds: 3, score: 6 }, snoozed: false };
    expect(isFlagged(st)).toBe(false);
    expect(isFlagged({ ...st, rounds: 6, score: 12 })).toBe(true);
  });

  test("T4 revert requests and T9 restated requirement add points", () => {
    const base = "please make the export button download the csv file with all columns";
    const r = run([base, `${base} please`, "undo that, wie vorher"]);
    expect(r.signals).toContain("T4");
    expect(r.state.score).toBeGreaterThanOrEqual(3);
  });

  test("helpers", () => {
    expect(claimsDone("Fixed the bug, should work now.")).toBe(true);
    expect(claimsDone("What do you think?")).toBe(false);
    expect(targetRefs("see src/a.js and #42")).toEqual(["src/a.js", "#42"]);
  });

  test("never throws on junk state", () => {
    expect(() => detect(null, "junk", null)).not.toThrow();
    expect(detect(undefined, 5).flagged).toBe(false);
  });
});
