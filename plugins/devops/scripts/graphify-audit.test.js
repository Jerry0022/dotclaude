import { describe, test, expect } from "vitest";
import { analyzeTranscript, resultText, aggregateMetricsBySession, estimateSavings, gateLatencyStats, median } from "./graphify-audit.js";

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
      ev("map_injected", "s1", "P", { bytes: 1093 }),
      ev("query_ran", "nosid", "P", { responseChars: 999 }),      // excluded
      ev("query_ran", "s2", "Q", { responseChars: 10 }),
    ];
    const rows = aggregateMetricsBySession(events);
    expect(rows).toHaveLength(2);
    const s1 = rows.find((r) => r.sid === "s1");
    expect(s1).toMatchObject({
      project: "P", queries: 1, queryChars: 100, searches: 2, searchChars: 80,
      gatesFired: 1, gatesBypassed: 1, gatesNoAnswer: 1, gatesRelented: 1,
      guardBlocks: 1, guardReleases: 1, mapInjections: 1,
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

describe("estimateSavings — NET gate estimate (Requirement 9)", () => {
  const ev = (event, sid, project, extra = {}) => ({ event, sid, project, ...extra });

  test("keyHash directly links a bypass to its block — accepted gates are the outputMode-matched median minus answerChars", () => {
    const events = [
      // Project P, mode 'content': 3 eligible searches (median 1000).
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 900, outputMode: "content" }),
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1000, outputMode: "content" }),
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1100, outputMode: "content" }),
      // One gate fired and accepted (never bypassed).
      ev("gate_fired", "s1", "P", { answerChars: 200, outputMode: "content", keyHash: "aaa" }),
    ];
    const est = estimateSavings(events);
    expect(est.acceptedCount).toBe(1);
    expect(est.bypassedCount).toBe(0);
    // baseline = median([900,1000,1100]) = 1000; net = 1000 - 200 = 800 chars → 200 tok.
    expect(est.netChars).toBe(800);
    expect(est.netTokens).toBe(200);
  });

  test("a bypassed gate (matching keyHash) is a NET LOSS: -(answerChars + baseline)", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1000, outputMode: "content" }),
      ev("gate_fired", "s1", "P", { answerChars: 200, outputMode: "content", keyHash: "bbb" }),
      ev("gate_bypassed", "s1", "P", { outputMode: "content", keyHash: "bbb" }),
    ];
    const est = estimateSavings(events);
    expect(est.bypassedCount).toBe(1);
    expect(est.acceptedCount).toBe(0);
    expect(est.netChars).toBe(-(200 + 1000));
  });

  test("an accepted gate whose answer is BIGGER than the baseline is a real (unclamped) loss", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 100, outputMode: "content" }),
      ev("gate_fired", "s1", "P", { answerChars: 900, outputMode: "content", keyHash: "ccc" }),
    ];
    const est = estimateSavings(events);
    expect(est.acceptedCount).toBe(1);
    expect(est.netChars).toBe(100 - 900); // negative, NOT clamped to 0
  });

  test("baseline is split by outputMode: a content gate never uses a files_with_matches baseline", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 100, outputMode: "files_with_matches" }),
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 5000, outputMode: "content" }),
      ev("gate_fired", "s1", "P", { answerChars: 400, outputMode: "content", keyHash: "ddd" }),
    ];
    const est = estimateSavings(events);
    expect(est.netChars).toBe(5000 - 400); // used the content baseline, not files_with_matches
  });

  test("falls back to the mode-global median, then the overall global median, when the project has no matching-mode eligible search", () => {
    const events = [
      ev("search_ran", "s1", "OTHER", { eligible: true, responseChars: 2000, outputMode: "content" }),
      ev("gate_fired", "s2", "LONELY", { answerChars: 300, outputMode: "content", keyHash: "eee" }),
    ];
    const est = estimateSavings(events);
    expect(est.globalMedian).toBe(2000);
    expect(est.netChars).toBe(2000 - 300);
  });

  test("sid 'nosid' is excluded from every input to the estimate", () => {
    const events = [
      ev("search_ran", "nosid", "P", { eligible: true, responseChars: 5000 }),
      ev("gate_fired", "nosid", "P", { answerChars: 1, keyHash: "fff" }),
    ];
    const est = estimateSavings(events);
    expect(est.acceptedCount).toBe(0);
    expect(est.bypassedCount).toBe(0);
    expect(est.globalMedian).toBe(0);
  });

  // R9: legacy gate_fired events (missing keyHash and/or a numeric
  // answerChars — recorded by a hook version older than this rewrite) are
  // EXCLUDED from the NET estimate entirely, not folded in via a guess.
  test("legacy gate_fired events (no keyHash) are excluded from NET, counted separately", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1000, outputMode: "" }),
      ev("gate_fired", "s1", "P", { answerChars: 200 }), // no keyHash — legacy
      ev("gate_fired", "s1", "P", { answerChars: 200, keyHash: "real1" }), // a real, estimable one
    ];
    const est = estimateSavings(events);
    expect(est.legacyCount).toBe(1);
    expect(est.acceptedCount).toBe(1); // only the keyHash'd one counted
    expect(est.bypassedCount).toBe(0);
    expect(est.netChars).toBe(1000 - 200); // legacy event contributes nothing
  });

  test("legacy gate_fired events (answerChars not a number) are also excluded and counted as legacy", () => {
    const events = [
      ev("gate_fired", "s1", "P", { keyHash: "no-answer-chars" }), // answerChars missing entirely
    ];
    const est = estimateSavings(events);
    expect(est.legacyCount).toBe(1);
    expect(est.acceptedCount).toBe(0);
    expect(est.netChars).toBe(0);
  });

  // R9: pairing is by (sid, keyHash), NOT keyHash alone — two DIFFERENT
  // sessions running the identical search on the same project must not
  // cross-pair (a bypass in session 2 must never cancel out a block in
  // session 1 that session 2 never even saw).
  test("pairing is scoped to (sid, keyHash) — a same-keyHash bypass in a DIFFERENT session does not pair", () => {
    const events = [
      ev("search_ran", "s1", "P", { eligible: true, responseChars: 1000, outputMode: "content" }),
      ev("gate_fired", "s1", "P", { answerChars: 200, outputMode: "content", keyHash: "shared" }),
      ev("gate_bypassed", "s2", "P", { outputMode: "content", keyHash: "shared" }), // different session!
    ];
    const est = estimateSavings(events);
    // The fired gate in s1 is NEVER bypassed (from s1's point of view) — it
    // must be counted as accepted, not swallowed by s2's unrelated bypass.
    expect(est.acceptedCount).toBe(1);
    expect(est.bypassedCount).toBe(0);
    expect(est.netChars).toBe(1000 - 200);
  });
});

