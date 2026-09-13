import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decideAction, buildBlockReason, renderLadderLines } from "./card-guard.js";
import { isScheduledTask } from "../user-prompt-submit/prompt.flow.silent-turn.js";
import { isMcpServerAlive, pidFileFor } from "./mcp-heartbeat.js";

// #371 — a gated cron routine's idle tick ("Gate: idle, next run 17:07") is
// one script call and ~10 s of work, yet stop.flow.guard demanded a completion
// card on every such turn, and in those sessions the completion MCP often never
// connected — so each tick ran the whole ladder (tool → ToolSearch → block →
// offline renderer → relay): 4-5 turns and minutes of wall clock for nothing.
//
// Two contracts pinned here:
//   1. the narrow exemption — scheduled-task prompt AND clean tree AND no ship
//      passes without a card; drop ANY of the three and Gate 1 is back;
//   2. offline-first — when the completion MCP heartbeat is dead the block
//      reason (and the post-tool reminder) name the offline renderer FIRST.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const idle = {
  workHappened: true,          // the routine's one Bash call
  cardRendered: false,
  stopHookActive: false,
  substantial: false,
  scheduledTask: true,
  treeClean: true,
  shipped: false,
};

describe("decideAction — scheduled-task idle exemption (#371)", () => {
  test("scheduled task + clean tree + no ship → pass without a card, flags reset", () => {
    const d = decideAction(idle);
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
    expect(d.exempt).toBe("scheduled-task-idle");
  });

  test("a scheduled task that changed a file owes the card", () => {
    const d = decideAction({ ...idle, treeClean: false });
    expect(d.action).toBe("block");
    expect(d.reason).toContain("Completion card required");
  });

  test("a scheduled task that shipped owes the card even with a clean tree", () => {
    const d = decideAction({ ...idle, shipped: true });
    expect(d.action).toBe("block");
  });

  test("an unknown tree state (null) is NOT treated as clean", () => {
    const d = decideAction({ ...idle, treeClean: null });
    expect(d.action).toBe("block");
  });

  test("a user turn with the same shape is untouched — the exemption needs the scheduler prompt", () => {
    const d = decideAction({ ...idle, scheduledTask: false });
    expect(d.action).toBe("block");
  });

  test("a scheduled task that DID render a card still goes through validation / pending gates", () => {
    const d = decideAction({ ...idle, cardRendered: true, validationPending: true, validationAttested: false });
    expect(d.action).toBe("block");
    expect(d.reason).toContain("Validation required");
  });

  test("silent tick still wins over everything", () => {
    const d = decideAction({ ...idle, silent: true, treeClean: false, shipped: true });
    expect(d).toEqual({ action: "pass", resetFlags: true });
  });
});

