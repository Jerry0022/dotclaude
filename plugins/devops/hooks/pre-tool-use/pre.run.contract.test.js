import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const RC = require("../lib/run-contract.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.run.contract.js");
const SHIP = "mcp__plugin_devops_dotclaude-ship__ship_release";
const CARD = "mcp__plugin_devops_dotclaude-completion__render_completion_card";
const ENV = { ...process.env };
delete ENV.DOTCLAUDE_RUN_CONTRACT;

let dir;
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-pre-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function run(tool_name, tool_input, extra = {}, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, hook_event_name: "PreToolUse", tool_name, tool_input, ...extra }),
    cwd: dir, encoding: "utf8", env: { ...ENV, ...env },
  });
  return { code: res.status, stderr: res.stderr || "" };
}
const f = (rel) => path.join(dir, rel);
const armPrompt = (over = {}) => RC.arm(dir, { mode: "prompt", flow: "interactive", ship: "manual", passes: ["harden", "polish"], ...over });
const armBacklog = (over = {}) => RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: ["harden", "polish"], ...over });
const ev = (e) => RC.record(dir, e);

describe("fast path and kill switch", () => {
  test("no contract, no marker → exit 0 and nothing written", () => {
    const r = run("Edit", { file_path: f("src/a.js") });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(fs.readdirSync(path.join(dir, ".claude"))).toEqual([]);
  });

  test("DOTCLAUDE_RUN_CONTRACT=off disables every gate", () => {
    armPrompt();
    expect(run("Edit", { file_path: f("src/a.js") }, {}, { DOTCLAUDE_RUN_CONTRACT: "off" }).code).toBe(0);
  });

  test("invalid stdin → exit 0", () => {
    armPrompt();
    const res = spawnSync(process.execPath, [HOOK], { input: "not json", cwd: dir, encoding: "utf8", env: ENV });
    expect(res.status).toBe(0);
  });

  test("a closed contract gates nothing", () => {
    armPrompt();
    RC.close(dir, "done");
    expect(run("Edit", { file_path: f("src/a.js") }).code).toBe(0);
  });
});

describe("edit gate (auto-agents)", () => {
  test("blocked until auto-agents ran", () => {
    armPrompt();
    const r = run("Write", { file_path: f("src/a.js"), content: "x" });
    expect(r.code).toBe(2);
    expect(r.stderr.split("\n")[0]).toBe("[run-contract] BLOCKED at edit: the run the user chose is not finished.");
    expect(r.stderr).toContain('Skill("devops:auto-agents"');
    ev({ k: "skill", name: "auto-agents", args: "" });
    expect(run("Write", { file_path: f("src/a.js"), content: "x" }).code).toBe(0);
  });

  test("relative paths resolve against cwd; NotebookEdit is gated too", () => {
    armPrompt();
    expect(run("Edit", { file_path: "src/a.js" }).code).toBe(2);
    expect(run("NotebookEdit", { notebook_path: f("nb/a.ipynb") }).code).toBe(2);
  });

  test.each([
    [".claude/notes.md"], [".git/info/exclude"], ["docs/concepts/x/index.html"],
    ["BACKLOG-2026.md"], ["AUTONOMOUS-report.md"], ["BURN-1.md"],
  ])("exempt: %s", (rel) => {
    armPrompt();
    expect(run("Write", { file_path: f(rel), content: "x" }).code).toBe(0);
  });

  test("outside the work tree is exempt", () => {
    armPrompt();
    expect(run("Write", { file_path: path.join(os.tmpdir(), "scratch-rc.md"), content: "x" }).code).toBe(0);
  });

  test("audit contracts carry no auto-agents obligation", () => {
    armPrompt({ mode: "audit" });
    expect(run("Edit", { file_path: f("src/a.js") }).code).toBe(0);
  });
});

describe("commit gate", () => {
  test("git commit blocked, also inside && chains and PowerShell", () => {
    armPrompt();
    expect(run("Bash", { command: 'git add -A && git commit -m "x && y"' }).code).toBe(2);
    expect(run("PowerShell", { command: "git add -A; git commit -m x" }).code).toBe(2);
  });

  test.each([
    ["git commit --dry-run -m x"], ['grep -r "git commit" .'], ["git status && git log -1"],
  ])("not a commit: %s", (command) => {
    armPrompt();
    expect(run("Bash", { command }).code).toBe(0);
  });
});

