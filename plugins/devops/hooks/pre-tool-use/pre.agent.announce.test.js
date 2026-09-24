import { describe, test, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Spawns the real hook; see post.flow.completion.test.js for why the timeout
// is generous under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.agent.announce.js");

const projects = [];
afterAll(() => {
  for (const dir of projects) fs.rmSync(dir, { recursive: true, force: true });
});

// A temp project whose settings enable the plugin (plugin-guard) and whose
// HOME is private, so no real ~/.claude/agents file can shadow a test agent.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-announce-"));
  projects.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.mkdirSync(path.join(dir, ".home"), { recursive: true });
  return dir;
}

function transcript(dir, model) {
  const file = path.join(dir, "transcript.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: "hi" } },
    { type: "assistant", message: { role: "assistant", model: "claude-sonnet-5", content: [] } },
    { type: "assistant", message: { role: "assistant", model, content: [] } },
  ];
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

// CLAUDE_PLUGIN_ROOT is dropped: set (e.g. when the ship MCP server runs the
// suite) it points outside the private HOME's plugin cache, so plugin-guard
// would treat the hook as an ad-hoc load and pass it even when disabled.
function hookEnv(dir) {
  const home = path.join(dir, ".home");
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

function runHook(dir, { toolName = "Agent", input = {}, extra = {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_name: toolName, tool_input: input, cwd: dir, ...extra }),
      encoding: "utf8",
      env: hookEnv(dir),
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) {
        throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      }
      return res;
    }
  }
}

function card(res) {
  expect(res.status).toBe(0);
  const out = JSON.parse(res.stdout);
  expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  const ctx = out.hookSpecificOutput.additionalContext;
  expect(ctx).toMatch(/show the user this card verbatim/i);
  return ctx.slice(ctx.indexOf("\n---\n") + 1);
}

/** The card's agent rows as `type · model · effort · mode — task`, the old line's shape. */
function line(res) {
  const c = card(res);
  const mode = / · (?:\d+ )?foreground/.test(c.split("\n")[1]) ? "foreground" : "background";
  const rows = c.split("\n").filter((l) => /^\| \S+ \| \*\*/.test(l)).map((l) => {
    const [, type, task, model, effort] = l.split("|").slice(1, -1).map((x) => x.trim().replace(/\*\*/g, ""));
    const e = effort.replace(/^[●○+]+ /, "").replace(/^◌ session$/, "session effort");
    return `${type} · ${model} · ${e} · ${mode}${task === "—" ? "" : ` — ${task}`}`;
  });
  return rows.length === 1 ? rows[0] : rows;
}

