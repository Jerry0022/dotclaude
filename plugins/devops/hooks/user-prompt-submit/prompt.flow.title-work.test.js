import { describe, test, expect } from "vitest";
import { WORK_PREFIX, KNOWN_PREFIX_EMOJI, instruction, shouldMark } from "./prompt.flow.title-work.js";
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
  });

  test("the instruction names both session-mgmt tools, the wrench, and the silent-skip rule", () => {
    const text = instruction();
    expect(text).toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain("mcp__ccd_session_mgmt__set_session_title");
    expect(text).toContain(`"${WORK_PREFIX}" + title`);
    expect(text).toMatch(/icon-only/);
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
  });

  test("marks a real user prompt, not a silent tick, a scheduled task, or an empty prompt", () => {
    expect(shouldMark({ prompt: "mach mal was" })).toBe(true);
    expect(shouldMark({ prompt: "Silently run via Bash: node x.js" })).toBe(false);
    expect(shouldMark({ prompt: '<scheduled-task name="x" file="y">tick' })).toBe(false);
    expect(shouldMark({ prompt: "   " })).toBe(false);
    expect(shouldMark({})).toBe(false);
  });
});
