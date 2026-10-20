import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// Weekly rule-adherence grader: digest + deterministic guard counts need no
// API; the Haiku layer runs only on the API credit (mocked here — no network)
// and the run still writes a deterministic-only report without it.

const require = createRequire(import.meta.url);
const g = require("./session-grader.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-grader-"));
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });

const NOW = Date.parse("2026-10-20T12:00:00Z");
const WT = "C:\\repo\\.claude\\worktrees\\x";

const user = (content, extra = {}) => ({ type: "user", cwd: WT, message: { role: "user", content }, ...extra });
const asst = (content) => ({ type: "assistant", cwd: WT, message: { id: Math.random().toString(36), content } });
const toolUse = (name, input) => asst([{ type: "tool_use", id: "t" + Math.random(), name, input }]);
const toolErr = (text) => user([{ type: "tool_result", tool_use_id: "x", is_error: true, content: text }]);
const stopBlock = (text) => ({ type: "attachment", attachment: { type: "hook_blocking_error", hookName: "Stop", blockingError: { blockingError: text } } });

function sampleLines() {
  return [
    user("Bitte fix den Bug"),
    asst([{ type: "text", text: "Ich schaue mir das an." }]),
    toolUse("Bash", { command: "git stash push -m wip" }),
    toolUse("Bash", { command: "git stash list" }),
    toolUse("Agent", { subagent_type: "general-purpose", description: "look" }),
    toolErr("PreToolUse:Agent hook error: [node /p/hooks/pre-tool-use/pre.agent.model.js]: [agent-model] `general-purpose` has no model of its own"),
    toolErr("PreToolUse:Bash hook error: [node /p/pre.agent.relay.js]: [agent-card-relay] The agent card of your last launch never reached the user."),
    toolUse("Bash", { command: "ls" }),
    toolErr("PreToolUse:Bash hook error: [node /p/pre.agent.relay.js]: [agent-card-relay] The agent card of your last launch never reached the user."),
    stopBlock("[stop.flow.guard] Completion card required — not yet rendered this turn.\n\nCall it now."),
    // the same Stop block also lands as a user string — must not double-count
    user("Stop hook feedback:\n[stop.flow.guard] Completion card required — not yet rendered this turn.\n\nCall it now."),
    toolErr("[card-pregate] Not rendered — this card would be blocked by stop.flow.guard after the turn."),
    user("<task-notification><summary>done</summary></task-notification>"),
    user("Base directory for this skill: /x", { isMeta: true }),
    { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "SIDECHAIN" }] } },
  ];
}

function digestOf(lines, opts) {
  const d = g.createDigester(g.DEFAULT_RULES, opts);
  for (const l of lines) d.add(l);
  return d.finish();
}

describe("digest builder", () => {
  test("keeps prompts, assistant text, tool names + short args; drops sidechain and skill injections", () => {
    const { digest, prompts } = digestOf(sampleLines());
    expect(prompts).toBe(1);
    expect(digest).toContain("U: Bitte fix den Bug");
    expect(digest).toContain("A: Ich schaue mir das an.");
    expect(digest).toContain("T: Bash git stash push -m wip");
    expect(digest).toContain("T: Agent type=general-purpose model=(none) look");
    expect(digest).toContain("N: ");
    expect(digest).not.toContain("SIDECHAIN");
    expect(digest).not.toContain("Base directory");
    expect(digest).toMatch(/!GUARD\(agent-model-named\) tool-error: \[agent-model\]/);
  });

  test("hard-caps the digest size", () => {
    const lines = [];
    for (let i = 0; i < 400; i++) { lines.push(user(`prompt ${i} ` + "x".repeat(500))); lines.push(asst([{ type: "text", text: "y".repeat(500) }])); }
    const { digest } = digestOf(lines, { cap: 30000 });
    expect(digest.length).toBeLessThanOrEqual(30000);
    expect(digest).toContain("chars omitted");
    expect(digest).toContain("prompt 399");
  });
});

describe("deterministic signal counter", () => {
  test("counts guard refusals per rule, dedupes the Stop block echo, stash only when not list/show", () => {
    const { signals } = digestOf(sampleLines());
    expect(signals["card-last"]).toBe(1);
    expect(signals["agent-card-relayed"]).toBe(2);
    expect(signals["agent-model-named"]).toBe(1);
    expect(signals["card-format"]).toBe(1);
    expect(signals["no-stash-in-worktree"]).toBe(1);
    expect(signals["ship-via-do-ship"]).toBeUndefined();
  });

  test("assistant text quoting a guard marker is not a refusal; stash outside worktrees not counted", () => {
    const { signals } = digestOf([
      { type: "user", cwd: "C:\\repo", message: { content: "hi" } },
      { type: "assistant", cwd: "C:\\repo", message: { content: [{ type: "text", text: "[stop.flow.guard] Completion card required is the message" }, { type: "tool_use", id: "a", name: "Bash", input: { command: "git stash" } }] } },
    ]);
    expect(signals).toEqual({});
  });
});

