import { describe, test, expect } from "vitest";
import { analyzeTranscript, resultText, aggregateMetricsBySession, estimateSavings, median } from "./graphify-audit.js";

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

describe("median", () => {
  test("empty array is 0", () => expect(median([])).toBe(0));
  test("odd length picks the middle", () => expect(median([3, 1, 2])).toBe(2));
  test("even length averages the two middle values", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe("aggregateMetricsBySession — per-session telemetry rollup", () => {
  const ev = (event, sid, project, extra = {}) => ({ ts: "2026-09-20T00:00:00.000Z", event, sid, project, ...extra });

  test("groups events by sid, excludes 'nosid', sums fields per session", () => {
    const events = [
      ev("query_ran", "s1", "P", { responseChars: 100 }),
      ev("search_ran", "s1", "P", { responseChars: 50, eligible: true }),
      ev("search_ran", "s1", "P", { responseChars: 30, eligible: false }),
      ev("gate_fired", "s1", "P", { answerChars: 20 }),
      ev("gate_bypassed", "s1", "P"),
      ev("gate_noanswer", "s1", "P"),
      ev("gate_relented", "s1", "P"),
      ev("guard_blocked", "s1", "P"),
      ev("guard_released", "s1", "P"),
      ev("query_ran", "nosid", "P", { responseChars: 999 }),      // excluded
      ev("query_ran", "s2", "Q", { responseChars: 10 }),
    ];
    const rows = aggregateMetricsBySession(events);
    expect(rows).toHaveLength(2);
    const s1 = rows.find((r) => r.sid === "s1");
    expect(s1).toMatchObject({
      project: "P", queries: 1, queryChars: 100, searches: 2, searchChars: 80,
      gatesFired: 1, gatesBypassed: 1, gatesNoAnswer: 1, gatesRelented: 1,
      guardBlocks: 1, guardReleases: 1,
    });
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

describe("estimateSavings — ESTIMATED gate savings (Requirement C)", () => {
  const ev = (event, sid, project, extra = {}) => ({ event, sid, project, ...extra });

  test("per-project median baseline minus answerChars, only for not-bypassed gates", () => {
    const events = [
      // Project P: 3 eligible searches (median 1000), 2 gates fired, 1 bypassed → 1 counted.
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 900 }),
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1000 }),
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1100 }),
      ev("gate_fired", "s1", "P", { answerChars: 200 }),
      ev("gate_fired", "s1", "P", { answerChars: 200 }),
      ev("gate_bypassed", "s1", "P"),
    ];
    const est = estimateSavings(events);
    // notBypassed = max(0, 2-1) = 1; baseline = median([900,1000,1100]) = 1000;
    // avgAnswerChars = 200; saved = 1 * (1000-200) = 800 chars → 200 tok.
    expect(est.gatesCounted).toBe(1);
    expect(est.savedChars).toBe(800);
    expect(est.savedTokens).toBe(200);
  });

  test("falls back to the global median when the project ran no eligible search of its own", () => {
    const events = [
      ev("search_ran", "s1", "OTHER", { eligible: true, responseChars: 2000 }),
      ev("gate_fired", "s2", "LONELY", { answerChars: 300 }),
    ];
    const est = estimateSavings(events);
    expect(est.globalMedian).toBe(2000);
    expect(est.gatesCounted).toBe(1);
    expect(est.savedChars).toBe(2000 - 300);
  });

  test("gates fully offset by bypasses in the same project count nothing", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 500 }),
      ev("gate_fired", "s1", "P", { answerChars: 50 }),
      ev("gate_bypassed", "s1", "P"),
    ];
    const est = estimateSavings(events);
    expect(est.gatesCounted).toBe(0);
    expect(est.savedChars).toBe(0);
  });

  test("sid 'nosid' is excluded from every input to the estimate", () => {
    const events = [
      ev("search_ran", "nosid", "P", { eligible: true, responseChars: 5000 }),
      ev("gate_fired", "nosid", "P", { answerChars: 1 }),
    ];
    const est = estimateSavings(events);
    expect(est.gatesCounted).toBe(0);
    expect(est.globalMedian).toBe(0);
  });

  test("a baseline below the answer cost never produces a negative saving", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 100 }),
      ev("gate_fired", "s1", "P", { answerChars: 900 }), // answer bigger than the baseline
    ];
    const est = estimateSavings(events);
    expect(est.savedChars).toBe(0);
    expect(est.gatesCounted).toBe(1);
  });
});