describe("gateLatencyStats — R9 gate latency cost line", () => {
  const ev = (event, sid, project, extra = {}) => ({ event, sid, project, ...extra });

  test("sums and finds the median of ms across gate_fired and gate_noanswer", () => {
    const events = [
      ev("gate_fired", "s1", "P", { ms: 100 }),
      ev("gate_noanswer", "s1", "P", { ms: 300 }),
      ev("gate_fired", "s1", "P", { ms: 200 }),
    ];
    const stats = gateLatencyStats(events);
    expect(stats.count).toBe(3);
    expect(stats.sumMs).toBe(600);
    expect(stats.medianMs).toBe(200);
  });

  test("excludes sid 'nosid' and events without a numeric ms", () => {
    const events = [
      ev("gate_fired", "nosid", "P", { ms: 999 }),
      ev("gate_fired", "s1", "P", {}), // no ms — an older hook version
      ev("gate_bypassed", "s1", "P", { ms: 50 }), // wrong event type
    ];
    const stats = gateLatencyStats(events);
    expect(stats.count).toBe(0);
    expect(stats.sumMs).toBe(0);
  });

  test("empty input never throws", () => {
    expect(gateLatencyStats([])).toEqual({ count: 0, sumMs: 0, medianMs: 0 });
  });
});
