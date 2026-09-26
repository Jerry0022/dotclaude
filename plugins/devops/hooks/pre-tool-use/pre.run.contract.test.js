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
const { safeBase } = require("../lib/run-contract-qa.js");
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
  return { code: res.status, stderr: res.stderr || "", stdout: res.stdout || "" };
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
    // AUD-020: only a triage-described (or item-named) agent event satisfies it.
    ev({ k: "agent", type: "Explore", description: "look around" });
    expect(run("Skill", { skill: "devops:auto-agents", args: "x" }).code).toBe(2);
    ev({ k: "agent", type: "Explore", description: "Triage #1 — the queued item" });
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
    // unreadable payload → gated as a final card (red-team C-card-stdin)
    expect(run("Bash", { command: `node index.js --render-card missing.json` }).code).toBe(2);
  });
});

describe("pending-arm fallback (spec B)", () => {
  test("no router answers in the transcript → click-through defaults, said in the block", () => {
    RC.markPendingArm(dir, { args: "backlog" });
    const r = run("Edit", { file_path: f("src/a.js") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("click-through defaults");
    // R16: the fallback note's re-arm replaces this contract → --replace.
    expect(r.stderr).toMatch(/Wrong\? node ".*" arm --mode .* --replace/);
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

describe("AUD-001: a failed fallback arm keeps the pending marker", () => {
  test("arm() write failure (rename onto an existing directory) leaves the marker for the next call to retry", () => {
    RC.markPendingArm(dir, { args: "" });
    // Force arm()'s temp+rename write to fail: the target path is a directory.
    fs.mkdirSync(path.join(dir, ".claude", "run-contract.json"));
    const r = run("Edit", { file_path: f("src/a.js") });
    expect(r.code).toBe(0); // no contract could be armed → not gated (yet)
    expect(fs.existsSync(path.join(dir, ".claude", "run-contract.pending"))).toBe(true);
    expect(RC.readRawContract(dir)).toBeNull();
  });
});

describe("AUD-004: a refused call records a block event", () => {
  test("a gate refusal writes a `block` event that changes neither segments nor obligations", () => {
    armPrompt();
    const before = RC.segments(RC.readContract(dir), RC.events(dir)).length;
    const r = run("Edit", { file_path: f("src/a.js") });
    expect(r.code).toBe(2);
    const evs = RC.events(dir);
    const blockEv = evs.find((e) => e.k === "block");
    expect(blockEv).toMatchObject({ gate: "edit", open: ["auto-agents"] });
    const after = RC.segments(RC.readContract(dir), evs).length;
    expect(after).toBe(before);
    expect(RC.segmentHasWork(RC.currentSegment(RC.readContract(dir), evs))).toBe(false);
  });

  test("the batch hand-off block also records a `block` event when a contract is active", () => {
    armPrompt();
    RC.markBatchHandoff(dir, {});
    const r = run("Edit", { file_path: f("src/a.ts") });
    expect(r.code).toBe(2);
    expect(RC.events(dir).some((e) => e.k === "block" && e.gate === "batch")).toBe(true);
  });
});

describe("RT2-R7: safeBase accepts legal Unicode/symbol branch names, still rejects the unsafe ones", () => {
  test.each([
    ["release/1.2"], ["feat/a+b"], ["user@x"], ["größe"],
  ])("accepted: %s", (name) => {
    expect(safeBase(name)).toBe(name);
  });

  test.each([
    ["--output=x"], ["a..b"], ["-x"],
  ])("rejected: %s", (name) => {
    expect(safeBase(name)).toBe("");
  });
});

describe("AUD-007: an unsafe qa diff base is never trusted", () => {
  test("a base starting with `-` (flag injection) is rejected — auto-detected base used instead, no file written", () => {
    armPrompt({ ship: "auto" });
    ev({ k: "edit" });
    const evil = f("evil-output.txt");
    const r = run(SHIP, { body: "", base: `--output=${evil}` });
    expect(r.code).toBe(2); // still gated (auto-agents/harden/polish/qa/do-ship open) — the point is nothing was written
    expect(fs.existsSync(evil)).toBe(false);
  });
});

describe("harden pass (H-*)", () => {
  const P = require("../lib/run-contract-qa.js");
  const C = require("../lib/run-contract-calls.js");
  const ROUTER = (over = {}) => [
    { header: "Was?", question: "Was soll dieser Run tun?", options: [{ label: "Prompt umsetzen" }, { label: "Backlog" }] },
    { header: "Ablauf?", question: "Bleibst du erreichbar?", options: [] },
    { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [] },
    { header: "Durchgänge?", question: "Welche Durchgänge?", options: [] },
  ].filter(q => !over.only || over.only.includes(q.header));
  const ROUTER_A = (mode = "Prompt umsetzen") => ({ "Was soll dieser Run tun?": mode, "Bleibst du erreichbar?": "Autonom · Ship automatisch",
    "Wie weit darf die Änderung greifen?": "Flexibel", "Welche Durchgänge?": "keine" });
  const line = (at, questions, answers) => JSON.stringify({ type: "user", timestamp: new Date(at).toISOString(), toolUseResult: { questions, answers } });
  const transcript = (...lines) => {
    const t = path.join(dir, ".claude", "t.jsonl");
    fs.writeFileSync(t, `${lines.join("\n")}\n`);
    return t;
  };
  const commitOnBranch = (name, files = ["a.js"]) => {
    git("checkout", "-q", "-b", name);
    for (const n of files) fs.writeFileSync(f(n), "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "x");
  };
  const readyBacklog = () => {
    armBacklog({ passes: [], ship: "manual", presence: false });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
  };

  test("H-B4: 6 new untracked code files in a prompt contract → the card gate names devops:qa", () => {
    armPrompt({ passes: [] });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    fs.mkdirSync(f("src"));
    for (let i = 0; i < 6; i++) fs.writeFileSync(f(`src/n${i}.js`), "1\n");
    const r = run(CARD, { variant: "ready" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("devops:qa");
    expect(RC.events(dir).filter(e => e.k === "measure").pop()).toMatchObject({ codeFiles: 6 });
  });

  test("H-C2a: a router line older than the marker (since cutoff) is ignored → fallback arm", () => {
    RC.markPendingArm(dir, { args: "" });
    const t = transcript(line(Date.now() - 3600_000, ROUTER(), ROUTER_A()));
    expect(run("Edit", { file_path: f("src/a.js") }, { transcript_path: t }).code).toBe(2);
    expect(RC.readContract(dir)).toMatchObject({ source: "fallback" });
  });

  test("H-C2b: follow-up lines after the router are applied (Issues #473 → items)", () => {
    RC.markPendingArm(dir, { args: "" });
    const now = Date.now();
    const t = transcript(
      line(now - 2000, ROUTER(), ROUTER_A("Backlog")),
      line(now - 1000, [{ header: "Issues", question: "Welche Issues?" }], { "Welche Issues?": "#473 fix the thing" }),
    );
    run("Edit", { file_path: f("src/a.js") }, { transcript_path: t });
    expect(RC.readContract(dir)).toMatchObject({ source: "router", mode: "backlog", items: ["473"] });
  });

  test("H-C2c: a partial re-ask as the newest router line merges over the earlier full router answers", () => {
    const now = Date.now();
    const partialQ = ROUTER({ only: ["Umfang?"] }).concat([{ header: "Durchgänge?", question: "Welche Durchgänge?", options: [] }]);
    const t = transcript(
      line(now - 4000, [{ header: "Issues", question: "Welche Issues?" }], { "Welche Issues?": "#1 before the run" }),
      line(now - 3000, ROUTER(), ROUTER_A("Backlog")),
      line(now - 2000, [{ header: "Issues", question: "Welche Issues?" }], { "Welche Issues?": "#473" }),
      line(now - 1000, partialQ, { "Wie weit darf die Änderung greifen?": "Strikt", "Welche Durchgänge?": "Harden danach" }),
    );
    const found = C.routerFromTranscript(t, new Date(now - 10_000).toISOString(), RC);
    expect(found.questions.map(q => q.header)).toEqual(["Umfang?", "Durchgänge?"]);
    expect(found.earlier).toHaveLength(1);
    expect(found.followUps).toHaveLength(1);
    RC.markPendingArm(dir, { args: "" });
    run("Edit", { file_path: f("src/a.js") }, { transcript_path: t });
    // The full answers (backlog · autonomous · ship auto) survive; the re-ask
    // replaces only what it answered (strict, passes); the follow-up after
    // the full router applies, the one before it does not.
    expect(RC.readContract(dir)).toMatchObject({
      source: "router", mode: "backlog", flow: "autonomous", ship: "auto", strict: true, passes: ["harden"], items: ["473"],
    });
  });

  test("H-C2c: a partial router line with no full one before it still arms from the partial alone", () => {
    const now = Date.now();
    const t = transcript(line(now - 1000, ROUTER({ only: ["Umfang?", "Durchgänge?"] }),
      { "Wie weit darf die Änderung greifen?": "Strikt", "Welche Durchgänge?": "keine" }));
    expect(C.routerFromTranscript(t, new Date(now - 10_000).toISOString(), RC).earlier).toEqual([]);
    RC.markPendingArm(dir, { args: "" });
    run("Edit", { file_path: f("src/a.js") }, { transcript_path: t });
    expect(RC.readContract(dir)).toMatchObject({ source: "router", strict: true, flow: "interactive", passes: [] });
  });

  test("H-C3: resolveBase — explicit safe base, origin/HEAD, then main / master", () => {
    expect(P.resolveBase(dir, "dev", C)).toBe("dev");
    expect(P.resolveBase(dir, undefined, C)).toBe("main");
    git("update-ref", "refs/remotes/origin/trunk", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    expect(P.resolveBase(dir, undefined, C)).toBe("trunk");
  });

  test("H-C3: an unsafe explicit base (--output=x, a..b) falls back to auto-detect (AUD-007)", () => {
    expect(P.resolveBase(dir, "--output=x", C)).toBe("main");
    expect(P.resolveBase(dir, "a..b", C)).toBe("main");
  });

  test("H-C3: a repo created on master, no base → master fallback → exit 2 naming devops:qa", () => {
    git("branch", "-m", "main", "master");
    expect(P.resolveBase(dir, undefined, C)).toBe("master");
    readyBacklog();
    commitOnBranch("fix/m");
    const r = run(SHIP, { body: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("devops:qa");
  });

  test("H-C3: a repo on master with origin/HEAD → origin/master...HEAD → exit 2 naming devops:qa", () => {
    git("branch", "-m", "main", "master");
    git("update-ref", "refs/remotes/origin/master", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
    readyBacklog();
    commitOnBranch("fix/o");
    const r = run(SHIP, { body: "", base: "--output=x" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("devops:qa");
  });

  test("H-C3: origin/<b>...HEAD missing → <b>...HEAD; non-release gates add the working-tree files", () => {
    commitOnBranch("fix/c", ["a.js"]);
    expect(P.codeFilesChanged(dir, "release", "main")).toBe(1);
    fs.writeFileSync(f("a.js"), "2\n"); // tracked, modified, uncommitted
    fs.writeFileSync(f("b.js"), "1\n"); // untracked (H-B4)
    expect(P.codeFilesChanged(dir, "release", "main")).toBe(1);
    expect(P.codeFilesChanged(dir, "card", "main")).toBe(2);
    git("rm", "-q", "--cached", "a.js");
    git("commit", "-q", "-m", "drop");
    fs.writeFileSync(f("c.js"), "1\n");
    expect(P.codeFilesChanged(dir, "branch", "main")).toBe(3); // a.js (untracked again), b.js, c.js
    expect(P.codeFilesChanged(dir, "card", "no-such-base")).toBeNull();
  });
});

describe("RT3: red-team pass 3 (pre)", () => {
  const P = require("../lib/run-contract-qa.js");
  const withWork = (over = {}) => { armPrompt({ ship: "auto", passes: [], ...over }); ev({ k: "skill", name: "auto-agents" }); ev({ k: "edit" }); };
  const MERGE = "mcp__plugin_github_github__merge_pull_request";

  test("RT3-R4: a push of the current branch is a release only on main / master under ship: auto", () => {
    withWork();
    for (const command of ["git push", "git push origin HEAD", "git push -u origin HEAD"]) {
      const r = run("Bash", { command });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("BLOCKED at release");
    }
    git("checkout", "-q", "-b", "feat/x");
    expect(run("Bash", { command: "git push -u origin HEAD" }).code).toBe(0);
    expect(run("Bash", { command: "git push" }).code).toBe(0);
  });

  test("RT3-R4: pushHead on main is not gated under ship: manual; do-ship clears it under auto", () => {
    withWork({ ship: "manual" });
    expect(run("Bash", { command: "git push" }).code).toBe(0);
    withWork();
    expect(RC.readContract(dir)).toMatchObject({ ship: "auto" });
    expect(run("Bash", { command: "git push" }).code).toBe(2);
    ev({ k: "skill", name: "do-ship" });
    expect(run("Bash", { command: "git push" }).code).toBe(0);
  });

  test("RT3-R4: gh api PUT …/merge and a forced push onto main are releases", () => {
    withWork();
    expect(run("Bash", { command: "gh api -X PUT repos/o/r/pulls/7/merge" }).code).toBe(2);
    expect(run("PowerShell", { command: "gh api --method PUT repos/o/r/pulls/7/merge" }).code).toBe(2);
    expect(run("Bash", { command: "git push origin +main" }).code).toBe(2);
    expect(run("Bash", { command: "gh api repos/o/r/pulls/7" }).code).toBe(0);
  });

  test("RT3-R4: a GitHub MCP merge_pull_request call hits the release gate under ship: auto only", () => {
    withWork();
    const r = run(MERGE, { owner: "o", repo: "r", pullNumber: 7 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("BLOCKED at release");
    expect(run("mcp__github__merge_pull_request", { pullNumber: 7 }).code).toBe(2);
    expect(run("mcp__plugin_github_github__get_pull_request", { pullNumber: 7 }).code).toBe(0);
    withWork({ ship: "manual" });
    expect(RC.readContract(dir)).toMatchObject({ ship: "manual" });
    expect(run(MERGE, { pullNumber: 7 }).code).toBe(0);
  });

  test("RT3-R5: the PowerShell tool reads backticks as escapes (no false release)", () => {
    withWork();
    expect(run("PowerShell", { command: 'gh issue comment 12 --body "merged via `gh pr merge 480`"' }).code).toBe(0);
    expect(run("Bash", { command: "cat > f.md <<'EOF'\nrun `gh pr merge` and `git push origin main`\nEOF" }).code).toBe(0);
    expect(run("Bash", { command: 'echo "$(gh pr merge 480)"' }).code).toBe(2);
  });

  test("RT3-R6: a failing ls-files keeps the diff count", () => {
    const gitLines = (root, args) => {
      if (args[0] === "ls-files") throw new Error("timeout");
      if (args[0] === "diff" && args[2] === "HEAD") return ["b.js"];
      return ["a.js", "README.md"];
    };
    expect(P.codeFilesChanged(dir, "card", "main", gitLines)).toBe(2);
    expect(P.codeFilesChanged(dir, "release", "main", gitLines)).toBe(1);
    const failDiff = () => { throw new Error("git gone"); };
    expect(P.codeFilesChanged(dir, "card", "main", failDiff)).toBeNull();
    const ok = (root, args) => (args[0] === "ls-files" ? ["c.js"] : []);
    expect(P.codeFilesChanged(dir, "card", "main", ok)).toBe(1);
  });
});

describe("H1: heavy libs load lazily, inside main()'s own try (H-B17)", () => {
  test("requiring pre.run.contract.js at module scope never pulls in run-contract-qa.js / git-timeout.js", () => {
    const script = `
      const p = require(${JSON.stringify(HOOK)});
      const keys = Object.keys(require.cache);
      process.stdout.write(JSON.stringify({
        hasQa: keys.some(k => k.endsWith("run-contract-qa.js")),
        hasGitTimeout: keys.some(k => k.endsWith("git-timeout.js")),
        hasArmFromPending: typeof p.armFromPending === "function",
      }));
    `;
    const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hasQa).toBe(false);
    expect(out.hasGitTimeout).toBe(false);
    expect(out.hasArmFromPending).toBe(true);
  });
});

describe("R5: the corrupt-quarantine notice is delivered even when run-contract.json is gone", () => {
  test("the marker alone (no run-contract.json / pending / batch-handoff) still reaches the notice, once", () => {
    // Simulates the state right after a quarantine: only the marker is left
    // on disk. Before the fix, hasState() only checked run-contract.json /
    // .pending / batch-handoff.json, so this call returned 0 before ever
    // reading the marker.
    fs.writeFileSync(f(".claude/run-contract.json.corrupt.pending"), "", "utf8");
    const r1 = run("Edit", { file_path: f("src/a.js") }, { session_id: "s" });
    expect(r1.code).toBe(0);
    expect(r1.stdout).toContain("quarantined");
    expect(r1.stdout).toContain("run-contract.json.corrupt");
    // One-shot: the marker is consumed, a second call gets nothing.
    const r2 = run("Edit", { file_path: f("src/b.js") }, { session_id: "s" });
    expect(r2.stdout).toBe("");
  });

  test("H9: the SAME call whose own readContract() quarantines a corrupt header returns the notice, not the next one", () => {
    armPrompt({ passes: [] });
    ev({ k: "skill", name: "auto-agents" });
    ev({ k: "edit" });
    // Hand-corrupt the live header — a gated call's own RC.readContract()
    // below discovers this and quarantines it (AUD-022) during this same
    // invocation, not before.
    fs.writeFileSync(f(".claude/run-contract.json"), "{not json", "utf8");
    const r1 = run("Edit", { file_path: f("src/a.js") }, { session_id: "s" });
    expect(r1.code).toBe(0); // no contract left to gate against
    expect(r1.stdout).toContain("quarantined");
    expect(r1.stdout).toContain("run-contract.json.corrupt");
    // One-shot: the very next call gets nothing more.
    const r2 = run("Edit", { file_path: f("src/b.js") }, { session_id: "s" });
    expect(r2.stdout).toBe("");
  });
});
