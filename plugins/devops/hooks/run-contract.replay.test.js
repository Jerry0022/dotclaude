// Replay of the two audited 2026-09-24 sessions (run-contract spec, acceptance
// 1 + 2), reduced to hook inputs and driven through the real hooks in order.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 60_000 });

const require = createRequire(import.meta.url);
const RC = require("./lib/run-contract.js");
const B = require("./lib/batch-state.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRE = path.join(__dirname, "pre-tool-use", "pre.run.contract.js");
const POST = path.join(__dirname, "post-tool-use", "post.run.contract.js");
const ASK = path.join(__dirname, "post-tool-use", "post.ask.answers.js");
const BATCH = path.join(__dirname, "user-prompt-submit", "prompt.batch.collect.js");
const SHIP = "mcp__plugin_devops_dotclaude-ship__ship_release";
const CARD = "mcp__plugin_devops_dotclaude-completion__render_completion_card";

const ENV = { ...process.env };
delete ENV.DOTCLAUDE_RUN_CONTRACT;

let dir;

function git(...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rc-replay-"));
  dir = d;
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(d, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(d, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.writeFileSync(path.join(d, ".gitignore"), ".claude/\n");
  fs.writeFileSync(path.join(d, "README.md"), "x\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return d;
}

function run(hookFile, payload) {
  const res = spawnSync(process.execPath, [hookFile], {
    input: JSON.stringify({ cwd: dir, session_id: "s1", ...payload }),
    cwd: dir, encoding: "utf8", env: ENV,
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}
const pre = (tool_name, tool_input) => run(PRE, { hook_event_name: "PreToolUse", tool_name, tool_input });
const post = (tool_name, tool_input, tool_response = {}) =>
  run(POST, { hook_event_name: "PostToolUse", tool_name, tool_input, tool_response });
const skill = (name, args = "") => post("Skill", { skill: name, args });
const firstLine = (s) => s.split("\n")[0];

beforeEach(() => repo());
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const ROUTER_Q = [
  { header: "Ablauf?", question: "Bist du dabei, und wer shippt am Ende?", options: [{ label: "Dabei · Ship manuell" }, { label: "Weg · Ship automatisch" }] },
  { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [{ label: "Nur das" }, { label: "Mit Umfeld (Recommended)" }] },
  { header: "Durchgänge?", question: "Welche Durchgänge kommen dazu? (Leer lassen = empfohlene)", multiSelect: true,
    options: [{ label: "Harden danach (Recommended)" }, { label: "Polish danach (Recommended)" }, { label: "Rethink vorher" }] },
];
const ROUTER_A = {
  "Bist du dabei, und wer shippt am Ende?": "Weg · Ship automatisch",
  "Wie weit darf die Änderung greifen?": "Mit Umfeld (Recommended)",
  "Welche Durchgänge kommen dazu? (Leer lassen = empfohlene)": ["Harden danach (Recommended)", "Polish danach (Recommended)"],
};
const FOLLOW_Q = [
  { header: "PC danach", question: "Was passiert mit dem PC nach dem Run?", options: [{ label: "PC an · ohne Resume" }] },
  { header: "Issues", question: "Welche Issues (1/2) sollen abgearbeitet werden?", multiSelect: true,
    options: [{ label: "#483 do-batch parallel-bundle plan" }, { label: "#477 skill-extension guide docs" }, { label: "#476 doc generator warning" }] },
  { header: "Issues 2", question: "Welche Issues (2/2) sollen abgearbeitet werden?", multiSelect: true,
    options: [{ label: "#475 git-sync tests under load" }, { label: "#474 appstart machine turns" }, { label: "#473 issue.detect machine turns" }] },
];
const FOLLOW_A = {
  "Was passiert mit dem PC nach dem Run?": "PC an · ohne Resume",
  "Welche Issues (1/2) sollen abgearbeitet werden?": ["Something else", "#483 do-batch parallel-bundle plan", "#477 skill-extension guide docs", "#476 doc generator warning"],
  "Welche Issues (2/2) sollen abgearbeitet werden?": ["#475 git-sync tests under load", "#474 appstart machine turns", "#473 issue.detect machine turns"],
};

function armBacklog() {
  skill("devops:do-run", "backlog");
  post("AskUserQuestion", { questions: ROUTER_Q }, { questions: ROUTER_Q, answers: ROUTER_A });
  const ask = run(ASK, { hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions: FOLLOW_Q }, tool_response: { questions: FOLLOW_Q, answers: FOLLOW_A } });
  post("AskUserQuestion", { questions: FOLLOW_Q }, { questions: FOLLOW_Q, answers: FOLLOW_A });
  return ask;
}

function commitJs(rel) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "module.exports = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fix(hooks): skip machine turns");
}

describe("replay A — backlog session", () => {
  test("refused at the first Write, the commit, and ship_release", () => {
    const ask = armBacklog();
    const c = RC.readContract(dir);
    expect(c).toMatchObject({ mode: "backlog", flow: "autonomous", ship: "auto", passes: ["harden", "polish"], strict: false, source: "router" });
    expect(c.items).toHaveLength(6);
    expect(fs.existsSync(RC.pendingPath(dir))).toBe(false);
    expect(ask.stdout).toContain('[answer-check] \\"Welche Issues (1/2) sollen abgearbeitet werden?\\" was answered with \\"Something else\\" and no text.');

    const branchCmd = "git fetch -q origin && git checkout -q -b fix/473-474-machine-turns origin/main";
    expect(pre("Bash", { command: branchCmd }).code).toBe(0);
    git("checkout", "-q", "-b", "fix/473-474-machine-turns");
    post("Bash", { command: branchCmd });

    const file = path.join(dir, "plugins/devops/hooks/lib/non-user-prompt.js");
    const w = pre("Write", { file_path: file, content: "x" });
    expect(w.code).toBe(2);
    expect(firstLine(w.stderr)).toBe("[run-contract] BLOCKED at edit: the run the user chose is not finished.");
    expect(w.stderr).toContain("auto-agents");
    post("Write", { file_path: file, content: "x" });

    const commitCmd = 'npx eslint plugins/devops/hooks && git add plugins && git commit -q -m "fix(hooks): skip machine turns"';
    const cm = pre("Bash", { command: commitCmd });
    expect(cm.code).toBe(2);
    expect(firstLine(cm.stderr)).toBe("[run-contract] BLOCKED at commit: the run the user chose is not finished.");
    commitJs("plugins/devops/hooks/lib/non-user-prompt.js");
    post("Bash", { command: commitCmd });

    const rel = pre(SHIP, { body: "Closes #473\nCloses #474", base: "main" });
    expect(rel.code).toBe(2);
    expect(firstLine(rel.stderr)).toBe("[run-contract] BLOCKED at release: the run the user chose is not finished.");
    const open = rel.stderr.split("\n").find(l => l.startsWith("Open for this item:"));
    for (const ob of ["auto-agents", "harden", "polish", "qa", "do-ship", "refine #473", "refine #474"]) expect(open).toContain(ob);
    expect(rel.stderr).toContain('Skill("devops:do-ship", "--queued=1/6")');
  });
});

describe("replay B — batch session", () => {
  test("refused at the first Edit after the fire until do-run is invoked", () => {
    B.activate(dir, { marker: ">>" });
    B.appendNote(dir, "types aufräumen");
    const fire = run(BATCH, { prompt: ">> los: implementiere alles direkt" });
    expect(fire.code).toBe(0);
    expect(fire.stdout).toContain("per Hook erzwungen");
    expect(fs.existsSync(RC.batchHandoffPath(dir))).toBe(true);

    for (let i = 0; i < 4; i++) post("Agent", { subagent_type: "Explore", prompt: "look" });
    skill("devops:do-learn");
    skill("devops:auto-issue", "note");
    expect(fs.existsSync(RC.batchHandoffPath(dir))).toBe(true);

    const outside = path.join(os.tmpdir(), `rc-scratch-${process.pid}.md`);
    expect(pre("Write", { file_path: outside, content: "plan" }).code).toBe(0);

    const edit = { file_path: path.join(dir, "src/lib/types.ts"), old_string: "a", new_string: "b" };
    const blocked = pre("Edit", edit);
    expect(blocked.code).toBe(2);
    expect(firstLine(blocked.stderr)).toBe("[run-contract] BLOCKED: a do-batch plan is waiting for its hand-off.");

    skill("devops:do-run", "--from=do-batch plan in .claude/batch-archive.md");
    expect(fs.existsSync(RC.batchHandoffPath(dir))).toBe(false);
    const after = pre("Edit", edit);
    expect(after.stderr).not.toContain("do-batch plan is waiting");
  });
});

describe("replay C — happy path (acceptance 2)", () => {
  test("every gate passes, the card too", () => {
    skill("devops:do-run", "backlog");
    const q = FOLLOW_Q.slice(0, 1).concat([{ header: "Issues", question: "Welche Issues?", options: [{ label: "#473 issue.detect machine turns" }] }]);
    post("AskUserQuestion", { questions: ROUTER_Q }, { questions: ROUTER_Q, answers: ROUTER_A });
    post("AskUserQuestion", { questions: q }, { questions: q, answers: { "Welche Issues?": ["#473 issue.detect machine turns"] } });
    expect(RC.readContract(dir).items).toEqual(["473"]);

    post("Agent", { subagent_type: "Explore", prompt: "triage" });
    skill("devops:auto-issue", "refine #473");
    expect(pre("Skill", { skill: "devops:auto-agents", args: "--from=do-run #473" }).code).toBe(0);
    skill("devops:auto-agents", "--from=do-run #473");
    const file = path.join(dir, "plugins/devops/hooks/lib/x.js");
    expect(pre("Edit", { file_path: file }).code).toBe(0);
    post("Edit", { file_path: file });
    git("checkout", "-q", "-b", "fix/473");
    commitJs("plugins/devops/hooks/lib/x.js");
    skill("devops:auto-harden", "--invoked-by=autonomous");
    skill("devops:auto-polish", "--invoked-by=autonomous");
    post("Agent", { subagent_type: "devops:qa", prompt: "verify" });
    skill("devops:do-ship", "--queued=1/1");

    const rel = pre(SHIP, { body: "Closes #473", base: "main" });
    expect(rel.stderr).toBe("");
    expect(rel.code).toBe(0);
    post(SHIP, { body: "Closes #473" }, [{ type: "text", text: JSON.stringify({ success: true, merged: true }) }]);

    const card = pre(CARD, { variant: "ship-successful" });
    expect(card.code).toBe(0);
    const h = RC.readContractForCard(dir);
    expect(h.closedAt).not.toBeNull();
    const line = RC.summaryForCard(h, RC.events(dir), "de");
    expect(line).not.toContain("✗");
    expect(line).not.toContain("⚠");
  });
});
