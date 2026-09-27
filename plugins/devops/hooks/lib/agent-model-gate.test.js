import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gate = require("./agent-model-gate.js");
const HOOK = path.join(__dirname, "..", "pre-tool-use", "pre.agent.model.js");

const dirs = [];
afterAll(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp cleanup */ } }
});

const prompt = (text = "go") => ({ type: "user", message: { role: "user", content: text } });
const spawnUse = (id, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Agent", input }] } });
const refusal = (id) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: `${gate.MARKER} would inherit` }] } });
const jsonl = (...e) => e.map((x) => JSON.stringify(x)).join("\n") + "\n";

const explore = { subagent_type: "Explore", description: "Sweep hooks", prompt: "x" };

describe("agent-model-gate", () => {
  test("an inheriting spawn without a model is refused", () => {
    expect(gate.wouldRefuse(explore, null, jsonl(prompt()), "t1")).toBe(true);
  });

  test("a named model or an own frontmatter model passes", () => {
    expect(gate.wouldRefuse({ ...explore, model: "opus" }, null, jsonl(prompt()), "t1")).toBe(false);
    expect(gate.wouldRefuse({ subagent_type: "devops:qa" }, "sonnet", jsonl(prompt()), "t1")).toBe(false);
  });

  test("model: inherit in the frontmatter counts as inheriting", () => {
    expect(gate.wouldRefuse({ subagent_type: "devops:feature" }, "inherit", jsonl(prompt()), "t1")).toBe(true);
  });

  test("the identical retry after a refusal goes through, a different spawn does not", () => {
    const t = jsonl(prompt(), spawnUse("t0", explore), refusal("t0"), spawnUse("t1", explore));
    expect(gate.wouldRefuse(explore, null, t, "t1")).toBe(false);
    expect(gate.wouldRefuse({ ...explore, description: "Other sweep" }, null, t, "t2")).toBe(true);
  });

  test("a refusal of an earlier turn does not carry over", () => {
    const t = jsonl(prompt(), spawnUse("t0", explore), refusal("t0"), prompt("next"), spawnUse("t1", explore));
    expect(gate.wouldRefuse(explore, null, t, "t1")).toBe(true);
  });

  test("no transcript fails open", () => {
    expect(gate.wouldRefuse(explore, null, "", "t1")).toBe(false);
  });

  test("the reason points locating work to devops:scout", () => {
    expect(gate.refusalText(explore)).toContain("devops:scout");
    expect(gate.refusalText({ subagent_type: "devops:feature" })).not.toContain("devops:scout");
  });
});

function runHook(payload, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(__dirname, "..", "..") } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function project(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-model-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(file, content);
  return { dir, file };
}

describe("pre.agent.model hook", () => {
  test("refuses a first Explore spawn without a model, passes a devops agent", async () => {
    const { dir, file } = project(jsonl(prompt(), spawnUse("t1", explore)));
    const r = await runHook({ tool_name: "Agent", tool_input: explore, tool_use_id: "t1", cwd: dir, transcript_path: file }, dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(gate.MARKER);
    const qa = { subagent_type: "devops:qa", description: "Run tests", prompt: "x" };
    const ok = await runHook({ tool_name: "Agent", tool_input: qa, tool_use_id: "t1", cwd: dir, transcript_path: file }, dir);
    expect(ok.code).toBe(0);
  }, 20000);

  test("silent inside a subagent", async () => {
    const { dir, file } = project(jsonl(prompt(), spawnUse("t1", explore)));
    const r = await runHook({ tool_name: "Agent", tool_input: explore, tool_use_id: "t1", cwd: dir, transcript_path: file, agent_id: "a" }, dir);
    expect(r.code).toBe(0);
  }, 20000);
});
