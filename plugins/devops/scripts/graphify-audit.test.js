import { describe, test, expect } from "vitest";
import { analyzeTranscript, resultText, aggregateMetricsBySession } from "./graphify-audit.js";

const line = (o) => JSON.stringify(o);
const use = (id, name, input) => line({ type: "assistant", cwd: "C:/p", message: { usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 20 }, content: [{ type: "tool_use", id, name, input }] } });
const res = (id, content, isError = false) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

const GATE_MSG = "PreToolUse:Grep hook error: ⛔  GRAPHIFY GATE — broad search blocked (graph available)\n" + "─".repeat(54);

describe("graphify-audit — analyzeTranscript", () => {
  test("counts a gate block, the PowerShell query that followed, and the retry bypass", () => {
    const lines = [
      use("t1", "Grep", { pattern: "site_routine|least" }),
      res("t1", GATE_MSG, true),
      use("t2", "PowerShell", { command: 'graphify query "where is site_routine granted?"' }),
      res("t2", "x".repeat(800)),
      use("t3", "Glob", { pattern: "**/.env.example" }),
      res("t3", GATE_MSG, true),
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

  // Requirement 9: only a genuine hook-block error result counts — text that
  // merely CONTAINS "GRAPHIFY GATE" (e.g. a grep of this very file's own
  // source, or a Read of pre.tokens.guard.js) must never false-positive.
  test("text containing GRAPHIFY GATE that is NOT an error tool_result is not counted as a gate", () => {
    const r = analyzeTranscript([
      use("t1", "Grep", { pattern: "GRAPHIFY GATE" }),
      res("t1", `plugins/devops/hooks/pre-tool-use/pre.tokens.guard.js:308:      console.error('\\n⛔  ${GATE_MSG}');`, false),
    ]);
    expect(r.gate).toBe(0);
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

describe("aggregateMetricsBySession — per-session telemetry rollup", () => {
  const ev = (event, sid, project, extra = {}) => ({ ts: "2026-09-20T00:00:00.000Z", event, sid, project, ...extra });

  test("groups events by sid, excludes 'nosid', sums fields per session", () => {
    const events = [
      ev("query_ran", "s1", "P", { responseChars: 100 }),
      ev("search_ran", "s1", "P", { responseChars: 50, eligible: true }),
      ev("search_ran", "s1", "P", { responseChars: 30, eligible: false }),
      ev("gate_fired", "s1", "P", { answerChars: 20 }),          // legacy event — ignored
      ev("guard_blocked", "s1", "P"),
      ev("guard_released", "s1", "P"),
      ev("map_injected", "s1", "P", { bytes: 1093 }),
      ev("query_ran", "nosid", "P", { responseChars: 999 }),      // excluded
      ev("query_ran", "s2", "Q", { responseChars: 10 }),
    ];
    const rows = aggregateMetricsBySession(events);
    expect(rows).toHaveLength(2);
    const s1 = rows.find((r) => r.sid === "s1");
    expect(s1).toMatchObject({
      project: "P", queries: 1, queryChars: 100, searches: 2, searchChars: 80,
      guardBlocks: 1, guardReleases: 1, mapInjections: 1,
    });
    expect(s1).not.toHaveProperty("gatesFired");
    const s2 = rows.find((r) => r.sid === "s2");
    expect(s2).toMatchObject({ project: "Q", queries: 1, queryChars: 10 });
  });

  test("sorted newest-first by each session's latest event timestamp", () => {
    const events = [
      { ...ev("query_ran", "old", "P", { responseChars: 1 }), ts: "2026-09-01T00:00:00.000Z" },
      { ...ev("query_ran", "new", "P", { responseChars: 1 }), ts: "2026-09-20T00:00:00.000Z" },
    ];
    const rows = aggregateMetricsBySession(events);
    expect(rows.map((r) => r.sid)).toEqual(["new", "old"]);
  });
});
