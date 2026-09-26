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
const store = require("./lib/run-contract-store.js");
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
    expect(fs.existsSync(store.pendingPath(dir))).toBe(false);
  });

  test("R1: a marker of another session never fallback-arms", () => {
    RC.markPendingArm(dir, { sessionId: "s2", args: "backlog" });
    expect(pre("Edit", { file_path: f("src/a.js") }).code).toBe(0);
    expect(store.readRawContract(dir)).toBeNull();
  });

  test("R1: Skill do-run in a machine-prompt turn writes no arm marker", () => {
    for (const opener of ["AUTONOMOUS_AUTOSTART: mode=implement", "AUTONOMOUS_RESUME: x", "RUN_BACKLOG_AUTOSTART: queue=1"]) {
      post("Skill", { skill: "devops:do-run", args: "autonomous" }, {}, { transcript_path: transcript(opener) });
      expect(fs.existsSync(store.pendingPath(dir))).toBe(false);
    }
    post("Skill", { skill: "devops:do-run", args: "" }, {}, { transcript_path: transcript("mach das mal") });
    expect(RC.pendingArm(dir)).toMatchObject({ sessionId: "s1" });
  });

  test("R1: answering the Fortsetzen question clears the marker (resume path)", () => {
    RC.markPendingArm(dir, { sessionId: "s1" });
    const q = [{ header: "Fortsetzen", question: "Run fortsetzen?", options: [{ label: "Run fortsetzen" }, { label: "Neu starten" }] }];
    post("AskUserQuestion", { questions: q }, { questions: q, answers: { "Run fortsetzen?": "Run fortsetzen" } });
    expect(fs.existsSync(store.pendingPath(dir))).toBe(false);
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
    expect(fs.existsSync(store.batchHandoffPath(dir))).toBe(false);
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

// ── Group B ────────────────────────────────────────────────────────────────

const Q4 = ROUTER_Q[2];
const q4Only = (answer) => RC.parseRouterAnswers([Q4], { [Q4.question]: answer });

describe("R7 — Q4 free text, negation, partial merge", () => {
  test("R7: placeholder / unmatched Q4 text → recommended passes + unresolved; the card says so", () => {
    expect(q4Only("Something else")).toMatchObject({ passes: ["harden", "polish"], unresolved: true });
    expect(q4Only("irgendwas mit Tests")).toMatchObject({ passes: ["harden", "polish"], unresolved: true });
    expect(q4Only(["Harden danach (Recommended)"]).unresolved).toBe(false);
    const c = RC.arm(dir, { ...q4Only("Something else"), sessionId: "s1" });
    expect(c.unresolved).toBe(true);
    expect(RC.summaryForCard(c, [], "de")).toContain("Durchgänge ?");
    expect(RC.summaryForCard(c, [], "en")).toContain("Passes ?");
  });

  test("R7: negation excludes the named pass", () => {
    expect(q4Only("ohne Polish").passes).toEqual(["harden"]);
    expect(q4Only("kein Harden").passes).toEqual(["polish"]);
    expect(q4Only("without polish").passes).toEqual(["harden"]);
    expect(q4Only(["Harden danach (Recommended)", "no polish"]).passes).toEqual(["harden"]);
    expect(q4Only("keine").passes).toEqual([]);
  });

  test("R7: a later partial router call merges only its answered fields", () => {
    post("AskUserQuestion", { questions: ROUTER_Q }, { questions: ROUTER_Q, answers: ROUTER_A });
    const first = RC.readContract(dir);
    expect(first).toMatchObject({ flow: "autonomous", ship: "auto", passes: ["harden", "polish"] });
    post("AskUserQuestion", { questions: [Q4] }, { questions: [Q4], answers: { [Q4.question]: ["Polish danach (Recommended)"] } });
    expect(RC.readContract(dir)).toMatchObject({ id: first.id, flow: "autonomous", ship: "auto", passes: ["polish"] });
  });
});

describe("R8 — done with open obligations", () => {
  test("R8: done refuses without --reason and closes as aborted with one; the card shows ✗", () => {
    armS1({ ship: "auto" });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    const bare = cli("done");
    expect(bare.code).toBe(1);
    expect(bare.out.error).toContain("harden");
    const r = cli("done", "--reason", "user stopped the run");
    expect(r.out).toMatchObject({ ok: true, closed: true, aborted: true });
    const h = RC.readContractForCard(dir);
    expect(h.aborted).toBe(true);
    expect(RC.summaryForCard(h, RC.events(dir), "de")).toContain("✗ abgebrochen (user stopped the run)");
  });

  test("R8: done on a clean run closes normally; the block text names skip / abort / done", () => {
    armS1({ passes: [] });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    expect(cli("done").out).toMatchObject({ ok: true, closed: true });
    expect(RC.readContractForCard(dir).aborted).toBe(false);
    const msg = RC.formatBlock({ mode: "prompt", passes: [] }, [{ ob: "harden", fix: "x" }], "card", { libPath: "L" });
    expect(msg).toContain('Conscious skip (shown on the card as ⚠): node "L" skip <ob> --reason');
    expect(msg).toContain('Run over with open steps (card shows ✗): node "L" abort --reason');
    expect(msg).toContain('Only when every chosen step ran: node "L" done');
  });
});

describe("R9 — qa base and measure", () => {
  test("R9: a master-default repo still counts changed code files (qa applies)", () => {
    git("branch", "-m", "main", "master");
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: [], sessionId: "s1", presence: false });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "skill", name: "do-ship" });
    git("checkout", "-q", "-b", "fix/1");
    fs.writeFileSync(f("a.js"), "1\n");
    git("add", "-A"); git("commit", "-q", "-m", "x");
    ev({ k: "commit" });
    const r = pre(SHIP, { body: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("qa");
    expect(RC.events(dir).filter(e => e.k === "measure").pop()).toMatchObject({ codeFiles: 1 });
  });

  test("R9: an unknown count is recorded and shown as QA ?", () => {
    const c = armS1({ passes: [] });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    ev({ k: "measure", codeFiles: null });
    expect(RC.summaryForCard(c, RC.events(dir), "de")).toContain("QA ?");
    ev({ k: "measure", codeFiles: 9 });
    expect(RC.summaryForCard(c, RC.events(dir), "de")).toContain("QA ✗");
  });
});

