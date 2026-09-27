import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const relay = require("./agent-card-relay.js");
const PRE_HOOK = path.join(__dirname, "..", "pre-tool-use", "pre.agent.relay.js");
const STOP_HOOK = path.join(__dirname, "..", "stop", "stop.agent.relay.js");

const dirs = [];
const sessions = [];
afterAll(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp cleanup */ } }
  for (const s of sessions) { try { fs.rmSync(path.join(os.tmpdir(), `dotclaude-devops-agent-card-nag-${s}`)); } catch { /* never written */ } }
});

let seq = 0;
function sessionId() {
  const id = `relay-test-${process.pid}-${++seq}`;
  sessions.push(id);
  return id;
}

const card = (n, lang = "de") => {
  const head = lang === "de" ? `${n} ${n === 1 ? "Agent" : "Agents"} gestartet` : `${n} ${n === 1 ? "agent" : "agents"} started`;
  return `---\n### 🤖 **${head}** · Hintergrund\n\n|  | Agent | Aufgabe | Modell | Effort |\n|---|---|---|---|---|\n| 🧪 | **qa** | Run tests | sonnet | ●● medium |\n---`;
};
const announce = (c) => `Agent card — show the user this card verbatim in the next text you write:\n${c}`;

const prompt = (text = "do it") => ({ type: "user", message: { role: "user", content: text } });
const agentUse = (msgId, id) => ({ type: "assistant", message: { id: msgId, role: "assistant", content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: "devops:qa" } }] } });
const toolUse = (msgId, id, name = "Bash") => ({ type: "assistant", message: { id: msgId, role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] } });
const text = (msgId, t) => ({ type: "assistant", message: { id: msgId, role: "assistant", content: [{ type: "text", text: t }] } });
const hookCtx = (toolUseID, c) => ({ type: "attachment", attachment: { type: "hook_additional_context", hookName: "PreToolUse:Agent", toolUseID, content: [announce(c)] } });
const result = (id) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
const jsonl = (...entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("agent-card-relay lib", () => {
  test("cardHeader reads the bold header phrase", () => {
    expect(relay.cardHeader(card(3))).toBe("3 Agents gestartet");
    expect(relay.cardHeader(card(1, "en"))).toBe("1 agent started");
    expect(relay.cardHeader("no card")).toBe(null);
  });

  test("cardFromContext keeps the fenced card, ignores other contexts", () => {
    expect(relay.cardFromContext(announce(card(1)))).toBe(card(1));
    expect(relay.cardFromContext("SHIP: 5 code edits")).toBe(null);
  });

  test("an unshown card is reported, the last card of a parallel launch wins", () => {
    const t = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), agentUse("m1", "a2"), hookCtx("a2", card(2)),
      result("a1"), result("a2"), text("m2", "Linsen laufen noch; prüfe parallel die Bugs."), toolUse("m2", "b1"));
    const open = relay.unrelayedLaunches(t);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ msgId: "m1", ids: ["a1", "a2"], lastId: "a2", header: "2 Agents gestartet" });
  });

  test("a card shown in a later text counts as relayed", () => {
    const t = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), text("m2", card(1)), toolUse("m2", "b1"));
    expect(relay.unrelayedLaunches(t)).toEqual([]);
  });

  test("a card shown inside a show_widget call counts as relayed", () => {
    const widget = { type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "tool_use", id: "w", name: "mcp__visualize__show_widget", input: { widget_code: "<b>1 Agent gestartet</b>" } }] } };
    const t = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), widget);
    expect(relay.unrelayedLaunches(t)).toEqual([]);
  });

  test("launches of an earlier turn are out of scope", () => {
    const t = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), prompt("next"), toolUse("m3", "b1"));
    expect(relay.unrelayedLaunches(t)).toEqual([]);
  });

  test("a spawn without a hook card (refused, other plugin off) is ignored", () => {
    const t = jsonl(prompt(), agentUse("m1", "a1"), result("a1"), toolUse("m2", "b1"));
    expect(relay.unrelayedLaunches(t)).toEqual([]);
  });

  test("launchToNudge skips the gated call's own message and launches nudged once", () => {
    const sid = sessionId();
    const t = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), toolUse("m1", "b0"));
    expect(relay.launchToNudge(t, sid, { skipMsgId: "m1" })).toBe(null);
    const l = relay.launchToNudge(t, sid, { skipMsgId: "m2" });
    expect(l && l.lastId).toBe("a1");
    relay.markNagged(sid, l.covers);
    expect(relay.launchToNudge(t, sid, { skipMsgId: "m2" })).toBe(null);
  });

  test("one nudge settles every open launch of the turn, showing the newest card", () => {
    const sid = sessionId();
    const t = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), text("m2", "läuft"),
      agentUse("m3", "a2"), hookCtx("a2", card(1, "en")), result("a2"), toolUse("m4", "b1"));
    const l = relay.launchToNudge(t, sid, { skipMsgId: "m4" });
    expect(l.header).toBe("1 agent started");
    expect(l.covers).toEqual(["a1", "a2"]);
    relay.markNagged(sid, l.covers);
    expect(relay.launchToNudge(t, sid, { skipMsgId: "m4" })).toBe(null);
  });

  test("messageIdOf finds a tool_use's message in the turn", () => {
    const t = jsonl(prompt(), agentUse("m1", "a1"), toolUse("m2", "b1"));
    expect(relay.messageIdOf(t, "b1")).toBe("m2");
    expect(relay.messageIdOf(t, "zz")).toBe(null);
  });
});