describe("pre.agent.announce (hook)", () => {
  test("devops agent shows its frontmatter model and effort, background by default", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "devops:research", description: "Compare rate limiters", prompt: "x" },
    });
    expect(line(res)).toBe("research · opus · high · background — Compare rate limiters");
  });

  test("a model override shows as default → override, effort once", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "devops:core", model: "opus", run_in_background: false, prompt: "x" },
    });
    expect(line(res)).toBe("core · sonnet → opus · medium · foreground");
  });

  test("a budget downgrade of an opus role reads opus → sonnet", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "devops:po", model: "sonnet", description: "Scope call", prompt: "x" },
    });
    expect(line(res)).toBe("po · opus → sonnet · high · background — Scope call");
  });

  test("an inheriting built-in names the session's model with its version", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "Explore", description: "Sweep hooks", prompt: "x" },
      extra: { transcript_path: transcript(dir, "claude-opus-5-5") },
    });
    expect(line(res)).toBe("Explore · opus 5.5 (session) · session effort · background — Sweep hooks");
  });

  test("without a transcript the inherited model stays generic", () => {
    const dir = project();
    const res = runHook(dir, { input: { subagent_type: "general-purpose", prompt: "x" } });
    expect(line(res)).toBe("general-purpose · session model · session effort · background");
  });

  test("a project agent's frontmatter is read from .claude/agents", () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "agents", "scout.md"),
      "---\nname: scout\nmodel: fable\neffort: low\n---\nbody\n"
    );
    const res = runHook(dir, { input: { subagent_type: "scout", prompt: "x" } });
    expect(line(res)).toBe("scout · fable · low · background");
  });

  test("silent inside a subagent and for other tools", () => {
    const dir = project();
    const sub = runHook(dir, {
      input: { subagent_type: "devops:qa", prompt: "x" },
      extra: { agent_id: "a1", agent_type: "devops:feature" },
    });
    expect(sub.status).toBe(0);
    expect(sub.stdout).toBe("");

    const other = runHook(dir, { toolName: "Bash", input: { command: "ls" } });
    expect(other.status).toBe(0);
    expect(other.stdout).toBe("");
  });

  test("another plugin's agent is shown as inheriting, not guessed", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "claude-security:explore", prompt: "x" },
      extra: { transcript_path: transcript(dir, "claude-fable-5-1") },
    });
    expect(line(res)).toBe("claude-security:explore · fable 5.1 (session) · session effort · background");
  });

  test("an unknown devops role falls back to the session model", () => {
    const dir = project();
    const res = runHook(dir, { input: { subagent_type: "devops:nope", prompt: "x" } });
    expect(line(res)).toBe("nope · session model · session effort · background");
  });

  test("feature inherits: session model and effort, override still visible", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "devops:feature", model: "opus", prompt: "x" },
      extra: { transcript_path: transcript(dir, "claude-sonnet-5") },
    });
    expect(line(res)).toBe("feature · sonnet 5 (session) → opus · session effort · background");
  });

  test("an override equal to the frontmatter model shows no arrow", () => {
    const dir = project();
    const res = runHook(dir, { input: { subagent_type: "devops:qa", model: "sonnet", prompt: "x" } });
    expect(line(res)).toBe("qa · sonnet · medium · background");
  });

  test("a missing subagent_type is the general-purpose agent", () => {
    const dir = project();
    const res = runHook(dir, { input: { prompt: "x", description: "  multi\n line  " } });
    expect(line(res)).toBe("general-purpose · session model · session effort · background — multi line");
  });

  test("an unreadable transcript or malformed input never breaks the spawn", () => {
    const dir = project();
    const res = runHook(dir, {
      input: { subagent_type: "Explore", prompt: "x" },
      extra: { transcript_path: path.join(dir, "missing.jsonl") },
    });
    expect(line(res)).toBe("Explore · session model · session effort · background");

    const bad = spawnSync(process.execPath, [HOOK], {
      cwd: dir, input: "{not json", encoding: "utf8",
      env: hookEnv(dir),
    });
    expect(bad.status).toBe(0);
    expect(bad.stdout).toBe("");
  });

  test("silent when the plugin is not enabled for the project", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: {} }));
    const res = runHook(dir, { input: { subagent_type: "devops:qa", prompt: "x" } });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("agents launched in one message share one card; earlier messages stay out", () => {
    const dir = project();
    const file = path.join(dir, "batch.jsonl");
    const call = (msg, id, input) => ({
      type: "assistant",
      message: { id: msg, role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id, name: "Agent", input }] },
    });
    const a = { subagent_type: "devops:core", description: "[W1] Engine", prompt: "a" };
    const b = { subagent_type: "devops:frontend", description: "[W1] Hold", prompt: "b" };
    const c = { subagent_type: "devops:qa", description: "Tests", prompt: "c" };
    const lines = [
      call("m0", "t0", { subagent_type: "devops:research", description: "Earlier", prompt: "r" }),
      call("m1", "t1", a),
      call("m1", "t2", b),
      { ...call("m1", "tx", c), isSidechain: true },
    ];
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    const second = runHook(dir, { input: b, extra: { transcript_path: file, tool_use_id: "t2" } });
    expect(line(second)).toEqual([
      "core · sonnet · medium · background — Engine",
      "frontend · sonnet · medium · background — Hold",
    ]);
    expect(card(second)).toMatch(/\*\*2 agents started\*\* · background · Wave 1/);
    expect(card(second)).toContain("**Σ Mix:** **2×** sonnet ●● medium");

    // Without a tool_use_id the spawn is found by its prompt; the first of the batch is alone.
    const first = runHook(dir, { input: a, extra: { transcript_path: file } });
    expect(line(first)).toBe("core · sonnet · medium · background — Engine");
  });

  test("the plugin's agent roster never pins a model version", () => {
    const agentsDir = path.resolve(__dirname, "..", "..", "agents");
    for (const f of fs.readdirSync(agentsDir).filter(n => n.endsWith(".md"))) {
      const fm = fs.readFileSync(path.join(agentsDir, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
      const model = (fm.match(/^model:\s*(\S+)/m) || [])[1];
      expect(model, f).toMatch(/^(opus|sonnet|haiku|fable|inherit)$/);
    }
  });
});

describe("pre.agent.announce under strict mode", () => {
  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  };
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };

  async function strictRepo() {
    const S = await import("../lib/strict-state.js");
    const dir = project();
    git(dir, "init", "-q", "-b", "feat/x");
    fs.writeFileSync(path.join(dir, "README.md"), "x\n");
    git(dir, "add", "README.md");
    git(dir, "commit", "-q", "-m", "init");
    S.activate(dir, { reason: "on" });
    return { dir, S };
  }

  test("a spawn the strict gate will refuse is not announced", async () => {
    const { dir } = await strictRepo();
    const res = runHook(dir, { input: { subagent_type: "devops:frontend", prompt: "Mach den Rand dünner." } });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  test("the retry carrying the contract block is announced", async () => {
    const { dir, S } = await strictRepo();
    const res = runHook(dir, {
      input: { subagent_type: "devops:frontend", prompt: `${S.CONTRACT_BLOCK}\n\nMach den Rand dünner.` },
    });
    expect(line(res)).toBe("frontend · sonnet · medium · background");
  });
});