describe("release / card gates use tool_input.cwd", () => {
  test("release gate: the contract of tool_input.cwd's repo gates ship_release", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "rc-redteam-other-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: other });
      RC.arm(other, { mode: "prompt", ship: "auto", passes: [], sessionId: "s1" });
      RC.record(other, { k: "skill", name: "auto-agents" });
      RC.record(other, { k: "edit" });
      const r = pre(SHIP, { body: "", cwd: other });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("do-ship");
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  test("H-B1: card gate and card recording both use tool_input.cwd's contract, and the final card closes it", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "rc-redteam-other-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: other });
      RC.arm(other, { mode: "prompt", ship: "manual", passes: ["harden"], sessionId: "s1" });
      RC.record(other, { k: "skill", name: "auto-agents" });
      RC.record(other, { k: "edit" });
      const blocked = pre(CARD, { variant: "ready", cwd: other });
      expect(blocked.code).toBe(2);
      expect(blocked.stderr).toContain("auto-harden");
      RC.record(other, { k: "skill", name: "auto-harden" });
      expect(pre(CARD, { variant: "ready", cwd: other }).code).toBe(0);
      post(CARD, { variant: "ready", cwd: other });
      expect(RC.events(other).filter(e => e.k === "card")).toHaveLength(1);
      expect(RC.readContract(other, { sessionId: "s1" })).toBeNull();
      expect(RC.readContractForCard(other).closeReason).toContain("final card");
      expect(fs.existsSync(store.eventsPath(dir))).toBe(false);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  test("H-B1: a non-MCP tool never looks at tool_input.cwd (same root choice in pre and post)", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "rc-redteam-other-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: other });
      RC.arm(other, { mode: "prompt", sessionId: "s1" });
      expect(pre("Bash", { command: "git commit -m x", cwd: other }).code).toBe(0);
      post("Bash", { command: "git commit -m x", cwd: other });
      expect(RC.events(other)).toEqual([]);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });
});

describe("harden pass: hook-level (H-*)", () => {
  test("H-X4: a quoted Windows git path is refused at the commit gate", () => {
    RC.arm(dir, { mode: "prompt", flow: "interactive", ship: "manual", passes: [], sessionId: "s1" });
    for (const command of [
      '& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m x',
      "& 'C:\\Program Files\\Git\\cmd\\git.exe' commit",
      '"/c/Program Files/Git/bin/git" commit -m x',
      'bash -c "git commit -m x"',
    ]) {
      const r = pre("PowerShell", { command });
      expect(r.code, command).toBe(2);
      expect(r.stderr.split("\n")[0]).toContain("BLOCKED at commit");
    }
    expect(pre("PowerShell", { command: 'echo "git commit"' }).code).toBe(0);
  });

  test("H-B17: a project-root load error never crashes the pre / post hooks", () => {
    RC.arm(dir, { mode: "prompt", sessionId: "s1" });
    const stub = path.join(dir, ".claude", "stub-project-root-throw.js");
    fs.writeFileSync(stub, [
      "const Module = require('module');",
      "const orig = Module.prototype.require;",
      "Module.prototype.require = function (id) {",
      "  if (id === '../lib/project-root') throw new Error('H-B17 stub: project-root failed to load');",
      "  return orig.apply(this, arguments);",
      "};",
    ].join("\n"));
    for (const [file, ev] of [[PRE, "PreToolUse"], [POST, "PostToolUse"]]) {
      const res = spawnSync(process.execPath, ["--require", stub, file], {
        input: JSON.stringify({ cwd: dir, session_id: "s1", hook_event_name: ev, tool_name: "Edit", tool_input: { file_path: f("src/a.js") }, tool_response: {} }),
        cwd: dir, encoding: "utf8", env: ENV,
      });
      expect(res.status, file).toBe(0);
      expect(res.stderr, file).toBe("");
    }
  });
});

describe("park", () => {
  test("park: one event satisfies the item's obligations and ends the segment", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", sessionId: "s1", items: ["1", "2"] });
    ev({ k: "agent", type: "Explore" });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    expect(pre("Bash", { command: "git checkout -b fix/2" }).code).toBe(2);
    expect(cli("park", "1").code).toBe(1);
    expect(cli("park", "#1", "--reason", "tests red on CI").out).toMatchObject({ ok: true, parked: "1" });
    expect(pre("Bash", { command: "git checkout -b fix/2" }).code).toBe(0);
    const line = RC.summaryForCard(RC.readContract(dir), RC.events(dir), "de");
    expect(line).toContain("Harden ⚠ (tests red on CI)");
    expect(line).toContain("Refine 0/2 ✗");
  });
});