describe("branch gate (backlog)", () => {
  test("no work in the segment → allowed", () => {
    armBacklog();
    expect(run("Bash", { command: "git checkout -q -b fix/1" }).code).toBe(0);
  });

  test("leaving a segment with work: harden/polish/do-ship open → blocked", () => {
    armBacklog();
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    const r = run("Bash", { command: "git switch -c fix/2" });
    expect(r.code).toBe(2);
    expect(r.stderr.split("\n")[0]).toContain("BLOCKED at branch");
    for (const ob of ["harden", "polish", "do-ship"]) expect(r.stderr).toContain(ob);
    ev({ k: "skill", name: "auto-harden", args: "--invoked-by=autonomous" });
    ev({ k: "skill", name: "auto-polish", args: "--invoked-by=autonomous" });
    ev({ k: "release", ok: false });
    expect(run("Bash", { command: "git checkout -b fix/3" }).stderr).toContain("do-ship");
    ev({ k: "card", variant: "ship-blocked" });
    expect(run("Bash", { command: "git checkout -b fix/3" }).code).toBe(0);
  });

  test("harden run by do-ship (--invoked-by=ship) does not count", () => {
    armBacklog({ passes: ["harden"], ship: "manual" });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "commit" });
    ev({ k: "skill", name: "auto-harden", args: "--invoked-by=ship" });
    expect(run("Bash", { command: "git checkout -b fix/9" }).code).toBe(2);
  });

  test("prompt mode never gates branch creation", () => {
    armPrompt();
    ev({ k: "edit" });
    expect(run("Bash", { command: "git checkout -b x" }).code).toBe(0);
  });
});