// Async spawn, never spawnSync: a sync child blocks the vitest worker's event loop.
function runHook(file, payload) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(__dirname, "..", "..") } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function project(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(file, content);
  return { dir, file };
}

describe("pre.agent.relay hook", () => {
  const unshown = jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), text("m2", "Linsen laufen noch."), toolUse("m2", "b1"));

  test("holds back the next tool call once, then lets the retry through", async () => {
    const { dir, file } = project(unshown);
    const sid = sessionId();
    const payload = { session_id: sid, cwd: dir, transcript_path: file, tool_name: "Bash", tool_use_id: "b1", tool_input: {} };
    const first = await runHook(PRE_HOOK, payload);
    expect(first.code).toBe(2);
    expect(first.stderr).toContain("[agent-card-relay]");
    expect(first.stderr).toContain("1 Agent gestartet");
    const retry = await runHook(PRE_HOOK, payload);
    expect(retry.code).toBe(0);
    expect(retry.stderr).toBe("");
  }, 20000);

  test("a parallel sibling in the spawn's own message passes", async () => {
    const { dir, file } = project(jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), toolUse("m1", "b1")));
    const r = await runHook(PRE_HOOK, { session_id: sessionId(), cwd: dir, transcript_path: file, tool_name: "Bash", tool_use_id: "b1", tool_input: {} });
    expect(r.code).toBe(0);
  }, 20000);

  test("show_widget and subagent calls pass", async () => {
    const { dir, file } = project(unshown);
    const w = await runHook(PRE_HOOK, { session_id: sessionId(), cwd: dir, transcript_path: file, tool_name: "mcp__visualize__show_widget", tool_use_id: "b1" });
    expect(w.code).toBe(0);
    const s = await runHook(PRE_HOOK, { session_id: sessionId(), cwd: dir, transcript_path: file, tool_name: "Bash", tool_use_id: "b1", agent_id: "x" });
    expect(s.code).toBe(0);
  }, 20000);

  test("passes once the card was shown", async () => {
    const { dir, file } = project(jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), text("m2", card(1)), toolUse("m2", "b1")));
    const r = await runHook(PRE_HOOK, { session_id: sessionId(), cwd: dir, transcript_path: file, tool_name: "Bash", tool_use_id: "b1" });
    expect(r.code).toBe(0);
  }, 20000);
});

describe("stop.agent.relay hook", () => {
  test("blocks the turn end once for an unshown card", async () => {
    const { dir, file } = project(jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(2, "en")), result("a1")));
    const sid = sessionId();
    const first = await runHook(STOP_HOOK, { session_id: sid, cwd: dir, transcript_path: file, stop_hook_active: false });
    expect(first.code).toBe(2);
    expect(first.stderr).toContain("2 agents started");
    const again = await runHook(STOP_HOOK, { session_id: sid, cwd: dir, transcript_path: file, stop_hook_active: false });
    expect(again.code).toBe(0);
  }, 20000);

  test("never blocks on stop_hook_active or after the completion card", async () => {
    const { dir, file } = project(jsonl(prompt(), agentUse("m1", "a1"), hookCtx("a1", card(1)), result("a1"), text("m2", "### **✨✨✨ Done ✨✨✨**")));
    const loop = await runHook(STOP_HOOK, { session_id: sessionId(), cwd: dir, transcript_path: file, stop_hook_active: true });
    expect(loop.code).toBe(0);
    const carded = await runHook(STOP_HOOK, { session_id: sessionId(), cwd: dir, transcript_path: file, stop_hook_active: false });
    expect(carded.code).toBe(0);
  }, 20000);
});