describe("Ship manuell backlog: refine at the final card", () => {
  test("refine: the final card needs a refine (or skip / park) for every queued item", () => {
    RC.arm(dir, { mode: "backlog", flow: "interactive", ship: "manual", passes: [], sessionId: "s1", items: ["1", "2"] });
    ev({ k: "agent", type: "Explore" });
    ev({ k: "skill", name: "auto-issue", args: "refine #1" });
    const r = pre(CARD, { variant: "ready" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("refine #2");
    expect(r.stderr).not.toContain("refine #1");
    ev({ k: "skip", ob: "refine", item: "2", reason: "duplicate" });
    expect(pre(CARD, { variant: "ready" }).code).toBe(0);
  });
});

describe("headers: normalised and English", () => {
  test("headers: English / ?-less router headers and answers are recognised", () => {
    const qs = [
      { header: "What", question: "What should this run do?", options: [{ label: "Prompt" }, { label: "Audit" }, { label: "Backlog" }] },
      { header: "Flow", question: "Are you around?", options: [] },
      { header: " scope ", question: "How far?", options: [] },
      { header: "Passes?", question: "Which passes?", options: [] },
    ];
    expect(RC.isRouterCall(qs)).toBe(true);
    const a = { "What should this run do?": "Backlog", "Are you around?": "Away · Ship automatically", "How far?": "Strict", "Which passes?": "Harden" };
    expect(RC.parseRouterAnswers(qs, a)).toMatchObject({ mode: "backlog", flow: "autonomous", ship: "auto", strict: true, passes: ["harden"] });
    expect(RC.isRouterCall([{ header: "Ablauf" }, { header: "Umfang" }])).toBe(true);
    const fu = RC.parseFollowUp([{ header: "Result", question: "r" }, { header: "PC after", question: "p" }], { r: "Audit as concept", p: "PC off" });
    expect(fu).toMatchObject({ auditResult: "concept", pcAfter: "PC off", modeHint: "audit" });
  });
});

// ── Group C ────────────────────────────────────────────────────────────────

describe("C — card payload, command detection, direct ships", () => {
  const withWork = (over = {}) => { armS1(over); ev({ k: "skill", name: "auto-agents" }); ev({ k: "edit" }); };

  test("C-card-stdin: an unreadable --render-card payload (stdin, $var) is gated as a final card", () => {
    withWork();
    expect(pre("Bash", { command: "node x/mcp-server/index.js --render-card -" }).code).toBe(2);
    expect(pre("Bash", { command: "node x/mcp-server/index.js --render-card $payload" }).code).toBe(2);
    const p = f(".claude/pending.json");
    fs.writeFileSync(p, JSON.stringify({ variant: "ready", pending: ["verify on device"] }));
    expect(pre("Bash", { command: `node x/mcp-server/index.js --render-card ${p}` }).code).toBe(0);
  });

  test.each([
    ["& git commit -m x"], ["git.exe commit -m x"], ["git --no-pager commit -m x"],
    ["git -C ../x commit -m y"], ["git -c user.name=x commit -m y"], ["/usr/bin/git commit -m z"],
  ])("C-commit-normalise: %s is a commit", (command) => {
    expect(C.commandFacts(command).commit).toBe(true);
  });

  test("C-commit-normalise: the PowerShell call operator form hits the commit gate", () => {
    armS1();
    expect(pre("PowerShell", { command: "& git commit -m x" }).code).toBe(2);
  });

  test.each([
    ["gh pr merge 12 --squash", true], ["git push origin HEAD:main", true], ["git push origin :master", true],
    ["git push origin main", true], ["git push -u origin feat/x", false], ["git push origin main-core", false],
    ["git push --dry-run origin HEAD:main", false],
  ])("C-direct-ship: %s → release %s", (command, release) => {
    expect(C.commandFacts(command).release).toBe(release);
  });

  test("C-direct-ship: gh pr merge / push to main is refused while ship: auto and do-ship never ran", () => {
    withWork({ ship: "auto", passes: [] });
    const r = pre("Bash", { command: "gh pr merge 12 --squash --delete-branch" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("BLOCKED at release");
    expect(r.stderr).toContain('Skill("devops:do-ship")');
    expect(pre("Bash", { command: "git push origin HEAD:main" }).code).toBe(2);
    ev({ k: "skill", name: "do-ship" });
    expect(pre("Bash", { command: "gh pr merge 12 --squash" }).code).toBe(0);
  });

  test("C-direct-ship: with ship: manual a push to main is not release-gated", () => {
    withWork({ ship: "manual", passes: ["harden"] });
    expect(pre("Bash", { command: "git push origin HEAD:main" }).code).toBe(0);
  });
});

describe("C — atomic arm and update", () => {
  const nodeFs = require("fs");

  test("C-arm-order: a failed rename keeps the old contract (new header written first)", () => {
    const old = armS1({ mode: "audit" });
    const real = nodeFs.renameSync;
    nodeFs.renameSync = () => { const e = new Error("EPERM"); e.code = "EPERM"; throw e; };
    try {
      expect(RC.arm(dir, { mode: "backlog", sessionId: "s1" })).toBeNull();
    } finally { nodeFs.renameSync = real; }
    expect(store.readRawContract(dir)).toMatchObject({ id: old.id, mode: "audit" });
    expect(fs.existsSync(store.prevPath(dir))).toBe(false);
  });

  test("C-arm-order: one failed rename is retried after 50 ms", () => {
    const old = armS1({ mode: "audit" });
    ev({ k: "edit" });
    const real = nodeFs.renameSync;
    let fails = 1;
    nodeFs.renameSync = (...a) => {
      if (fails-- > 0) { const e = new Error("EPERM"); e.code = "EPERM"; throw e; }
      return real(...a);
    };
    let h;
    try { h = RC.arm(dir, { mode: "backlog", sessionId: "s1" }); } finally { nodeFs.renameSync = real; }
    expect(h).toMatchObject({ mode: "backlog" });
    expect(store.readRawContract(dir).id).toBe(h.id);
    const prev = JSON.parse(fs.readFileSync(store.prevPath(dir), "utf8"));
    expect(prev).toMatchObject({ id: old.id, mode: "audit" });
    expect(prev.events).toHaveLength(1);
    expect(RC.events(dir)).toEqual([]);
  });

  test("C-update-race: update re-reads before writing and never clears a concurrent close", () => {
    const c = armS1({ source: "fallback" });
    const openText = fs.readFileSync(store.contractPath(dir), "utf8");
    RC.close(dir, "done: final card");
    const real = nodeFs.readFileSync;
    let stale = 2; // archiveIfExpired + readContract see the pre-close header
    let served = false;
    nodeFs.readFileSync = (file, ...rest) => {
      if (stale > 0 && String(file) === store.contractPath(dir)) { stale--; served = true; return openText; }
      return real(file, ...rest);
    };
    let out;
    try { out = RC.update(dir, { announced: true, closedAt: null }); } finally { nodeFs.readFileSync = real; }
    expect(served).toBe(true);
    const raw = store.readRawContract(dir);
    expect(raw.id).toBe(c.id);
    expect(raw.closedAt).not.toBeNull();
    expect(raw.closeReason).toBe("done: final card");
    expect(out.closedAt).not.toBeNull();
  });
});

// ── RT3: red-team pass 3 (hook level) ─────────────────────────────────────

describe("RT3 — command-position false passes and false blocks (hook level)", () => {
  const withWork = (over = {}) => { armS1(over); ev({ k: "skill", name: "auto-agents" }); ev({ k: "edit" }); };
  const backlogWithWork = () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: ["harden"], sessionId: "s1", presence: false });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
  };

  test.each([
    ["PowerShell", "$r = git commit -m x 2>&1"],
    ["PowerShell", "if ($x) { git commit -m x }"],
    ["PowerShell", 'iex "git commit -m x"'],
    ["Bash", "if true; then git commit -m x; fi"],
    ["Bash", "for f in a; do git commit -m $f; done"],
    ["Bash", "bash <<'EOF'\ngit commit -m x\nEOF"],
  ])("RT3-R3: %s `%s` hits the commit gate", (tool, command) => {
    armS1();
    expect(pre(tool, { command }).code).toBe(2);
  });

  test.each([
    ["PowerShell", "$null = git push origin main"],
    ["PowerShell", "try { git push origin main } catch {}"],
    ["Bash", "git push \\\n  origin main"],
  ])("RT3-R3: %s `%s` hits the release gate under ship: auto", (tool, command) => {
    withWork({ ship: "auto", passes: [] });
    expect(pre(tool, { command }).code).toBe(2);
  });

  test("RT3-QA: the corpus false positive passes (quoted heredoc with code spans)", () => {
    withWork({ ship: "auto", passes: [] });
    const command = "cat > f.js <<'EOF'\n// run `gh pr merge` via do-ship, never `git push` to main\nEOF";
    expect(pre("Bash", { command }).code).toBe(0);
  });

  test("RT3-R10: `git branch X && git switch X` is an item boundary; switching to an existing branch is not", () => {
    backlogWithWork();
    expect(pre("Bash", { command: "git branch fix/8 && git switch fix/8" }).code).toBe(2);
    expect(pre("Bash", { command: "gh issue develop 8 -c --name fix/8" }).code).toBe(2);
    expect(pre("Bash", { command: "git switch existing" }).code).toBe(0);
    expect(pre("Bash", { command: "git branch main-core && git switch main-core" }).code).toBe(0);
  });
});