describe("auto-agents gate (triage)", () => {
  test("first auto-agents of a present backlog run needs triage", () => {
    armBacklog();
    const r = run("Skill", { skill: "devops:auto-agents", args: "x" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("triage");
    ev({ k: "agent", type: "Explore" });
    expect(run("Skill", { skill: "devops:auto-agents", args: "x" }).code).toBe(0);
  });

  test("presence false (machine autostart) skips triage", () => {
    armBacklog({ presence: false });
    expect(run("Skill", { skill: "devops:auto-agents" }).code).toBe(0);
  });

  test("other skills are never gated", () => {
    armBacklog();
    expect(run("Skill", { skill: "devops:do-ship" }).code).toBe(0);
  });
});

describe("release gate", () => {
  test("prompt mode, everything done → allowed", () => {
    armPrompt({ ship: "auto" });
    for (const e of [{ k: "skill", name: "auto-agents" }, { k: "edit" }, { k: "skill", name: "auto-harden" }, { k: "skill", name: "auto-polish" }, { k: "skill", name: "do-ship" }]) ev(e);
    expect(run(SHIP, { body: "Closes #1" }).code).toBe(0);
  });

  test("do-ship open → blocked with the never-directly hint; skip clears it", () => {
    armPrompt({ ship: "auto", passes: [] });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    const r = run(SHIP, { body: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("never the ship_* MCP tools directly");
    ev({ k: "skip", ob: "do-ship", reason: "user ships by hand" });
    expect(run(SHIP, { body: "" }).code).toBe(0);
  });

  test("qa counts changed code files from git (backlog ≥ 1)", () => {
    armBacklog({ passes: [], ship: "manual", presence: false });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    git("checkout", "-q", "-b", "fix/q");
    fs.writeFileSync(f("a.js"), "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "a");
    const r = run(SHIP, { body: "", base: "main" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("devops:qa");
    ev({ k: "agent", type: "devops:qa" });
    expect(run(SHIP, { body: "", base: "main" }).code).toBe(0);
  });

  test("git failure (unknown base) never blocks for qa", () => {
    armBacklog({ passes: [], ship: "manual", presence: false });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    expect(run(SHIP, { body: "", base: "no-such-base" }).code).toBe(0);
  });
});

describe("card gate", () => {
  function openHarden() {
    armPrompt({ passes: ["harden"] });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
  }

  test("final variant with an open pass → blocked", () => {
    openHarden();
    const r = run(CARD, { variant: "ready" });
    expect(r.code).toBe(2);
    expect(r.stderr.split("\n")[0]).toContain("BLOCKED at card");
    expect(r.stderr).toContain("auto-harden");
  });

  test.each([
    [{ variant: "ready", pending: ["x"] }], [{ variant: "ready", concept: { url: "https://x" } }],
    [{ variant: "ship-blocked" }], [{ variant: "test-minimal" }],
  ])("not a final card: %j", (input) => {
    openHarden();
    expect(run(CARD, input).code).toBe(0);
  });

  test("an aborted contract passes the card gate", () => {
    openHarden();
    RC.close(dir, "blocked: tests red", { aborted: true });
    expect(run(CARD, { variant: "ready" }).code).toBe(0);
  });

  test("offline renderer --render-card <payload.json> is gated from the payload", () => {
    openHarden();
    const payload = path.join(dir, ".claude", "card.json");
    fs.writeFileSync(payload, JSON.stringify({ variant: "ship-successful" }));
    const cmd = `node "C:/x/mcp-server/index.js" --render-card "${payload}"`;
    expect(run("Bash", { command: cmd }).code).toBe(2);
    fs.writeFileSync(payload, JSON.stringify({ variant: "ship-successful", pending: ["verify"] }));
    expect(run("Bash", { command: cmd }).code).toBe(0);
    expect(run("Bash", { command: `node index.js --render-card missing.json` }).code).toBe(0);
  });
});

describe("pending-arm fallback (spec B)", () => {
  test("no router answers in the transcript → click-through defaults, said in the block", () => {
    RC.markPendingArm(dir, { args: "backlog" });
    const r = run("Edit", { file_path: f("src/a.js") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("click-through defaults");
    const c = RC.readContract(dir);
    expect(c).toMatchObject({ source: "fallback", mode: "backlog", flow: "interactive", ship: "manual", passes: ["harden", "polish"] });
    expect(fs.existsSync(RC.pendingPath(dir))).toBe(false);
  });

  test("router answers found in the transcript tail → armed from them", () => {
    RC.markPendingArm(dir, { args: "" });
    const q = [
      { header: "Was?", question: "Was soll dieser Run tun?", options: [{ label: "Prompt umsetzen" }] },
      { header: "Ablauf?", question: "Bleibst du erreichbar?", options: [] },
      { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [] },
      { header: "Durchgänge?", question: "Welche Durchgänge?", options: [] },
    ];
    const line = JSON.stringify({ type: "user", timestamp: new Date().toISOString(), toolUseResult: { questions: q, answers: {
      "Was soll dieser Run tun?": "Prompt umsetzen", "Bleibst du erreichbar?": "Autonom · Ship automatisch",
      "Wie weit darf die Änderung greifen?": "Strikt", "Welche Durchgänge?": "keine" } } });
    const t = path.join(dir, ".claude", "t.jsonl");
    fs.writeFileSync(t, `${JSON.stringify({ type: "assistant" })}\n${line}\n`);
    run("Edit", { file_path: f("src/a.js") }, { transcript_path: t });
    expect(RC.readContract(dir)).toMatchObject({ source: "router", flow: "autonomous", ship: "auto", strict: true, passes: [] });
  });

  test("a marker older than 2 h is ignored", () => {
    RC.markPendingArm(dir, { now: Date.now() - 3 * 3600_000 });
    expect(run("Edit", { file_path: f("src/a.js") }).code).toBe(0);
    expect(RC.readRawContract(dir)).toBeNull();
  });
});

describe("batch hand-off gate (spec E)", () => {
  test("edits and commits refused, reads and outside paths allowed", () => {
    RC.markBatchHandoff(dir, {});
    const r = run("Edit", { file_path: f("src/a.ts") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Skill("devops:do-run", "--from=do-batch …")');
    expect(run("Bash", { command: "git commit -m x" }).code).toBe(2);
    expect(run("Bash", { command: "git log -1" }).code).toBe(0);
    expect(run("Write", { file_path: path.join(os.tmpdir(), "plan-rc.md") }).code).toBe(0);
  });

  test("a marker older than 6 h is ignored", () => {
    RC.markBatchHandoff(dir, { now: Date.now() - 7 * 3600_000 });
    expect(run("Edit", { file_path: f("src/a.ts") }).code).toBe(0);
  });
});
