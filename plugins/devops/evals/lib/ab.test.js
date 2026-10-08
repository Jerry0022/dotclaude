import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
const { parseScalar, parseFrontmatter, parseYaml, loadCase, resolveCases, globToRegex } = require("./case.js");
const { buildSettings, buildClaudeArgs, formatCommand, resolveClaudeBin, INSTALLED_PLUGIN_KEY } = require("./command.js");
const { parseStream, totalTokens } = require("./stream.js");
const g = require("./graders.js");
const { summarize, formatSummary } = require("./summary.js");
const { parseArgs, childEnv, gradeOrUndecided } = require("../ab-run.js");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "stream-sample.jsonl"), "utf8");
const parsed = parseStream(FIXTURE);
const ctx = (extra = {}) => ({ parsed, raw: FIXTURE, workdir: os.tmpdir(), ...extra });

describe("case loading", () => {
  it("parses the flat YAML subset used by cases and graders", () => {
    expect(parseScalar("[Read, Glob, Agent]")).toEqual(["Read", "Glob", "Agent"]);
    expect(parseScalar("{ EVAL_DOTCLAUDE_BUDGET: free }")).toEqual({ EVAL_DOTCLAUDE_BUDGET: "free" });
    expect(parseScalar("{ source: file, path: NOTES.md }")).toEqual({ source: "file", path: "NOTES.md" });
    expect(parseScalar("'it''s \\s'")).toBe("it's \\s");
    expect(parseScalar("12")).toBe(12);
    expect(parseYaml('schema_version: "1.1"\nname: x\ncontext:\n  scaffold_script: scaffold.sh\n'))
      .toEqual({ schema_version: "1.1", name: "x", context: { scaffold_script: "scaffold.sh" } });
    expect(parseFrontmatter("---\nmax_turns: 3\n---\n\nhello\n")).toEqual({ meta: { max_turns: 3 }, body: "hello" });
  });

  it("loads a real case with prompt, tools, env, scaffold and md graders", () => {
    const [dir] = resolveCases("delegation/inline-typo-fix");
    const c = loadCase(dir);
    expect(c.id).toBe("delegation/inline-typo-fix");
    expect(c.allowedTools).toEqual(["Read", "Glob", "Grep", "Agent", "Edit", "Write"]);
    expect(c.env).toEqual({ EVAL_DOTCLAUDE_BUDGET: "free" });
    expect(c.scaffold).toMatch(/scaffold\.sh$/);
    expect(c.prompt.startsWith("Create a file NOTES.md")).toBe(true);
    expect(c.mdGraders.map((x) => x.type)).toEqual(["regex", "tool_used"]);
    expect(c.mdGraders[1].input_match).toContain('"subagent_type"');
  });

  it("resolves case globs over ids", () => {
    expect(globToRegex("delegation/inline-*").test("delegation/inline-explain")).toBe(true);
    expect(globToRegex("delegation/inline-*").test("delegation/x/inline-a")).toBe(false);
    const ids = resolveCases("delegation/inline-*").map((d) => path.basename(d));
    expect(ids).toEqual(expect.arrayContaining(["inline-typo-fix", "inline-explain"]));
    expect(ids.every((i) => i.startsWith("inline-"))).toBe(true);
  });
});