describe("block reason — offline-first when the completion MCP is down (#371)", () => {
  const root = "/opt/devops";
  const offlineLine = 'node "/opt/devops/mcp-server/index.js" --render-card';
  const toolLine = "mcp__plugin_devops_dotclaude-completion__render_completion_card";

  test("default order: tool → ToolSearch → offline renderer", () => {
    const r = buildBlockReason(root);
    expect(r.indexOf(toolLine)).toBeLessThan(r.indexOf(offlineLine));
    expect(r).toContain("NOW as the FIRST action");
    expect(r).not.toContain("heartbeat dead");
  });

  test("heartbeat dead: offline renderer is the FIRST instruction, tool + ToolSearch after it", () => {
    const r = buildBlockReason(root, { completionMcpDown: true });
    expect(r).toContain("heartbeat dead");
    expect(r.indexOf(offlineLine)).toBeLessThan(r.indexOf(toolLine));
    // The offline rung keeps its payload contract in both orders.
    expect(r).toContain('(same field names, including "session_id")');
    // The rest of the reason (variant table, verbatim rule) is unchanged.
    expect(r).toContain("Variant decision (pick exactly one):");
    expect(r).toContain("nothing after the closing ---");
  });

  test("decideAction threads completionMcpDown into the Gate 1 reason", () => {
    const d = decideAction({ workHappened: true, cardRendered: false, pluginRoot: root, completionMcpDown: true });
    expect(d.action).toBe("block");
    expect(d.reason.indexOf(offlineLine)).toBeLessThan(d.reason.indexOf(toolLine));
  });

  test("renderLadderLines is the single source for both orders", () => {
    expect(renderLadderLines(root)[0]).toMatch(/^Call `mcp__plugin_devops_dotclaude-completion/);
    expect(renderLadderLines(root, { completionMcpDown: true })[0]).toMatch(/NOT running/);
  });
});

describe("isScheduledTask — the scheduler's prompt wrapper", () => {
  test("real scheduled-task prompt is detected", () => {
    expect(isScheduledTask('<scheduled-task name="nightly-admin-feedback" file="C:\\Users\\x\\.claude\\scheduled-tasks\\nightly-admin-feedback\\SKILL.md">\nRun the gate…</scheduled-task>')).toBe(true);
    expect(isScheduledTask("  \n<scheduled-task name=\"x\">…")).toBe(true);
  });

  test("prose that merely mentions the tag is not a scheduled task", () => {
    expect(isScheduledTask("The prompt arrives wrapped in <scheduled-task …> — detect it")).toBe(false);
    expect(isScheduledTask("<scheduled-tasks> plural is something else")).toBe(false);
    expect(isScheduledTask("")).toBe(false);
    expect(isScheduledTask(undefined)).toBe(false);
  });
});

describe("isMcpServerAlive — heartbeat PID probe", () => {
  // Point os.tmpdir() at a private dir so a real running server on this
  // machine cannot answer for the test in either direction.
  function withTmp(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-"));
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    process.env.TMPDIR = dir; process.env.TEMP = dir; process.env.TMP = dir;
    try { return fn(dir); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  test("no PID file → dead", () => {
    withTmp(() => { expect(isMcpServerAlive("dotclaude-completion")).toBe(false); });
  });

  test("PID file naming a live process → alive; a dead PID → dead", () => {
    withTmp((dir) => {
      const file = pidFileFor("dotclaude-completion");
      expect(path.dirname(file)).toBe(dir);
      fs.writeFileSync(file, String(process.pid));
      expect(isMcpServerAlive("dotclaude-completion")).toBe(true);
      // A child that has already exited leaves a PID nobody answers for.
      const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
      fs.writeFileSync(file, String(gone));
      expect(isMcpServerAlive("dotclaude-completion")).toBe(false);
      fs.writeFileSync(file, "not-a-pid");
      expect(isMcpServerAlive("dotclaude-completion")).toBe(false);
    });
  });
});

// End-to-end through the real hooks: prompt → flag → stop guard decision.
describe("hooks end-to-end — an idle tick passes, an edited tick blocks", () => {
  const HOOKS = path.join(__dirname, "..");
  const PROMPT_HOOK = path.join(HOOKS, "user-prompt-submit", "prompt.flow.silent-turn.js");
  const POST_HOOK = path.join(HOOKS, "post-tool-use", "post.flow.completion.js");
  const STOP_HOOK = path.join(HOOKS, "stop", "stop.flow.guard.js");

  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-idle-"));
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
    // Flag files go to a tmpdir OUTSIDE the repo — as in production, where they
    // live in the OS tmp — or every hook write would itself dirty the tree.
    fs.mkdirSync(path.join(dir + "-tmp"), { recursive: true });
    // A real repo so `git status --porcelain` is the tree signal.
    const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "README.md"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    return dir;
  }

  function run(dir, hook, payload) {
    const tmp = dir + "-tmp";
    const res = spawnSync(process.execPath, [hook], {
      cwd: dir,
      input: JSON.stringify({ session_id: "sched-e2e", cwd: dir, ...payload }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
      timeout: 20_000,
    });
    return res.stdout || "";
  }

  test("scheduled prompt + one tool call + clean tree → stop guard passes silently", () => {
    const dir = project();
    try {
      run(dir, PROMPT_HOOK, { prompt: '<scheduled-task name="gate" file="x">check</scheduled-task>' });
      const reminder = run(dir, POST_HOOK, { tool_name: "Bash", tool_input: { command: "node gate.mjs check" }, tool_response: "Gate: idle" });
      expect(reminder).toContain("SCHEDULED TASK: if this turn changes NO file");
      const out = run(dir, STOP_HOOK, { stop_hook_active: false, transcript_path: path.join(dir, "none.jsonl") });
      expect(out.trim()).toBe("");
    } finally { for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }
  });

  test("same tick but a file changed → stop guard blocks for the card", () => {
    const dir = project();
    try {
      run(dir, PROMPT_HOOK, { prompt: '<scheduled-task name="gate" file="x">check</scheduled-task>' });
      run(dir, POST_HOOK, { tool_name: "Bash", tool_input: { command: "node fix.mjs" }, tool_response: "fixed" });
      fs.writeFileSync(path.join(dir, "README.md"), "changed\n");
      const out = run(dir, STOP_HOOK, { stop_hook_active: false, transcript_path: path.join(dir, "none.jsonl") });
      expect(out).toContain('"decision":"block"');
      expect(out).toContain("Completion card required");
    } finally { for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }
  });

  test("a ship_release merge this turn sets the shipped flag and the card is owed", () => {
    const dir = project();
    try {
      run(dir, PROMPT_HOOK, { prompt: '<scheduled-task name="deploy" file="x">ship</scheduled-task>' });
      run(dir, POST_HOOK, {
        tool_name: "mcp__plugin_devops_dotclaude-ship__ship_release",
        tool_input: { cwd: dir },
        tool_response: { content: [{ type: "text", text: JSON.stringify({ success: true, merged: "main", pr: { number: 1 } }) }] },
      });
      const out = run(dir, STOP_HOOK, { stop_hook_active: false, transcript_path: path.join(dir, "none.jsonl") });
      expect(out).toContain('"decision":"block"');
    } finally { for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }
  });

  test("a plain user prompt with one tool call still blocks — nothing else changed", () => {
    const dir = project();
    try {
      run(dir, PROMPT_HOOK, { prompt: "check the gate please" });
      run(dir, POST_HOOK, { tool_name: "Bash", tool_input: { command: "node gate.mjs check" }, tool_response: "Gate: idle" });
      const out = run(dir, STOP_HOOK, { stop_hook_active: false, transcript_path: path.join(dir, "none.jsonl") });
      expect(out).toContain('"decision":"block"');
    } finally { for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }
  });
});
