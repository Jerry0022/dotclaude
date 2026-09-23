import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ONCE_KEY, WORK_PREFIX, LEGACY_PENDING_PREFIX, SHIPPING_PREFIX, CONCEPT_PREFIX, MODE_PREFIX_EMOJI, OUTCOME_PREFIX_EMOJI, KNOWN_PREFIX_EMOJI, instruction, prefixFor, shouldMark, releaseTitleWork } from "./prompt.flow.title-work.js";
import { runOnce } from "../lib/run-once.js";
import { SESSION_PREFIX, LEGACY_PREFIXES, releasedPrefix } from "../../mcp-server/lib/mode-state.js";

// The first prompt of a session puts the wrench on the sidebar title. The
// hook is CJS and pins its own copy of the prefix; these tests bind it to
// the ESM source of truth so the two can never drift.
describe("prompt.flow.title-work", () => {
  test("the bare icon is SESSION_PREFIX.work — icon only, no word", () => {
    expect(WORK_PREFIX).toBe(SESSION_PREFIX.work);
    expect(WORK_PREFIX).toBe("⏳ ");
  });

  // One hourglass: the card's pending prefix IS the bare icon. The worded
  // "⏳ Working – " is only a legacy form a title may still carry.
  test("the card's pending prefix is the same bare icon; the worded form is legacy only", () => {
    expect(SESSION_PREFIX.pending).toBe(WORK_PREFIX);
    expect(LEGACY_PREFIXES).toContain(LEGACY_PENDING_PREFIX);
    expect(LEGACY_PENDING_PREFIX).toBe("⏳ Working – ");
    expect(LEGACY_PENDING_PREFIX.startsWith(WORK_PREFIX)).toBe(true);
  });

  test("the concept prefix mirrors SESSION_PREFIX.concept", () => {
    expect(CONCEPT_PREFIX).toBe(SESSION_PREFIX.concept);
  });

  test("knows the leading emoji of every prefix the card or a skill may leave", () => {
    const all = [...Object.values(SESSION_PREFIX), ...LEGACY_PREFIXES, releasedPrefix("stable")];
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
  // just add the bare icon to an unmarked title — and must leave a mode
  // prefix alone.
  test("the instruction replaces an outcome prefix with the bare icon and leaves batch untouched", () => {
    const text = instruction();
    for (const e of MODE_PREFIX_EMOJI) expect(text).toContain(e);
    expect(text).toMatch(/starts with 📥: do nothing — batch mode owns it/);
    for (const e of OUTCOME_PREFIX_EMOJI) expect(text).toContain(e);
    expect(text).toMatch(/strip every leading/);
    expect(text).toContain(`"${SESSION_PREFIX.test}"`);
    expect(text).toContain(`"${LEGACY_PENDING_PREFIX}"`);
    expect(text).toContain(`"${releasedPrefix("stable")}"`);
    expect(text).toContain(`already starts with "${WORK_PREFIX}" and NOT with "${LEGACY_PENDING_PREFIX}": do nothing`);
  });

  // The compass means "the page waits for YOU". A user prompt in a concept
  // session means Claude works now — the sidebar must say so, and the turn's
  // card brings the compass back while the page still waits.
  test("a user prompt swaps the concept compass for the hourglass and names the card that restores it", () => {
    const text = instruction();
    expect(text).not.toMatch(/starts with 🧭 or 📥: do nothing/);
    expect(text).toMatch(/prefix whose emoji is one of 🧭 /);
    expect(text).toContain(`"${CONCEPT_PREFIX}"`);
    expect(text).toMatch(/brings the compass back/);
    expect(text).toContain(`"${WORK_PREFIX}" + <stripped title>`);
    // A ship prompt in a concept session goes straight to Shipping.
    const ship = instruction(SHIPPING_PREFIX);
    expect(ship).toMatch(/prefix whose emoji is one of 🧭 /);
    expect(ship).toContain(`"${SHIPPING_PREFIX}" + <stripped title>`);
  });

  // A machine turn (a task notification — the concept waker/pulser exit that
  // way) may end without a card: flipping the compass there would strand ⏳
  // on a page that waits. The concept skill does that swap itself once a
  // submission is confirmed.
  test("a machine turn keeps the concept compass and the batch prefix", () => {
    const text = instruction(WORK_PREFIX, { machine: true });
    expect(text).toMatch(/starts with 🧭 or 📥: do nothing — a mode owns it/);
    expect(text).not.toMatch(/prefix whose emoji is one of 🧭 /);
    expect(text).not.toContain(`"${CONCEPT_PREFIX}"`);
    expect(text).not.toMatch(/brings the compass back/);
    expect(text).toContain(`"${WORK_PREFIX}" + <stripped title>`);
  });

  // Observed 2026-09-21: "/ship" after a change left "⏳" on the title for
  // the whole pipeline — the hook only knew the hourglass and the ship
  // skill's own rename is a courtesy the model sometimes skips. A process
  // outranks the fallback: a ship prompt is marked 🚀 Shipping by the hook
  // itself, and a title already on 🚀 Shipping is never downgraded.
  test("a ship prompt gets the Shipping prefix, anything else the bare hourglass", () => {
    expect(SHIPPING_PREFIX).toBe(SESSION_PREFIX.shipping);
    expect(prefixFor("/ship")).toBe(SHIPPING_PREFIX);
    expect(prefixFor("/devops:ship --keep")).toBe(SHIPPING_PREFIX);
    expect(prefixFor("ab damit")).toBe(SHIPPING_PREFIX);
    expect(prefixFor("fix the login bug")).toBe(WORK_PREFIX);
    expect(prefixFor("")).toBe(WORK_PREFIX);
  });

  test("the ship instruction sets Shipping, names it as Pre-Step C done early, and strips Shipped", () => {
    const text = instruction(SHIPPING_PREFIX);
    expect(text).toMatch(/— a ship\./);
    expect(text).toContain(`"${SHIPPING_PREFIX}" + <stripped title>`);
    expect(text).toContain(`already starts with "${SHIPPING_PREFIX}": do nothing`);
    expect(text).toContain(`"${SESSION_PREFIX.shipped}"`);
    expect(text).toMatch(/Pre-Step C/);
    expect(text).not.toContain(`"${WORK_PREFIX}" + <stripped title>`);
  });

  test("the hourglass instruction never replaces a running Shipping prefix", () => {
    const text = instruction();
    expect(text).toContain(`already starts with "${SHIPPING_PREFIX}": do nothing`);
    expect(text).toMatch(/hourglass is only the fallback/);
    expect(text).toContain(`"${WORK_PREFIX}" + <stripped title>`);
    expect(instruction(WORK_PREFIX)).toBe(text);
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

  // End to end through the real hook process: a typed prompt may swap the
  // compass, a task notification (the concept waker's wake-up) must not.
  describe("hook process", () => {
    const HOOK = fileURLToPath(new URL("./prompt.flow.title-work.js", import.meta.url));
    const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
    const run = (prompt) => {
      const sid = "title-work-e2e-" + process.pid + "-" + Math.random().toString(36).slice(2);
      try {
        return execFileSync(process.execPath, [HOOK], {
          input: JSON.stringify({ session_id: sid, prompt }),
          env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
          encoding: "utf8",
        });
      } finally {
        releaseTitleWork(sid);
      }
    };

    test("a typed prompt gets the instruction that swaps the compass", () => {
      const out = run("mach die Seite noch hübscher");
      expect(out).toContain("[prompt.flow.title-work]");
      expect(out).toMatch(/prefix whose emoji is one of 🧭 /);
      expect(out).toMatch(/starts with 📥: do nothing — batch mode owns it/);
    });

    test("a task notification keeps the compass", () => {
      const out = run("<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>WAKER_EXIT reason=PENDING_SUBMISSION version=3 action=iterate</summary>\n</task-notification>");
      expect(out).toContain("[prompt.flow.title-work]");
      expect(out).toMatch(/starts with 🧭 or 📥: do nothing — a mode owns it/);
      expect(out).not.toMatch(/prefix whose emoji is one of 🧭 /);
    });

    test("a silent tick gets nothing", () => {
      expect(run("Silently service the concept bridge on port 8851")).toBe("");
    });
  });

  test("marks a real user prompt, not a silent tick, a scheduled task, or an empty prompt", () => {
    expect(shouldMark({ prompt: "mach mal was" })).toBe(true);
    expect(shouldMark({ prompt: "Silently run via Bash: node x.js" })).toBe(false);
    expect(shouldMark({ prompt: '<scheduled-task name="x" file="y">tick' })).toBe(false);
    expect(shouldMark({ prompt: "   " })).toBe(false);
    expect(shouldMark({})).toBe(false);
  });
});