describe("aggregation + trend", () => {
  const rules = [
    { id: "a", description: "rule a", signals: ["A!"] },
    { id: "b", description: "rule b", signals: [] },
  ];
  const sessions = [
    { id: "s1aaaaaaaa", signals: { a: 2 }, grade: { a: { violated: true, count: 2, evidence: "q1" }, b: { violated: false, count: 0, evidence: "" } } },
    { id: "s2bbbbbbbb", signals: {}, grade: { a: { violated: false, count: 0, evidence: "" }, b: { violated: true, count: 1, evidence: "q2" } } },
    { id: "s3cccccccc", signals: { a: 1 }, grade: null },
  ];

  test("rates per rule across sessions", () => {
    const agg = g.aggregate(rules, sessions);
    expect(agg.sessions).toBe(3);
    expect(agg.graded).toBe(2);
    expect(agg.rules.a.detHits).toBe(3);
    expect(agg.rules.a.detRate).toBeCloseTo(0.667, 3);
    expect(agg.rules.a.modelRate).toBe(0.5);
    expect(agg.rules.a.rate).toBe(0.5);
    expect(agg.rules.b.rate).toBe(0.5);
    expect(agg.rules.b.evidence).toEqual(["s2bbbbbb: q2"]);
    expect(g.topToStrengthen(agg)).toEqual(["a", "b"]);
  });

  test("trend vs previous: better / worse / same / new; deterministic-only compares detRate", () => {
    const cur = { graded: 2, rules: { a: { rate: 0.5, detRate: 0.6 }, b: { rate: 0.1, detRate: 0 }, c: { rate: 0.3, detRate: 0 }, d: { rate: 0, detRate: 0 } } };
    const prev = { graded: 3, rules: { a: { rate: 0.2, detRate: 0.6 }, b: { rate: 0.4 , detRate: 0 }, c: { rate: 0.32, detRate: 0 } } };
    expect(g.trend(cur, prev)).toEqual({ a: "worse", b: "better", c: "same", d: "new" });
    expect(g.trend({ ...cur, graded: 0 }, prev).a).toBe("same");
    expect(g.trend(cur, null).a).toBe("new");
  });

  test("parseGrade tolerates fences and clips evidence", () => {
    const text = "```json\n" + JSON.stringify({ rules: { a: { violated: true, count: 0, evidence: "z".repeat(300) }, b: { violated: false } } }) + "\n```";
    const r = g.parseGrade(text, rules);
    expect(r.a.violated).toBe(true);
    expect(r.a.count).toBe(1);
    expect(r.a.evidence.length).toBeLessThanOrEqual(120);
    expect(r.b).toEqual({ violated: false, count: 0, evidence: "" });
    expect(g.parseGrade("no json", rules)).toBeNull();
  });
});

