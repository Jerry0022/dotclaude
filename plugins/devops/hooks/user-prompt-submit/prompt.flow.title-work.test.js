import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ONCE_KEY, WORK_PREFIX, MODE_PREFIX_EMOJI, OUTCOME_PREFIX_EMOJI, KNOWN_PREFIX_EMOJI, instruction, shouldMark, releaseTitleWork } from "./prompt.flow.title-work.js";
import { runOnce } from "../lib/run-once.js";
import { SESSION_PREFIX, releasedPrefix } from "../../mcp-server/lib/mode-state.js";

// The first prompt of a session puts the wrench on the sidebar title. The
// hook is CJS and pins its own copy of the prefix; these tests bind it to
// the ESM source of truth so the two can never drift.
describe("prompt.flow.title-work", () => {
  test("the wrench is SESSION_PREFIX.work — icon only, no word", () => {
    expect(WORK_PREFIX).toBe(SESSION_PREFIX.work);
    expect(WORK_PREFIX).toBe("🔧 ");
  });

  test("knows the leading emoji of every prefix the card or a skill may leave", () => {
    const all = [...Object.values(SESSION_PREFIX), releasedPrefix("stable")];
    for (const p of all) {
      expect(KNOWN_PREFIX_EMOJI.some((e) => p.startsWith(e)), p).toBe(true);
    }
    expect(KNOWN_PREFIX_EMOJI).toEqual([...MODE_PREFIX_EMOJI, ...OUTCOME_PREFIX_EMOJI]);
  });

  // The mode prefixes are owned by their skills for the mode's lifetime;
  // everything else is an outcome of a past turn that a new prompt outdates.
  test("splits mode prefixes (concept, batch) from outcome prefixes — the wrench counts as an outcome", () => {
    expect(MODE_PREFIX_EMOJI.some((e) => SESSION_PREFIX.concept.startsWith(e))).toBe(true);
    expect(MODE_PREFIX_EMOJI.some((e) => SESSION_PREFIX.batch.startsWith(e))).toBe(true);
    expect(MODE_PREFIX_EMOJI).toHaveLength(2);
    for (const [k, p] of Object.entries(SESSION_PREFIX)) {
      if (k === "concept" || k === "batch") continue;
      expect(OUTCOME_PREFIX_EMOJI.some((e) => p.startsWith(e)), k).toBe(true);
      expect(MODE_PREFIX_EMOJI.some((e) => p.startsWith(e)), k).toBe(false);
    }
  });

  test("the instruction names both session-mgmt tools, the wrench, and the silent-skip rule", () => {
    const text = instruction();
    expect(text).toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain("mcp__ccd_session_mgmt__set_session_title");
    expect(text).toContain(`"${WORK_PREFIX}" + <stripped title>`);
    expect(text).toMatch(/icon-only/);
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
  });

  // Observed 2026-09-20: "🧪 Test – App-Performance-Optimierung" stayed on
  // Test for hours while a follow-up prompt had the session implementing with
  // background tasks. The instruction must replace an outcome prefix, not
  // just add the wrench to a bare title — and must leave a mode prefix alone.
  test("the instruction replaces an outcome prefix with the wrench and leaves mode prefixes untouched", () => {
    const text = instruction();
    for (const e of MODE_PREFIX_EMOJI) expect(text).toContain(e);
    expect(text).toMatch(/starts with 🧭 or 📥: do nothing/);
    for (const e of OUTCOME_PREFIX_EMOJI) expect(text).toContain(e);
    expect(text).toMatch(/strip every leading/);
    expect(text).toContain(`"${SESSION_PREFIX.test}"`);
    expect(text).toContain(`"${SESSION_PREFIX.pending}"`);
    expect(text).toContain(`"${releasedPrefix("stable")}"`);
    expect(text).toMatch(/already starts with 🔧: do nothing/);
  });

  // stop.flow.guard hands the token back after every card, so the next real
  // prompt re-marks the title; a prompt without a card in between does not.
  test("runs once per session until releaseTitleWork gives the token back", () => {
    const sid = "title-work-test-" + process.pid + "-" + Date.now();
    releaseTitleWork(sid);
    try {
      expect(runOnce(ONCE_KEY, sid)).toBe(true);
      expect(runOnce(ONCE_KEY, sid)).toBe(false);
      expect(releaseTitleWork(sid)).toBe(true);
      expect(runOnce(ONCE_KEY, sid)).toBe(true);
      expect(ONCE_KEY).toBe("prompt-title-work");
    } finally {
      releaseTitleWork(sid);
    }
  });

  test("marks a real user prompt, not a silent tick, a scheduled task, or an empty prompt", () => {
    expect(shouldMark({ prompt: "mach mal was" })).toBe(true);
    expect(shouldMark({ prompt: "Silently run via Bash: node x.js" })).toBe(false);
    expect(shouldMark({ prompt: '<scheduled-task name="x" file="y">tick' })).toBe(false);
    expect(shouldMark({ prompt: "   " })).toBe(false);
    expect(shouldMark({})).toBe(false);
  });
});
