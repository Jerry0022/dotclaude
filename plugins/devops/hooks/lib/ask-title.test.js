import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ask-title — a question asked mid-turn left ⏳ on the title while the
 * session waited for the user (2026-10-25). The pre hook refuses the
 * question once until the title says Question; the post hook restores ⏳.
 */

const require = createRequire(import.meta.url);
const ask = require("./ask-title.js");
const PRE = fileURLToPath(new URL("../pre-tool-use/pre.ask.title.js", import.meta.url));
const POST = fileURLToPath(new URL("../post-tool-use/post.ask.title.js", import.meta.url));

const SOLO = "⏳ ➜ 🤖 Solo ┃ ";
const SHIP = "⏳ ➜ 🚀 Shipping ┃ ";
const Q = "👉 ➜ ❓ Question ┃ ";
const SET = "mcp__ccd_session_mgmt__set_session_title";

const title = (t) => JSON.stringify({ type: "custom-title", customTitle: t, sessionId: "s" });
const prompt = (text) => JSON.stringify({ type: "user", message: { content: text } });
const toolUse = (name, input, id) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id, text) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } });

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-title-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
});
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function run(hookFile, lines, extra = {}) {
  const transcript = path.join(dir, "t.jsonl");
  fs.writeFileSync(transcript, lines.join("\n") + "\n");
  const payload = { tool_name: "AskUserQuestion", tool_use_id: "q1", transcript_path: transcript, session_id: "s", cwd: dir, ...extra };
  return spawnSync(process.execPath, [hookFile], { cwd: dir, input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, HOME: dir, USERPROFILE: dir } });
}

describe("questionTitle / restoredTitle", () => {
  test("⏳ Solo → Question, keeps the topic", () => {
    expect(ask.questionTitle(SOLO + "Fix X")).toBe(Q + "Fix X");
  });
  test("already a question, a batch, or unknown → leave it", () => {
    expect(ask.questionTitle(Q + "Fix X")).toBeNull();
    expect(ask.questionTitle("👉 ➜ 📚 Batch ┃ Fix X")).toBeNull();
    expect(ask.questionTitle(null)).toBeNull();
  });
  test("restore keeps a running ship's head, else Solo", () => {
    expect(ask.restoredTitle(Q + "Fix X", SHIP + "Fix X")).toBe(SHIP + "Fix X");
    expect(ask.restoredTitle(Q + "Fix X", SOLO + "Fix X")).toBe(SOLO + "Fix X");
    expect(ask.restoredTitle(Q + "Fix X", "👉 ➜ 📦 Ready ┃ Fix X")).toBe(SOLO + "Fix X");
    expect(ask.restoredTitle(SOLO + "Fix X", null)).toBeNull();
  });
});

describe("pre.ask.title", () => {
  test("⏳ title, no set call → refused with the exact set call", () => {
    const r = run(PRE, [prompt("go"), title(SOLO + "Fix X"), toolUse("AskUserQuestion", {}, "q1")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(ask.MARKER);
    expect(r.stderr).toContain(JSON.stringify(Q + "Fix X"));
  });
  test("set call to the question title in the same message → passes", () => {
    const r = run(PRE, [prompt("go"), title(SOLO + "Fix X"), toolUse(SET, { session_id: "self", title: Q + "Fix X" }, "t1"), toolUse("AskUserQuestion", {}, "q1")]);
    expect(r.status).toBe(0);
  });
  test("refused once this turn → the repeat passes (no loop)", () => {
    const r = run(PRE, [prompt("go"), title(SOLO + "Fix X"), toolUse("AskUserQuestion", {}, "q0"), result("q0", ask.refusalText(Q + "Fix X")), toolUse("AskUserQuestion", {}, "q1")]);
    expect(r.status).toBe(0);
  });
  test("a refusal from an earlier turn does not count", () => {
    const r = run(PRE, [prompt("a"), title(SOLO + "Fix X"), result("q0", ask.refusalText(Q + "Fix X")), prompt("b"), toolUse("AskUserQuestion", {}, "q1")]);
    expect(r.status).toBe(2);
  });
  test("a set call before an earlier question does not cover the next one", () => {
    const r = run(PRE, [prompt("go"), title(SOLO + "Fix X"), toolUse(SET, { title: Q + "Fix X" }, "t1"), toolUse("AskUserQuestion", {}, "q0"), toolUse("AskUserQuestion", {}, "q1")]);
    expect(r.status).toBe(2);
  });
  test("unknown title (no Desktop app) → silent", () => {
    const r = run(PRE, [prompt("go"), toolUse("AskUserQuestion", {}, "q1")]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
  test("inside a subagent → silent", () => {
    const r = run(PRE, [prompt("go"), title(SOLO + "Fix X")], { agent_id: "a1" });
    expect(r.status).toBe(0);
  });
});

describe("post.ask.title", () => {
  test("answered → restore the ⏳ head the title had before", () => {
    const r = run(POST, [prompt("go"), title(SHIP + "Fix X"), title(Q + "Fix X")]);
    expect(r.status).toBe(0);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain(JSON.stringify(SHIP + "Fix X"));
  });
  test("title not on Question → silent", () => {
    const r = run(POST, [prompt("go"), title(SOLO + "Fix X")]);
    expect(r.stdout).toBe("");
  });
});
