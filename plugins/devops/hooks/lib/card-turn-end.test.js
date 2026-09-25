import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", "..");
const {
  STOP_REASON, BLOCKED_TAG, stopHookScripts, holdReason, blockedEarlierThisTurn,
  stopPayload, blockReason, decideCardTurnEnd, blockedLines,
} = require("./card-turn-end.js");

const line = (o) => JSON.stringify(o);
const prompt = (text) => line({ type: "user", message: { role: "user", content: text } });
const widget = () => line({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__visualize__show_widget", input: { title: "completion_card_body", widget_code: "<h3 class=\"card-title\">T</h3>" } }] } });
const blockedNote = () => line({ type: "attachment", attachment: { type: "hook_additional_context", content: [`${BLOCKED_TAG} Card shown, but the turn cannot end yet`] } });

describe("stopHookScripts — the plugin's own Stop hooks, in hooks.json order", () => {
  test("every registered Stop hook resolves to an existing script", () => {
    const scripts = stopHookScripts(pluginRoot);
    expect(scripts.length).toBeGreaterThanOrEqual(5);
    for (const s of scripts) expect(fs.existsSync(s), s).toBe(true);
    const names = scripts.map((s) => path.basename(s));
    expect(names).toContain("stop.flow.guard.js");
    expect(names).toContain("stop.flow.browsertest.js");
    expect(names.indexOf("stop.flow.browsertest.js")).toBeLessThan(names.indexOf("stop.flow.guard.js"));
  });

  test("an unreadable plugin root yields no scripts", () => {
    expect(stopHookScripts(path.join(os.tmpdir(), "no-such-plugin-root-xyz"))).toEqual([]);
  });
});

describe("blockReason — what a Stop hook's process result says", () => {
  test("decision block, exit 2 and continue:false block; silence and plain text pass", () => {
    expect(blockReason({ status: 0, stdout: JSON.stringify({ decision: "block", reason: "Validation required" }) })).toBe("Validation required");
    expect(blockReason({ status: 2, stderr: "verify first\n", stdout: "" })).toBe("verify first");
    expect(blockReason({ status: 0, stdout: JSON.stringify({ continue: false, stopReason: "stop" }) })).toBe("stop");
    expect(blockReason({ status: 0, stdout: "" })).toBeNull();
    expect(blockReason({ status: 0, stdout: "Execute self-calibration: Read …" })).toBeNull();
    expect(blockReason({ status: 0, stdout: "{ not json" })).toBeNull();
  });
});

describe("blockedEarlierThisTurn — Claude Code's stop_hook_active, for our own retry", () => {
  test("a blocked hard stop after the turn's prompt counts; one from an earlier turn does not", () => {
    expect(blockedEarlierThisTurn([prompt("go"), widget(), blockedNote(), widget()].join("\n"))).toBe(true);
    expect(blockedEarlierThisTurn([blockedNote(), prompt("next"), widget()].join("\n"))).toBe(false);
    expect(blockedEarlierThisTurn("")).toBe(false);
  });
});

describe("stopPayload", () => {
  test("carries the session, transcript and cwd as a Stop event", () => {
    const p = stopPayload({ session_id: "s1", transcript_path: "t.jsonl", cwd: "C:/x", permission_mode: "default" }, true);
    expect(p).toMatchObject({ session_id: "s1", transcript_path: "t.jsonl", cwd: "C:/x", hook_event_name: "Stop", stop_hook_active: true, last_assistant_message: "" });
  });
});

describe("holdReason — orchestrators that work past their cards keep the turn", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-turn-end-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("nothing active → the turn may end", () => {
    expect(holdReason({ cwd: dir }, {})).toBe("");
  });

  test("the opt-out", () => {
    expect(holdReason({ cwd: dir }, { DOTCLAUDE_CARD_HARD_STOP: "0" })).toBe("disabled");
  });

  test("a fresh ship queue marker", () => {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", ".ship-queue"), JSON.stringify({ owner: "auto-cleanup", since: new Date().toISOString() }));
    expect(holdReason({ cwd: dir }, {})).toBe("ship-queue");
  });

  test("an active autonomous lockout", () => {
    fs.writeFileSync(path.join(dir, "AUTONOMOUS-LOCKOUT.flag"), JSON.stringify({ owner: "backlog-runner", since: new Date().toISOString() }));
    expect(holdReason({ cwd: dir }, {})).toBe("autonomous-lockout");
  });
});

describe("decideCardTurnEnd — run the Stop hooks, then end or hand over", () => {
  let dir;
  let root;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-turn-end-cwd-"));
    root = fs.mkdtempSync(path.join(os.tmpdir(), "card-turn-end-root-"));
    fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, "hooks", "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [
      { type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/stop.a.js" },
      { type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop/stop.b.js" },
    ] }] } }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const hook = () => ({ session_id: "s", cwd: dir, transcript_path: "" });

  test("every hook passes → end, and each ran once in order", () => {
    const ran = [];
    const d = decideCardTurnEnd(hook(), { pluginRoot: root, env: {}, run: (s) => { ran.push(path.basename(s)); return { status: 0, stdout: "" }; } });
    expect(d).toEqual({ end: true });
    expect(ran).toEqual(["stop.a.js", "stop.b.js"]);
  });

  test("a block stops the chain and names the hook", () => {
    const ran = [];
    const d = decideCardTurnEnd(hook(), {
      pluginRoot: root, env: {},
      run: (s) => { ran.push(path.basename(s)); return { status: 0, stdout: JSON.stringify({ decision: "block", reason: "Validation required" }) }; },
    });
    expect(d).toMatchObject({ end: false, reason: "Validation required", hook: "stop.a" });
    expect(ran).toEqual(["stop.a.js"]);
    const text = blockedLines(d).join("\n");
    expect(text).toContain(BLOCKED_TAG);
    expect(text).toContain("Validation required");
  });

  test("a hook that never started keeps the turn going", () => {
    const d = decideCardTurnEnd(hook(), { pluginRoot: root, env: {}, run: () => ({ status: null, error: new Error("ETIMEDOUT") }) });
    expect(d).toEqual({ end: false, hold: "spawn-failed" });
  });

  test("the chain budget ends the attempt, not the turn", () => {
    let t = 0;
    const d = decideCardTurnEnd(hook(), { pluginRoot: root, env: {}, now: () => (t += 30000), run: () => ({ status: 0, stdout: "" }) });
    expect(d).toEqual({ end: false, hold: "budget" });
  });

  test("the payload the hooks receive is a Stop event", () => {
    let payload = null;
    decideCardTurnEnd(hook(), { pluginRoot: root, env: {}, run: (_s, input) => { payload = JSON.parse(input); return { status: 0, stdout: "" }; } });
    expect(payload).toMatchObject({ hook_event_name: "Stop", session_id: "s", stop_hook_active: false });
  });

  test("the stop notice is short and says who ended the turn", () => {
    expect(STOP_REASON).toMatch(/devops/);
    expect(STOP_REASON.length).toBeLessThan(60);
  });
});
