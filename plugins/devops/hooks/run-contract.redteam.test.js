// Regression tests for the run-contract red-team findings (R1–R10 and the
// unnumbered medium / low ones). Every test name carries its finding id.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readRunContractLine } from "../mcp-server/lib/mode-state.js";

vi.setConfig({ testTimeout: 60_000 });

const require = createRequire(import.meta.url);
const RC = require("./lib/run-contract.js");
const C = require("./lib/run-contract-calls.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRE = path.join(__dirname, "pre-tool-use", "pre.run.contract.js");
const POST = path.join(__dirname, "post-tool-use", "post.run.contract.js");
const PROMPT = path.join(__dirname, "user-prompt-submit", "prompt.run.contract.js");
const LIB = path.join(__dirname, "lib", "run-contract.js");
const SHIP = "mcp__plugin_devops_dotclaude-ship__ship_release";
const CARD = "mcp__plugin_devops_dotclaude-completion__render_completion_card";
const ENV = { ...process.env };
delete ENV.DOTCLAUDE_RUN_CONTRACT;

let dir;
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-redteam-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function hook(file, payload, env = {}) {
  const res = spawnSync(process.execPath, [file], {
    input: JSON.stringify({ cwd: dir, session_id: "s1", ...payload }),
    cwd: dir, encoding: "utf8", env: { ...ENV, ...env },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}
const pre = (tool_name, tool_input, extra = {}) => hook(PRE, { hook_event_name: "PreToolUse", tool_name, tool_input, ...extra });
const post = (tool_name, tool_input, tool_response = {}, extra = {}) =>
  hook(POST, { hook_event_name: "PostToolUse", tool_name, tool_input, tool_response, ...extra });
const prompt = (text, extra = {}) => hook(PROMPT, { hook_event_name: "UserPromptSubmit", prompt: text, ...extra });
const cli = (...args) => {
  const r = spawnSync(process.execPath, [LIB, ...args], { cwd: dir, encoding: "utf8", env: ENV });
  const line = r.stdout.trim().split("\n").pop();
  return { code: r.status, out: line ? JSON.parse(line) : null };
};
const f = (rel) => path.join(dir, rel);
const ev = (e) => RC.record(dir, e);
const armS1 = (over = {}) => RC.arm(dir, { mode: "prompt", flow: "interactive", ship: "manual", passes: ["harden", "polish"], sessionId: "s1", ...over });
const transcript = (userText) => {
  const t = path.join(dir, ".claude", "t.jsonl");
  fs.writeFileSync(t, `${JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: userText } })}\n`);
  return t;
};

const ROUTER_Q = [
  { header: "Ablauf?", question: "Bist du dabei, und wer shippt am Ende?", options: [{ label: "Dabei · Ship manuell" }, { label: "Weg · Ship automatisch" }] },
  { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [{ label: "Nur das" }, { label: "Mit Umfeld (Recommended)" }] },
  { header: "Durchgänge?", question: "Welche Durchgänge kommen dazu?", multiSelect: true,
    options: [{ label: "Harden danach (Recommended)" }, { label: "Polish danach (Recommended)" }, { label: "Rethink vorher" }] },
];
const ROUTER_A = {
  "Bist du dabei, und wer shippt am Ende?": "Weg · Ship automatisch",
  "Wie weit darf die Änderung greifen?": "Mit Umfeld (Recommended)",
  "Welche Durchgänge kommen dazu?": ["Harden danach (Recommended)", "Polish danach (Recommended)"],
};

// ── Group A ────────────────────────────────────────────────────────────────

describe("R1 — no clobbering re-arm", () => {
  test("R1: an active same-session contract survives a router-less do-run; the marker is cleared", () => {
    const c = armS1({ mode: "audit", ship: "auto" });
    RC.markPendingArm(dir, { sessionId: "s1", args: "" });
    pre("Edit", { file_path: f("src/a.js") });
    expect(RC.readContract(dir)).toMatchObject({ id: c.id, mode: "audit", ship: "auto" });
    expect(fs.existsSync(RC.pendingPath(dir))).toBe(false);
  });

  test("R1: a marker of another session never fallback-arms", () => {
    RC.markPendingArm(dir, { sessionId: "s2", args: "backlog" });
    expect(pre("Edit", { file_path: f("src/a.js") }).code).toBe(0);
    expect(RC.readRawContract(dir)).toBeNull();
  });

  test("R1: Skill do-run in a machine-prompt turn writes no arm marker", () => {
    for (const opener of ["AUTONOMOUS_AUTOSTART: mode=implement", "AUTONOMOUS_RESUME: x", "RUN_BACKLOG_AUTOSTART: queue=1"]) {
      post("Skill", { skill: "devops:do-run", args: "autonomous" }, {}, { transcript_path: transcript(opener) });
      expect(fs.existsSync(RC.pendingPath(dir))).toBe(false);
    }
    post("Skill", { skill: "devops:do-run", args: "" }, {}, { transcript_path: transcript("mach das mal") });
    expect(RC.pendingArm(dir)).toMatchObject({ sessionId: "s1" });
  });

  test("R1: answering the Fortsetzen question clears the marker (resume path)", () => {
    RC.markPendingArm(dir, { sessionId: "s1" });
    const q = [{ header: "Fortsetzen", question: "Run fortsetzen?", options: [{ label: "Run fortsetzen" }, { label: "Neu starten" }] }];
    post("AskUserQuestion", { questions: q }, { questions: q, answers: { "Run fortsetzen?": "Run fortsetzen" } });
    expect(fs.existsSync(RC.pendingPath(dir))).toBe(false);
  });
});

describe("R2 — typed /do-run and preset-dropped Q1", () => {
  test("R2: a typed /do-run backlog writes the arm marker with its args", () => {
    prompt("/do-run backlog");
    expect(RC.pendingArm(dir)).toMatchObject({ args: "backlog", sessionId: "s1" });
    RC.clearPendingArm(dir);
    prompt("<command-message>do-run</command-message>\n<command-name>/devops:do-run</command-name>\n<command-args>audit --strict</command-args>");
    expect(RC.pendingArm(dir)).toMatchObject({ args: "audit --strict" });
    RC.clearPendingArm(dir);
    prompt("bitte /do-run nicht");
    expect(RC.pendingArm(dir)).toBeNull();
  });

  test("R2: Q1 absent → the follow-up headers of the same call set the mode", () => {
    const qs = [...ROUTER_Q, { header: "Milestones", question: "Welche Milestones?" }];
    expect(RC.parseRouterAnswers(qs, ROUTER_A)).toMatchObject({ mode: "backlog", modeFrom: "follow-up" });
    const qa = [...ROUTER_Q, { header: "Audit-Umfang", question: "Wie breit?" }];
    expect(RC.parseRouterAnswers(qa, ROUTER_A).mode).toBe("audit");
  });

  test("R2: a follow-up upgrades a defaulted prompt contract of the same session (≤ 30 min)", () => {
    post("AskUserQuestion", { questions: ROUTER_Q }, { questions: ROUTER_Q, answers: ROUTER_A });
    expect(RC.readContract(dir)).toMatchObject({ mode: "prompt", modeFrom: "default" });
    const q = [{ header: "Issues", question: "Welche Issues?", options: [{ label: "#473 a" }] }];
    post("AskUserQuestion", { questions: q }, { questions: q, answers: { "Welche Issues?": ["#473 a"] } });
    expect(RC.readContract(dir)).toMatchObject({ mode: "backlog", items: ["473"] });
  });

  test("R2: no upgrade when Q1 was answered or the contract is older than 30 min", () => {
    const now = Date.now();
    RC.arm(dir, { mode: "prompt", modeFrom: "q1", sessionId: "s1" }, { now });
    RC.applyFollowUp(dir, { modeHint: "backlog", items: ["1"] }, { sessionId: "s1", now });
    expect(RC.readContract(dir, { now }).mode).toBe("prompt");
    RC.arm(dir, { mode: "prompt", modeFrom: "default", sessionId: "s1" }, { now });
    RC.applyFollowUp(dir, { modeHint: "backlog" }, { sessionId: "s1", now: now + 31 * 60_000 });
    expect(RC.readContract(dir, { now: now + 31 * 60_000 }).mode).toBe("prompt");
  });
});

describe("R3 — session-bound state", () => {
  test("R3: a contract of another session never gates and is not on the card", () => {
    RC.arm(dir, { mode: "prompt", sessionId: "s2" });
    expect(pre("Edit", { file_path: f("src/a.js") }).code).toBe(0);
    expect(pre("Bash", { command: "git commit -m x" }).code).toBe(0);
    expect(readRunContractLine(dir, "de", "s1")).toBeNull();
    expect(readRunContractLine(dir, "de", "s2")).toMatch(/^🧾 Run/);
  });

  test("R3: a stored header without session id is foreign once older than 10 min", () => {
    const now = Date.now();
    RC.arm(dir, { mode: "prompt" }, { now: now - 11 * 60_000 });
    ev({ k: "edit" });
    expect(RC.readContract(dir, { sessionId: "s1" })).toBeNull();
    expect(RC.readContract(dir)).not.toBeNull();
    expect(pre("Edit", { file_path: f("src/a.js") }).code).toBe(0);
    RC.arm(dir, { mode: "prompt" });
    expect(pre("Edit", { file_path: f("src/a.js") }).code).toBe(2);
    expect(RC.readContract(dir).sessionId).toBe("s1"); // claimed by the fresh session
  });

  test("R3: a batch hand-off marker of another session does not block", () => {
    RC.markBatchHandoff(dir, { sessionId: "s2" });
    expect(pre("Edit", { file_path: f("src/a.ts") }).code).toBe(0);
    RC.markBatchHandoff(dir, { sessionId: "s1" });
    expect(pre("Edit", { file_path: f("src/a.ts") }).code).toBe(2);
  });
});

describe("R4 — batch hand-off way out", () => {
  test("R4: batch-clear needs a reason, clears the marker; the block names it and the kill switch", () => {
    RC.markBatchHandoff(dir, { sessionId: "s1" });
    const r = pre("Edit", { file_path: f("src/a.ts") });
    expect(r.stderr).toContain("batch-clear --reason");
    expect(r.stderr).toContain("DOTCLAUDE_RUN_CONTRACT=off");
    expect(cli("batch-clear").code).toBe(1);
    expect(cli("batch-clear", "--reason", "stale from yesterday").out).toMatchObject({ ok: true, cleared: true });
    expect(fs.existsSync(RC.batchHandoffPath(dir))).toBe(false);
    expect(pre("Edit", { file_path: f("src/a.ts") }).stderr).not.toContain("do-batch plan");
  });
});

describe("R5 — machine prompts never change the mode", () => {
  test("R5: AUTONOMOUS_AUTOSTART mode=implement refreshes an active audit contract", () => {
    const c = armS1({ mode: "audit", ship: "manual" });
    ev({ k: "edit" });
    prompt("AUTONOMOUS_AUTOSTART: mode=implement ship=auto strict=on");
    expect(RC.readContract(dir)).toMatchObject({ id: c.id, mode: "audit", ship: "auto", strict: true });
    expect(RC.events(dir)).toHaveLength(1);
    expect(pre("Edit", { file_path: f("src/a.js") }).code).toBe(0);
  });

  test("R5: mode=analyze over audit clears passes; RUN_BACKLOG_AUTOSTART forces backlog", () => {
    armS1({ mode: "audit" });
    prompt("AUTONOMOUS_AUTOSTART: mode=analyze");
    expect(RC.readContract(dir)).toMatchObject({ mode: "audit", passes: [], auditResult: "concept" });
    armS1({ mode: "prompt" });
    prompt("RUN_BACKLOG_AUTOSTART: queue=5,6");
    expect(RC.readContract(dir)).toMatchObject({ mode: "backlog", items: ["5", "6"] });
  });

  test("R5: a contract of another session is replaced by a fresh machine contract", () => {
    RC.arm(dir, { mode: "audit", sessionId: "s2" });
    prompt("AUTONOMOUS_AUTOSTART: mode=implement");
    expect(RC.readContract(dir)).toMatchObject({ mode: "prompt", source: "machine", sessionId: "s1" });
  });
});

describe("R6 — only real item branches are item boundaries", () => {
  const backlogWithWork = () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: ["harden"], sessionId: "s1", presence: false });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
  };

  test("R6: subagent, worktree add, --detach and sub-branches pass the branch gate", () => {
    backlogWithWork();
    expect(pre("Bash", { command: "git checkout -B main-core origin/main" }).code).toBe(0);
    expect(pre("Bash", { command: "git checkout -b main/frontend" }).code).toBe(0);
    expect(pre("Bash", { command: "git checkout -b fix/2" }, { agent_id: "a1" }).code).toBe(0);
    expect(pre("Bash", { command: "git worktree add ../wt -b fix/3" }).code).toBe(0);
    expect(pre("Bash", { command: "git switch -c fix/5 --detach" }).code).toBe(0);
    expect(pre("Bash", { command: "git checkout -b fix/4" }).code).toBe(2);
  });

  test("R6: a subagent's / sub-branch's creation records no branch event (the item stays whole)", () => {
    backlogWithWork();
    post("Bash", { command: "git checkout -b fix/2" }, {}, { agent_id: "a1" });
    git("checkout", "-q", "-b", "main-core");
    post("Bash", { command: "git checkout -b main-core" });
    post("Bash", { command: "git worktree add ../wt -b fix/9" });
    expect(RC.events(dir).map(e => e.k)).toEqual(["skill", "edit"]);
    git("checkout", "-q", "main");
    git("checkout", "-q", "-b", "fix/7");
    post("Bash", { command: "git checkout -b fix/7" });
    expect(RC.events(dir).map(e => e.k)).toEqual(["skill", "edit", "branch"]);
  });

  test("R6: isItemBranch unit", () => {
    expect(C.isItemBranch(C.commandFacts("git checkout -b fix/4"), {}, "main")).toBe(true);
    expect(C.isItemBranch(C.commandFacts("git checkout -b feat/x-core"), {}, "feat/x")).toBe(false);
    expect(C.isItemBranch(C.commandFacts("git checkout -b feat/x-core"), {}, "feat")).toBe(false);
    expect(C.isItemBranch(C.commandFacts("git checkout -b feat-core"), {}, "feat")).toBe(false);
    expect(C.isItemBranch(C.commandFacts("git checkout -b fix/4"), {}, null)).toBe(true);
    expect(C.isItemBranch(C.commandFacts("git worktree add ../a -b y"), {}, "main")).toBe(false);
  });
});
