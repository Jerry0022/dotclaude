import { describe, test, expect } from "vitest";
import { analyzeTranscript, resultText } from "./graphify-audit.js";

const line = (o) => JSON.stringify(o);
const use = (id, name, input) => line({ type: "assistant", cwd: "C:/p", message: { usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 20 }, content: [{ type: "tool_use", id, name, input }] } });
const res = (id, content) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });

const GATE_MSG = "PreToolUse:Grep hook error: ⛔  GRAPHIFY GATE — broad search blocked (graph available)\n" + "─".repeat(54);

describe("graphify-audit — analyzeTranscript", () => {
  test("counts a gate block, the PowerShell query that followed, and the retry bypass", () => {
    const lines = [
      use("t1", "Grep", { pattern: "site_routine|least" }),
      res("t1", GATE_MSG),
      use("t2", "PowerShell", { command: 'graphify query "where is site_routine granted?"' }),
      res("t2", "x".repeat(800)),
      use("t3", "Glob", { pattern: "**/.env.example" }),
      res("t3", GATE_MSG),
      use("t4", "Glob", { pattern: "**/.env.example" }),
      res("t4", ".env.example"),
      use("t5", "Read", { file_path: "C:/p/.env.example" }),
      res("t5", [{ type: "text", text: "y".repeat(400) }]),
      use("t6", "Grep", { pattern: "foo", path: "C:/p/src" }),
      res("t6", "src/a.js:1:foo"),
      "not json at all",
    ];
    const r = analyzeTranscript(lines);
    expect(r.cwd).toBe("C:/p");
    expect(r.gate).toBe(2);
    expect(r.bypass).toBe(1);          // t4 retried the exact blocked Glob
    expect(r.gq).toBe(1);
    expect(r.gqTok).toBe(200);         // 800 chars / 4
    expect(r.gqCmds[0]).toContain("graphify query");
    expect(r.grep).toBe(2);
    expect(r.glob).toBe(2);
    expect(r.broad).toBe(3);           // t1, t3, t4 had no path; t6 was scoped
    expect(r.read).toBe(1);
    expect(r.readTok).toBe(100);
    expect(r.turns).toBe(6);
    expect(r.out).toBe(120);
    expect(r.inNew).toBe(90);
    expect(r.cacheRead).toBe(6000);
    // Gate messages are excluded from the search-result cost, not double-counted.
    expect(r.searchTok).toBe(Math.round(".env.example".length / 4) + Math.round("src/a.js:1:foo".length / 4));
    const steps = r.trace.map((t) => t.step);
    expect(steps[0]).toBe("GATE");
    expect(r.trace.filter((t) => t.step === "GATE")).toHaveLength(2);
  });

  test("a shell command that only mentions graphify (update, --help) is not a query", () => {
    const r = analyzeTranscript([
      use("a", "Bash", { command: "graphify update ." }),
      res("a", "ok"),
      use("b", "Bash", { command: "graphify --version" }),
      res("b", "graphify 0.8.46"),
    ]);
    expect(r.gq).toBe(0);
    expect(r.graphifyOther).toBe(2);
  });

  test("resultText handles string, block-array, and missing content", () => {
    expect(resultText({ content: "abc" })).toBe("abc");
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] })).toBe("ab");
    expect(resultText({})).toBe("");
  });
});