describe("run", () => {
  const home = path.join(root, "home");
  const projects = path.join(home, ".claude", "projects");
  const outDir = path.join(root, "out");
  const proj = path.join(projects, "C--repo");
  fs.mkdirSync(path.join(proj, "sess1", "subagents"), { recursive: true });
  const write = (p, lines, mtime) => { fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n"); fs.utimesSync(p, mtime / 1000, mtime / 1000); };
  write(path.join(proj, "sess1.jsonl"), sampleLines(), NOW - 3600e3);
  write(path.join(proj, "sess1", "subagents", "agent-x.jsonl"), sampleLines(), NOW - 3600e3);
  write(path.join(proj, "old.jsonl"), sampleLines(), NOW - 30 * 86400e3);

  const io = () => { const o = { out: "", err: "" }; return { o, out: (s) => { o.out += s; }, err: (s) => { o.err += s; } }; };
  const mockApi = (status, answer) => {
    const calls = [];
    return {
      calls,
      costOf: (model, u) => ((u.input_tokens || 0) * 0.1 + (u.output_tokens || 0) * 0.5) / 1e6,
      status: () => status,
      call: async (req) => { calls.push(req); return answer(req); },
    };
  };

  test("lists only top-level, recent sessions", () => {
    const s = g.listSessions({ projectsDir: projects, days: 7, maxSessions: 20, now: NOW });
    expect(s.map((x) => x.id)).toEqual(["sess1"]);
  });

  test("dry run: no API call, prints sessions and token estimate, writes nothing", async () => {
    const api = mockApi({ available: true, key: "k" }, () => { throw new Error("network"); });
    const { o, out, err } = io();
    const rc = await g.run(["--dry-run", "--out", outDir], { home, now: NOW, api, out, err });
    expect(rc).toBe(0);
    expect(api.calls).toHaveLength(0);
    expect(o.out).toContain("sess1");
    expect(o.out).toMatch(/estimate: \d+ in \+ ~700 out tokens ≈ \$/);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  test("no API credit: deterministic-only report, exit 0, never calls the API", async () => {
    const api = mockApi({ available: false, reason: "no key" }, () => { throw new Error("must not call"); });
    const { out, err } = io();
    const rc = await g.run(["--out", outDir], { home, now: NOW - 7 * 86400e3 + 7200e3, api, out, err });
    expect(rc).toBe(0);
    expect(api.calls).toHaveLength(0);
    const rep = JSON.parse(fs.readFileSync(path.join(outDir, "report-2026-10-13.json"), "utf8"));
    expect(rep.mode).toBe("deterministic-only");
    expect(rep.apiReason).toBe("no key");
    expect(rep.rules["card-last"].detHits).toBe(1);
    expect(rep.rules["chat-language"].rate).toBeNull(); // model-only rule: n/a, not 0 %
    expect(rep.trend["chat-language"]).toBe("n/a");
    expect(fs.readFileSync(path.join(outDir, "report-2026-10-13.md"), "utf8")).toContain("Deterministic counts only");
  });

  test("model-graded run with mocked Haiku: report + trend vs the previous report", async () => {
    const api = mockApi({ available: true, key: "k" }, (req) => ({
      rc: 0, usd: 0.001, usage: { input_tokens: 5000, output_tokens: 300 },
      text: JSON.stringify({ rules: { "chat-language": { violated: true, count: 1, evidence: "answered in English" } } }),
    }));
    const { o, out, err } = io();
    const rc = await g.run(["--out", outDir], { home, now: NOW, api, out, err });
    expect(rc).toBe(0);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].model).toBe("claude-haiku-5-5");
    expect(api.calls[0].prompt).toContain("- card-last:");
    const rep = JSON.parse(fs.readFileSync(path.join(outDir, "report-2026-10-20.json"), "utf8"));
    expect(rep.mode).toBe("model-graded");
    expect(rep.previousDate).toBe("2026-10-13");
    expect(rep.rules["chat-language"].rate).toBe(1);
    expect(rep.trend["card-last"]).toBe("same");
    expect(rep.top).toHaveLength(3);
    expect(rep.cost.usd).toBe(0.001);
    expect(o.out).toContain("model-graded");
  });

  test("credit exhausted mid-run stops grading but still writes the report", async () => {
    const api = mockApi({ available: true, key: "k" }, () => ({ rc: 75, limit: true, message: "credit balance is too low" }));
    const { out, err } = io();
    const dir = path.join(root, "out2");
    expect(await g.run(["--out", dir], { home, now: NOW, api, out, err })).toBe(0);
    const rep = JSON.parse(fs.readFileSync(path.join(dir, "report-2026-10-20.json"), "utf8"));
    expect(rep.mode).toBe("deterministic-only");
    expect(rep.apiReason).toMatch(/exhausted/);
  });

  test("--schedule registers a weekly job through the launcher (scheduler mocked)", async () => {
    const calls = [];
    const runCmd = (cmd, args, opts) => { calls.push({ cmd, args, input: opts && opts.input }); return { status: 0, stdout: "", stderr: "" }; };
    const { o, out, err } = io();
    expect(await g.run(["--schedule", "--day", "mon"], { home, now: NOW, platform: "linux", runCmd, out, err })).toBe(0);
    expect(o.out).toContain("weekly mon 09:00");
    const cron = calls.find((c) => c.cmd === "crontab" && c.args[0] === "-");
    expect(cron.input).toMatch(/^0 9 \* \* 1 .*devops-jobs.session-grader\.js/m);
    expect(fs.existsSync(path.join(home, ".claude", "devops-jobs", "session-grader.js"))).toBe(true);
  });

  test("bad arguments exit 2; custom rules file is used", async () => {
    const { err } = io();
    expect(await g.run(["--days", "x"], { home, now: NOW, api: mockApi({ available: false }), err, out: () => {} })).toBe(2);
    const rf = path.join(root, "rules.json");
    fs.writeFileSync(rf, JSON.stringify([{ id: "only", description: "one rule", signals: ["card-pregate"] }]));
    const { o, out } = io();
    expect(await g.run(["--dry-run", "--rules", rf], { home, now: NOW, api: mockApi({ available: false, reason: "off" }), out, err })).toBe(0);
    expect(o.out).toContain("only=1");
  });
});
