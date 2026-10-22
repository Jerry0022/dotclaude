import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ONCE_KEY, WORK_PREFIX, LEGACY_PENDING_PREFIX, LEGACY_PREFIXES as HOOK_LEGACY, SHIPPING_PREFIX, CONCEPT_PREFIX, BATCH_PREFIX, instruction, directInstruction, titleWorkOutput, prefixFor, shouldMark, releaseTitleWork } from "./prompt.flow.title-work.js";
import { runOnce } from "../lib/run-once.js";
import { SESSION_PREFIX, LEGACY_PREFIXES } from "../../mcp-server/lib/mode-state.js";
import TITLE_SCHEME_MOD from "../lib/title-scheme.js";

// The first prompt of a session puts the bare hourglass on the sidebar title.
// The hook is CJS and reads the shared scheme (lib/title-scheme.js); these
// tests bind it to the ESM side so the two can never drift.
describe("prompt.flow.title-work", () => {
  test("the generic prefix is SESSION_PREFIX.work — Solo, no named process", () => {
    expect(WORK_PREFIX).toBe(SESSION_PREFIX.work);
    expect(WORK_PREFIX).toBe("⏳ ┃ 🤖 Solo ");
  });

  test("the worded hourglass is legacy only; the hook and the card share one legacy list", () => {
    expect(LEGACY_PREFIXES).toContain(LEGACY_PENDING_PREFIX);
    expect(LEGACY_PENDING_PREFIX).toBe("⏳ Working – ");
    expect(HOOK_LEGACY).toEqual(LEGACY_PREFIXES);
  });

  test("the mode and process prefixes mirror SESSION_PREFIX", () => {
    expect(CONCEPT_PREFIX).toBe(SESSION_PREFIX["concept-waiting"]);
    expect(BATCH_PREFIX).toBe(SESSION_PREFIX.batch);
    expect(SHIPPING_PREFIX).toBe(SESSION_PREFIX.shipping);
    expect(SHIPPING_PREFIX).toBe("⏳ ┃ 🚀 Shipping ");
  });

  test("the instruction names both session-mgmt tools, the hourglass, and the silent-skip rule", () => {
    const text = instruction();
    expect(text).toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain("mcp__ccd_session_mgmt__set_session_title");
    expect(text).toContain(`"${WORK_PREFIX}" + <stripped title>`);
    expect(text).toMatch(/names no process/);
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
    // #661: a deferred tool is not an unavailable one — load, then call.
    expect(text).toMatch(/Deferred is not unavailable/);
    expect(text).toContain("select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title");
  });

  // Observed 2026-09-20: "🧪 Test – App-Performance-Optimierung" stayed on
  // Test for hours while a follow-up prompt had the session implementing.
  // The instruction must replace an outcome prefix and leave batch alone.
  test("the instruction replaces an outcome prefix with the bare icon and leaves batch untouched", () => {
    const text = instruction();
    expect(text).toContain(`starts with "${BATCH_PREFIX}" (or the legacy "📥 Batch – " / "👉 📥 Batch – "): do nothing — batch mode owns it`);
    for (const s of ["⏳", "👉", "🟩", "🟥", "🟦"]) expect(text).toContain(s);
    expect(text).toMatch(/strip every leading/);
    for (const p of LEGACY_PREFIXES) expect(text).toContain(`"${p}"`);
    expect(text).toContain(`already starts with "${WORK_PREFIX}" (or a bare "⏳ <title>") and NOT "${LEGACY_PENDING_PREFIX}": do nothing`);
    // F6: free text is never stripped.
    expect(text).toMatch(/never free text such as "Fix Login – "/);
  });

  // A waiting concept means "the page waits for YOU". A user prompt means
  // Claude works now — the card at the turn end sets the concept prefix again.
  test("a user prompt yields a waiting concept and names the card that restores it", () => {
    const text = instruction();
    expect(text).toContain(`A "${CONCEPT_PREFIX}" title yields too`);
    expect(text).toMatch(/sets the concept prefix again/);
    const ship = instruction(SHIPPING_PREFIX);
    expect(ship).toContain(`"${SHIPPING_PREFIX}" + <stripped title>`);
  });

  // A machine turn (a task notification — the concept waker/pulser exit that
  // way) may end without a card: it keeps every known prefix (#618).
  test("a machine turn keeps every known prefix but the legacy worded hourglass", () => {
    const text = instruction(WORK_PREFIX, { machine: true });
    expect(text).toMatch(/do nothing —\n {2}a mode or a card owns it/);
    expect(text).toContain(`other than "${LEGACY_PENDING_PREFIX}"`);
    expect(text).not.toContain(`A "${CONCEPT_PREFIX}" title yields too`);
    expect(text).toContain(`"${WORK_PREFIX}" + <stripped title>`);
  });

  // Observed 2026-09-21: "/do-ship" after a change left "⏳" on the title for
  // the whole pipeline. A process outranks the fallback: a ship prompt is
  // marked Shipping by the hook itself, and Shipping is never downgraded.
  test("a ship prompt gets the Shipping prefix, anything else the bare hourglass", () => {
    expect(prefixFor("/do-ship")).toBe(SHIPPING_PREFIX);
    expect(prefixFor("/devops:do-ship --keep")).toBe(SHIPPING_PREFIX);
    expect(prefixFor("ab damit")).toBe(SHIPPING_PREFIX);
    expect(prefixFor("fix the login bug")).toBe(WORK_PREFIX);
    expect(prefixFor("")).toBe(WORK_PREFIX);
  });

  test("the ship instruction sets Shipping and names it as Pre-Step C done early", () => {
    const text = instruction(SHIPPING_PREFIX);
    expect(text).toMatch(/— a ship\./);
    expect(text).toContain(`"${SHIPPING_PREFIX}" + <stripped title>`);
    expect(text).toContain(`already starts with "${SHIPPING_PREFIX}": do nothing`);
    expect(text).toMatch(/Pre-Step C/);
    expect(text).not.toContain(`"${WORK_PREFIX}" + <stripped title>`);
  });

  test("the hourglass instruction never replaces a running Shipping or other ⏳ process", () => {
    const text = instruction();
    expect(text).toContain(`already starts with "${SHIPPING_PREFIX}" (or the legacy "🚀 Shipping – "): do nothing`);
    expect(text).toMatch(/hourglass is only the fallback/);
    expect(text).toMatch(/any other "⏳ ┃ <Word> <activity> " prefix \(a running named process\): do nothing/);
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

    test("a typed prompt gets the instruction that yields the waiting concept", () => {
      const out = run("mach die Seite noch hübscher");
      expect(out).toContain("[prompt.flow.title-work]");
      expect(out).toContain("title yields too");
      expect(out).toMatch(/do nothing — batch mode owns it/);
    });

    test("a task notification keeps the concept prefix", () => {
      const out = run("<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>WAKER_EXIT reason=PENDING_SUBMISSION version=3 action=iterate</summary>\n</task-notification>");
      expect(out).toContain("[prompt.flow.title-work]");
      expect(out).toMatch(/a mode or a card owns it/);
      expect(out).not.toContain("title yields too");
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

// "weiter" after a usage limit or a crash continues a ship: the title says
// Shipping, never the hourglass (lib/ship-resume.js).
describe("prompt.flow.title-work — a resumed ship is shipping", () => {
  test("'weiter' with an open ship checkpoint → Shipping; without one → hourglass", async () => {
    const dir = mkdtempSync(join(tmpdir(), "title-resume-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      expect(prefixFor("weiter", dir)).toBe(WORK_PREFIX);
      const cp = (await import("../lib/ship-checkpoint.js")).default;
      cp.recordShipStep("ship_preflight", { cwd: dir }, { ready: true, branch: "feat/x", base: "main" });
      expect(prefixFor("weiter", dir)).toBe(SHIPPING_PREFIX);
      expect(prefixFor("Continue from where you left off.", dir)).toBe(SHIPPING_PREFIX);
      expect(prefixFor("bau mir ein neues Feature", dir)).toBe(WORK_PREFIX);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Token cost: the get_session → strip → set ritual was 2–3 extra API calls per
// prompt. With the title read from the transcript, the hook hands Claude the
// exact title to set in parallel with the turn's first tool call.
describe("prompt.flow.title-work — title known from the transcript", () => {
  const dir = mkdtempSync(join(tmpdir(), "title-direct-"));
  const transcript = (title) => {
    const p = join(dir, Math.random().toString(36).slice(2) + ".jsonl");
    writeFileSync(p, JSON.stringify({ type: "user", message: { content: "hi" } }) + "\n" +
      (title === null ? "" : JSON.stringify({ type: "custom-title", customTitle: title, sessionId: "s" }) + "\n"));
    return p;
  };
  const out = (title, prompt = "fix the login bug") => titleWorkOutput({ transcript_path: transcript(title) }, prompt, dir);

  test("the direct instruction carries the exact title, set in parallel — no get_session", () => {
    const text = out("🧪 Test – Login");
    expect(text).toBe(directInstruction(WORK_PREFIX + "Login"));
    expect(text).toContain('mcp__ccd_session_mgmt__set_session_title {session_id:"self", title:' + JSON.stringify(WORK_PREFIX + "Login") + "}");
    expect(text).toMatch(/SAME message as this turn's first other tool call/);
    expect(text).not.toContain("mcp__ccd_session_mgmt__get_session");
    expect(text).toContain('ToolSearch "select:mcp__ccd_session_mgmt__set_session_title"');
    expect(text).toMatch(/skip silently/);
    expect(text).toMatch(/Desktop app only/);
    expect(text).toMatch(/Do not mention this to the user/);
    expect(text).not.toMatch(/concept prefix/);
  });

  test("a title that is already right → no output at all", () => {
    expect(out("⏳ Login")).toBe("");
    expect(out("👉 ┃ 📚 Batch Queue")).toBe("");
    expect(out("📥 Batch – Queue")).toBe("");
    expect(out("⏳ ┃ 🚀 Shipping Login")).toBe("");
    expect(out("🚀 Shipping – Login")).toBe("");
    // R1: every ⏳ two-slot process stays — the bare-⏳ shortcut is not what keeps them.
    expect(out("⏳ ┃ 🧭 Concept Login")).toBe("");
    expect(out("⏳ ┃ 🤖 Team Login")).toBe("");
    expect(out("⏳ ┃ 🧪 Testing Login")).toBe("");
  });

  test("a ship prompt gets the Shipping title and the Pre-Step C note", () => {
    const text = out("⏳ Login", "/do-ship");
    expect(text).toContain("title:" + JSON.stringify("⏳ ┃ 🚀 Shipping Login"));
    expect(text).toMatch(/Pre-Step C/);
  });

  test("a waiting concept title yields and names the card that restores it", () => {
    for (const cur of ["👉 ┃ 🧭 Concept Dashboard", "🧭 Concept – Dashboard"]) {
      const text = out(cur);
      expect(text, cur).toContain("title:" + JSON.stringify(WORK_PREFIX + "Dashboard"));
      expect(text, cur).toMatch(/sets it again/);
    }
  });

  test("a machine turn leaves an outcome alone", () => {
    expect(out("🟩 ┃ 🚀 Alpha Login", "<task-notification>\n<status>completed</status>\n</task-notification>")).toBe("");
  });

  test("title unknown (no entry, no transcript) → the get_session fallback", () => {
    expect(out(null)).toBe(instruction(WORK_PREFIX));
    expect(titleWorkOutput({}, "fix it", dir)).toBe(instruction(WORK_PREFIX));
    expect(titleWorkOutput({}, "/do-ship", dir)).toBe(instruction(SHIPPING_PREFIX));
  });

  test("hook process: direct instruction with a transcript, silence when already marked", () => {
    const HOOK = fileURLToPath(new URL("./prompt.flow.title-work.js", import.meta.url));
    const PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
    const run = (title) => {
      const sid = "title-direct-e2e-" + process.pid + "-" + Math.random().toString(36).slice(2);
      try {
        return execFileSync(process.execPath, [HOOK], {
          input: JSON.stringify({ session_id: sid, prompt: "fix it", transcript_path: transcript(title), cwd: dir }),
          env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
          encoding: "utf8",
        });
      } finally {
        releaseTitleWork(sid);
      }
    };
    expect(run("👉 ┃ 📦 Ready Login")).toContain("title:" + JSON.stringify(WORK_PREFIX + "Login"));
    expect(run("📦 Ready – Login")).toContain("title:" + JSON.stringify(WORK_PREFIX + "Login"));
    expect(run("⏳ Login")).toBe("");
  });
});