describe("command building", () => {
  it("disables the installed plugin via enabledPlugins", () => {
    expect(INSTALLED_PLUGIN_KEY).toBe("devops@dotclaude");
    expect(buildSettings()).toEqual({ enabledPlugins: { "devops@dotclaude": false } });
    expect(buildSettings({ disable: ["a@m", "b@m"] })).toEqual({ enabledPlugins: { "a@m": false, "b@m": false } });
    expect(buildSettings({ deny: ["Bash(node *)"] })).toEqual({ enabledPlugins: { "devops@dotclaude": false }, permissions: { deny: ["Bash(node *)"] } });
  });

  it("builds the claude -p argv", () => {
    const args = buildClaudeArgs({ prompt: "hi \"there\"", pluginDir: "C:\\p\\devops", allowedTools: ["Read", "Edit"], model: "sonnet" });
    expect(args).toEqual([
      "-p", "hi \"there\"", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
      "--plugin-dir", "C:\\p\\devops", "--settings", '{"enabledPlugins":{"devops@dotclaude":false}}',
      "--allowedTools", "Read,Edit", "--model", "sonnet",
    ]);
    expect(buildClaudeArgs({ prompt: "x", pluginDir: "d" })).not.toContain("--allowedTools");
    expect(() => buildClaudeArgs({ pluginDir: "d" })).toThrow();
  });

  it("formats a copy-pasteable command line", () => {
    expect(formatCommand("claude", ["-p", "it's here", "--verbose"])).toBe("claude -p 'it'\\''s here' --verbose");
  });

  it("resolves claude.exe behind an npm .cmd shim", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-bin-"));
    const exe = path.join(dir, "node_modules", "pkg", "bin", "claude.exe");
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
    fs.writeFileSync(path.join(dir, "claude.cmd"), '"%dp0%\\node_modules\\pkg\\bin\\claude.exe"   %*\r\n');
    expect(resolveClaudeBin({ PATH: dir }, "win32")).toBe(exe);
    expect(resolveClaudeBin({ CLAUDE_BIN: "/x/claude" }, "win32")).toBe("/x/claude");
    expect(resolveClaudeBin({ PATH: dir }, "linux")).toBe("claude");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("runner args", () => {
  it("parses flags and defaults", () => {
    const o = parseArgs(["--case", "delegation/inline-typo-fix", "--runs", "3", "--a-ref", "origin/main", "--dry-run"]);
    expect(o.runs).toBe(3);
    expect(o.aRef).toBe("origin/main");
    expect(o.dryRun).toBe(true);
    expect(o.disable).toEqual(["devops@dotclaude"]);
    expect(o.b).toBe(path.resolve(__dirname, "..", ".."));
    expect(() => parseArgs([])).toThrow(/--case/);
    expect(() => parseArgs(["--case", "x", "--runs", "0"])).toThrow();
    expect(() => parseArgs(["--case", "x", "--a", "d", "--a-ref", "r"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown/);
  });

  it("drops the nested-session marker and applies case env", () => {
    const prev = process.env.CLAUDECODE;
    process.env.CLAUDECODE = "1";
    const env = childEnv({ EVAL_DOTCLAUDE_BUDGET: "free" });
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.EVAL_DOTCLAUDE_BUDGET).toBe("free");
    if (prev === undefined) delete process.env.CLAUDECODE; else process.env.CLAUDECODE = prev;
  });

  // 2026-10-08: from a Desktop session the child CLI said "Not logged in"
  // until the host's CLAUDE*/ANTHROPIC* vars were stripped.
  it("strips every host CLAUDE*/ANTHROPIC* var but keeps the rest and the case env", () => {
    const env = childEnv({ CLAUDE_BIN: "x" }, {
      PATH: "/bin", ANTHROPIC_BASE_URL: "http://host", CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1", CLAUDECODE: "1",
    });
    expect(env).toEqual({ PATH: "/bin", CLAUDE_BIN: "x" });
  });
});

describe("path_prepend (stub CLIs)", () => {
  it("prepends dirs to PATH under the env's own key casing", () => {
    const sep = path.delimiter;
    expect(childEnv({}, { PATH: "/usr/bin" }, ["/w/bin"])).toEqual({ PATH: `/w/bin${sep}/usr/bin` });
    const win = childEnv({}, { Path: "C:/Windows" }, ["C:/w/bin", "C:/w/tools"]);
    expect(Object.keys(win)).toEqual(["Path"]);
    expect(win.Path).toBe(["C:/w/bin", "C:/w/tools", "C:/Windows"].join(sep));
    expect(childEnv({}, {}, ["/w/bin"])).toEqual({ PATH: "/w/bin" });
    expect(childEnv({}, { PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it("loads path_prepend from prompt.md frontmatter (auto-issue stubs gh)", () => {
    const c = loadCase(resolveCases("skills/auto-issue/bug-with-marker")[0]);
    expect(c.pathPrepend).toEqual(["bin"]);
    expect(c.env.GH_TOKEN).toBeTruthy();
    // The create is no longer denied — the stub answers it; edits stay denied.
    expect(c.denyTools).not.toContain("Bash(gh issue create*)");
    expect(c.denyTools).toContain("Bash(gh issue edit*)");
    expect(loadCase(resolveCases("delegation/inline-typo-fix")[0]).pathPrepend).toEqual([]);
  });

  it("auto-issue graders: guard-passed and write-succeeded", () => {
    const c = loadCase(resolveCases("skills/auto-issue/bug-with-marker")[0]);
    const graders = Object.fromEntries(g.loadGraders(c).map((x) => [x.name, x.check]));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-grade-"));
    const url = "https://github.com/example-org/settings-demo/issues/4242";
    const ok = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: url }] } });
    const blocked = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "PreToolUse:Bash hook error: BLOCKED: Raw GitHub issue write detected" }] } });
    const run = (raw) => ({ parsed: parseStream(raw), raw, workdir: dir });
    expect(graders["guard-passed"](run(ok))).toBe(true);
    expect(graders["guard-passed"](run(blocked))).toBe(false);
    expect(graders["write-succeeded"](run(ok))).toBe(false); // the stub never ran
    fs.writeFileSync(path.join(dir, "gh-calls.log"), ["label list", "issue create --title [BUG] X", ""].join("\n"));
    expect(graders["write-succeeded"](run(ok))).toBe(true);
    expect(graders["write-succeeded"](run(blocked))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("failed runs", () => {
  it("grade as undecided on non-zero exit or an error result (e.g. 401)", () => {
    const graders = [{ name: "none", check: g.noDevopsAgent() }];
    const authFail = parseStream('{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate. API Error: 401"}');
    expect(gradeOrUndecided(graders, 1, { parsed: authFail })).toEqual({ none: null });
    expect(gradeOrUndecided(graders, 0, { parsed: authFail })).toEqual({ none: null });
    expect(gradeOrUndecided(graders, 0, { parsed })).toEqual({ none: false });
  });
});

describe("stream-json parsing", () => {
  it("extracts init, tool calls, skills, agents, text and result", () => {
    expect(parsed.sessionId).toBe("s-1");
    expect(parsed.plugins[0].name).toBe("devops");
    expect(parsed.parseErrors).toBe(1);
    expect(parsed.toolCalls.map((c) => c.name)).toEqual(["Skill", "Agent", "WebFetch", "Agent", "mcp__plugin_devops_dotclaude-completion__render_card"]);
    expect(parsed.toolCalls[2].subagent).toBe(true);
    expect(parsed.toolCalls[1].key).toEqual({ subagent_type: "devops:research", model: "sonnet", description: "look up docs" });
    expect(parsed.skills).toEqual([{ skill: "devops:auto-fix", subagent: false }]);
    expect(parsed.agents.map((a) => a.subagent_type)).toEqual(["devops:research", "general-purpose"]);
    expect(parsed.finalText).toBe("Done: receive the payload.");
    expect(parsed.assistantText).toEqual(["Fixing the typo inline.", "Done: receive the payload."]);
    expect(parsed.costUsd).toBe(0.0123);
    expect(parsed.numTurns).toBe(4);
    expect(parsed.usage).toEqual({ input_tokens: 13, output_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 });
  });

  it("falls back to per-message usage (deduped, main thread only) without a result event", () => {
    const noResult = FIXTURE.split("\n").filter((l) => !l.includes('"type":"result"')).join("\n");
    const p = parseStream(noResult);
    expect(p.usage).toEqual({ input_tokens: 13, output_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 });
    expect(p.finalText).toBe("Done: receive the payload.");
    expect(totalTokens(p.usage)).toBe(145);
    expect(totalTokens(null)).toBe(0);
  });
});

describe("grader predicates", () => {
  it("skill and agent predicates", () => {
    expect(g.skillInvoked("auto-fix")(ctx())).toBe(true);
    expect(g.skillInvoked(/auto-(fix|issue)/)(ctx())).toBe(true);
    expect(g.skillInvoked("concept")(ctx())).toBe(false);
    expect(g.skillNotInvoked("concept")(ctx())).toBe(true);
    expect(g.agentSpawned("devops:research")(ctx())).toBe(true);
    expect(g.agentSpawned("research", { model: "opus" })(ctx())).toBe(false);
    expect(g.agentSpawned(null, { min: 2, max: 2 })(ctx())).toBe(true);
    expect(g.noDevopsAgent()(ctx())).toBe(false);
    expect(g.toolUsed("WebFetch")(ctx())).toBe(false);
    expect(g.toolUsed("WebFetch", { includeSubagents: true })(ctx())).toBe(true);
    expect(g.cardRendered()(ctx())).toBe(true);
  });

  it("noDevopsAgent ignores card-render spawns", () => {
    const p = parseStream(FIXTURE.replace('"devops:research"', '"general-purpose"'));
    expect(g.noDevopsAgent()({ parsed: p })).toBe(true);
    const card = parseStream(FIXTURE.replace('"look up docs"', '"render the Completion card"'));
    expect(g.noDevopsAgent()({ parsed: card })).toBe(true);
  });

  it("text, trace and file predicates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-grade-"));
    fs.writeFileSync(path.join(dir, "NOTES.md"), "receive the payload\n");
    expect(g.textMatches(/typo inline/)(ctx())).toBe(true);
    expect(g.finalTextMatches("^Done")(ctx())).toBe(true);
    expect(g.traceMatches('"subagent_type":"devops:research"')(ctx())).toBe(true);
    expect(g.fileExists("NOTES.md")(ctx({ workdir: dir }))).toBe(true);
    expect(g.fileMatches("NOTES.md", "receive the payload")(ctx({ workdir: dir }))).toBe(true);
    expect(g.fileMatches("MISSING.md", "x")(ctx({ workdir: dir }))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("compiles md grader frontmatter and grades a run", () => {
    const graders = [
      { name: "agents", source: "md", check: g.compileMdGrader({ type: "tool_used", tool: "Agent", input_match: '"subagent_type"\\s*:\\s*"devops:', min: 0, max: 0 }) },
      { name: "skill", source: "md", check: g.compileMdGrader({ type: "tool_used", tool: "Skill", input_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?(?:auto-fix|fix)"', min: 1 }) },
      { name: "last", source: "md", check: g.compileMdGrader({ type: "regex", pattern: "payload" }) },
      { name: "llm", source: "md", check: g.compileMdGrader({ type: "llm_judge" }) },
      { name: "throws", source: "js", check: () => { throw new Error("x"); } },
    ];
    expect(g.gradeRun(graders, ctx())).toEqual({ agents: false, skill: true, last: true, llm: null, throws: null });
  });

  it("loads graders.md and an optional graders.js from a case", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-case-"));
    const js = path.join(dir, "graders.js");
    fs.writeFileSync(js, "module.exports = (g) => ({ 'fix-skill': g.skillInvoked('auto-fix'), bad: 42 });");
    const list = g.loadGraders({ mdGraders: [{ name: "f", type: "file_exists", path: "X" }], jsGradersFile: js });
    expect(list.map((x) => [x.name, x.source, typeof x.check])).toEqual([["f", "md", "function"], ["fix-skill", "js", "function"], ["bad", "js", "object"]]);
    expect(g.gradeRun(list, ctx({ workdir: dir }))).toEqual({ f: false, "fix-skill": true, bad: null });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("summary", () => {
  const u = (i, o) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const results = [
    { case: "c", variant: "A", exitCode: 0, usage: u(10, 5), costUsd: 0.1, durationMs: 1000, grades: { g1: true, g2: null } },
    { case: "c", variant: "A", exitCode: 0, usage: u(10, 5), costUsd: 0.1, durationMs: 3000, grades: { g1: false, g2: true } },
    { case: "c", variant: "B", exitCode: 1, usage: u(4, 1), costUsd: 0.05, durationMs: 500, grades: { g1: true, g2: null } },
  ];

  it("computes pass rates per grader and variant, excluding undecided", () => {
    const s = summarize(results);
    const g1 = s.graders.find((x) => x.grader === "g1");
    const g2 = s.graders.find((x) => x.grader === "g2");
    expect(g1.variants.A).toEqual({ pass: 1, graded: 2, undecided: 0, rate: 0.5 });
    expect(g1.variants.B).toEqual({ pass: 0, graded: 0, undecided: 1, rate: null }); // failed run
    expect(g2.variants.A).toEqual({ pass: 1, graded: 1, undecided: 1, rate: 1 });
    expect(g2.variants.B.rate).toBeNull();
  });

  it("totals tokens, cost, errors and mean duration per variant", () => {
    const s = summarize(results);
    expect(s.variants.A.totalTokens).toBe(30);
    expect(s.variants.A.costUsd).toBe(0.2);
    expect(s.variants.A.meanDurationMs).toBe(2000);
    expect(s.variants.B.errors).toBe(1);
    const text = formatSummary(s);
    expect(text).toContain("c :: g1 | 50% (1/2) | n/a (0/0, 1 n/a)");
    expect(text).toContain("c :: g2 | 100% (1/1, 1 n/a) | n/a (0/0, 1 n/a)");
    expect(text).toMatch(/^B: runs=1 errors=1 tokens=5/m);
  });
});
