import { describe, test, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// The credit-first route for read-only side work: an agent loop of our own
// on the Messages API (a `claude` child from a desktop session is billed as
// Claude Code). It must stay inside its root, follow the tool-use protocol
// (all results in one user turn, pause_turn resent), respect the switch and
// the budget, and keep the claude-api-safe exit-code contract.

const require = createRequire(import.meta.url);
const agent = require("./claude-api-agent.js");
const safe = require("./claude-api-safe.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-api-agent-"));
const home = path.join(tmp, "home");
const proj = path.join(tmp, "proj");
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.mkdirSync(path.join(proj, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src", "a.js"), "const answer = 42;\nmodule.exports = answer;\n");
  fs.writeFileSync(path.join(proj, "node_modules", "x", "i.js"), "const answer = 0;\n");
  fs.writeFileSync(path.join(tmp, "secret.txt"), "outside");
});

function enable({ key = true } = {}) {
  fs.writeFileSync(path.join(home, ".claude", "devops-config.json"), JSON.stringify({ apiCredit: { enabled: true } }));
  if (key) fs.writeFileSync(path.join(home, ".claude", "devops-api.env"), "DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
}

// Scripted API: each call returns the next response; records request bodies.
function scripted(responses, calls = []) {
  return async (url, init) => {
    calls.push(JSON.parse(init.body));
    const r = responses.shift();
    return { ok: r.status ? r.status < 300 : true, status: r.status || 200, json: async () => r.body || r };
  };
}
async function runAgent(argv, extra = {}) {
  const out = [];
  const err = [];
  const rc = await agent.run(argv, { env: {}, home, cwd: proj, out: (s) => out.push(s), err: (s) => err.push(s), ...extra });
  return { rc, out: out.join(""), err: err.join("") };
}
const usage = { input_tokens: 100, output_tokens: 50 };

describe("gates", () => {
  test("switch off → 126, no request", async () => {
    const calls = [];
    const r = await runAgent(["task"], { fetchImpl: scripted([], calls) });
    expect(r.rc).toBe(safe.RC.DISABLED);
    expect(calls).toHaveLength(0);
  });
  test("no key → 127", async () => {
    enable({ key: false });
    expect((await runAgent(["task"])).rc).toBe(safe.RC.NO_KEY);
  });
});

describe("tool loop", () => {
  beforeEach(() => enable());

  test("runs grep + read_file, returns all results in one user turn, then the final answer", async () => {
    const calls = [];
    const fetchImpl = scripted([
      { content: [
        { type: "tool_use", id: "t1", name: "grep", input: { pattern: "answer" } },
        { type: "tool_use", id: "t2", name: "read_file", input: { path: "src/a.js" } },
      ], stop_reason: "tool_use", usage },
      { content: [{ type: "text", text: "It is 42 (src/a.js:1)." }], stop_reason: "end_turn", usage },
    ], calls);
    const r = await runAgent(["find the answer"], { fetchImpl });
    expect(r.rc).toBe(0);
    expect(r.out).toBe("It is 42 (src/a.js:1).\n");
    const results = calls[1].messages[2].content;
    expect(results.map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
    expect(results[0].content).toContain("src/a.js:1: const answer = 42;");
    expect(results[0].content).not.toContain("node_modules");
    expect(results[1].content).toContain("1\tconst answer = 42;");
    expect(calls[0].cache_control).toEqual({ type: "ephemeral" });
    expect(r.err).toMatch(/on API credit/);
  });

  test("a path outside the root is an error result, never read", async () => {
    const calls = [];
    const fetchImpl = scripted([
      { content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "../secret.txt" } }], stop_reason: "tool_use", usage },
      { content: [{ type: "text", text: "denied" }], stop_reason: "end_turn", usage },
    ], calls);
    await runAgent(["x"], { fetchImpl });
    const res = calls[1].messages[2].content[0];
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/outside the project root/);
    expect(res.content).not.toContain("outside\n");
  });

  test("secret-shaped files are never listed, read or searched", async () => {
    fs.writeFileSync(path.join(proj, ".env"), "API_KEY=answer-secret\n");
    fs.writeFileSync(path.join(proj, "devops-api.env"), "DEVOPS_ANTHROPIC_API_KEY=answer-secret\n");
    const calls = [];
    const fetchImpl = scripted([
      { content: [
        { type: "tool_use", id: "t1", name: "read_file", input: { path: ".env" } },
        { type: "tool_use", id: "t2", name: "grep", input: { pattern: "answer" } },
        { type: "tool_use", id: "t3", name: "list_files", input: { path: "." } },
      ], stop_reason: "tool_use", usage },
      { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage },
    ], calls);
    await runAgent(["x"], { fetchImpl });
    const [read, grep, list] = calls[1].messages[2].content;
    expect(read.is_error).toBe(true);
    expect(JSON.stringify(calls[1])).not.toContain("answer-secret");
    expect(grep.content).toContain("src/a.js:1");
    expect(list.content).not.toMatch(/\.env/);
  });

  test("tool-turn narration is never relayed as the answer: an early end returns rc != 0", async () => {
    const fetchImpl = scripted([
      { content: [{ type: "text", text: "I'll start by reading a.js" }, { type: "tool_use", id: "t1", name: "list_files", input: { path: "." } }], stop_reason: "tool_use", usage },
      { status: 500, body: { error: { message: "overloaded" } } },
    ]);
    const r = await runAgent(["x"], { fetchImpl });
    expect(r.rc).not.toBe(0);
    expect(r.out).toBe("");
  });

  test("one usage row per run: summed tokens over all turns, tag, turn count", async () => {
    const fetchImpl = scripted([
      { content: [{ type: "tool_use", id: "t1", name: "list_files", input: { path: "." } }], stop_reason: "tool_use", usage },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage },
    ]);
    await runAgent(["--tag", "audit", "x"], { fetchImpl });
    const rows = fs.readFileSync(path.join(home, ".claude", safe.USAGE_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: "agent", tag: "audit", project: "proj", in: 200, out: 100, turns: 2, rc: 0 });
  });

  test("max_tokens without text → rc 1", async () => {
    const fetchImpl = scripted([{ content: [{ type: "thinking", thinking: "…" }], stop_reason: "max_tokens", usage }]);
    expect((await runAgent(["x"], { fetchImpl })).rc).toBe(1);
  });

  test("pause_turn is resent without a tool result", async () => {
    const calls = [];
    const fetchImpl = scripted([
      { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } }], stop_reason: "pause_turn", usage },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage },
    ], calls);
    const r = await runAgent(["--web", "x"], { fetchImpl });
    expect(r.rc).toBe(0);
    expect(calls[1].messages.at(-1).role).toBe("assistant");
    expect(calls[0].tools.map((t) => t.name)).toEqual(["list_files", "read_file", "grep", "web_search", "web_fetch"]);
    expect(calls[0].tools[3].type).toBe("web_search_20260209");
  });

  test("Haiku gets the basic web tool variants", () => {
    expect(agent.webTools("claude-haiku-5-5")[0].type).toBe("web_search_20250305");
  });

  test("credit exhausted mid-run → 75 and the marker is stored", async () => {
    const fetchImpl = scripted([{ status: 400, body: { error: { message: "Your credit balance is too low to access the Anthropic API." } } }]);
    const r = await runAgent(["x"], { fetchImpl });
    expect(r.rc).toBe(safe.RC.LIMIT);
    expect(safe.activeLimit({ home })).not.toBeNull();
  });

  test("budget reached without an answer → rc 1 (caller falls back to the in-session agent)", async () => {
    const big = { input_tokens: 1_000_000, output_tokens: 0 };
    const fetchImpl = scripted([
      { content: [{ type: "tool_use", id: "t1", name: "list_files", input: { path: "." } }], stop_reason: "tool_use", usage: big },
    ]);
    const r = await runAgent(["--max-usd", "1", "x"], { fetchImpl });
    expect(r.rc).toBe(1);
    expect(r.err).toMatch(/budget/);
  });
});

test("costOf prices tokens and web searches", () => {
  const c = agent.costOf("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6, server_tool_use: { web_search_requests: 10 } });
  expect(c).toBeCloseTo(2 + 10 + 0.1, 5);
});

describe("secret-file guard (audit 2026-10-20)", () => {
  // `.env::$DATA` only aliases .env on NTFS; on POSIX it is a distinct, harmless name.
  test.each([...(process.platform === "win32" ? [".env::$DATA"] : []), ".env ", ".env.", "id_rsa_work", ".pypirc", ".git-credentials", "prod.tfvars"])(
    "read_file %s is refused",
    (name) => {
      expect(() => agent.runTool(proj, "read_file", { path: name })).toThrow(/off limits|unsupported path form/);
    },
  );

  test("a colon in a name is an NTFS stream only on Windows", () => {
    if (process.platform === "win32") {
      expect(() => agent.runTool(proj, "read_file", { path: "docs/12:00-notes.md" })).toThrow(/unsupported path form/);
      return;
    }
    fs.mkdirSync(path.join(proj, "docs"), { recursive: true });
    fs.writeFileSync(path.join(proj, "docs", "12:00-notes.md"), "noon\n");
    expect(() => agent.runTool(proj, "read_file", { path: "docs/12:00-notes.md" })).not.toThrow();
  });

  test("a symlink to a secret file is refused by its real name", () => {
    fs.writeFileSync(path.join(proj, ".env"), "K=answer-secret\n");
    try { fs.symlinkSync(path.join(proj, ".env"), path.join(proj, "innocent.txt")); } catch { return; /* no symlink right */ }
    expect(() => agent.runTool(proj, "read_file", { path: "innocent.txt" })).toThrow(/off limits/);
  });

  test("ordinary paths and the root itself still work", () => {
    expect(agent.runTool(proj, "list_files", { path: "." })).toContain("src/");
    expect(agent.runTool(proj, "read_file", { path: "src/a.js" })).toContain("answer");
  });
});
