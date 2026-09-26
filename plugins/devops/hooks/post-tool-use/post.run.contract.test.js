import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const RC = require("../lib/run-contract.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.run.contract.js");
const SHIP = "mcp__plugin_devops_dotclaude-ship__ship_release";
const CARD = "mcp__plugin_devops_dotclaude-completion__render_completion_card";
const ENV = { ...process.env };
delete ENV.DOTCLAUDE_RUN_CONTRACT;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-post-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, ".claude"));
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function run(tool_name, tool_input, tool_response = {}, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, session_id: "s", hook_event_name: "PostToolUse", tool_name, tool_input, tool_response }),
    cwd: dir, encoding: "utf8", env: { ...ENV, ...env },
  });
  return { code: res.status, stdout: res.stdout || "" };
}
const kinds = () => RC.events(dir).map(e => e.k);

const ROUTER_Q = [
  { header: "Was?", question: "Was soll dieser Run tun?", options: [{ label: "Prompt umsetzen" }, { label: "Audit" }, { label: "Backlog" }] },
  { header: "Ablauf?", question: "Bleibst du erreichbar?", options: [{ label: "Interaktiv · Ship manuell" }, { label: "Autonom · Ship automatisch" }] },
  { header: "Umfang?", question: "Wie weit?", options: [{ label: "Strikt" }, { label: "Flexibel" }] },
  { header: "Durchgänge?", question: "Welche Durchgänge?", options: [{ label: "Harden danach (Recommended)" }, { label: "Polish danach (Recommended)" }] },
];

describe("arming", () => {
  test("Skill do-run writes the arm marker with its args; router answers arm and clear it", () => {
    run("Skill", { skill: "devops:do-run", args: "audit" });
    expect(RC.pendingArm(dir)).toMatchObject({ args: "audit", sessionId: "s" });
    const r = run("AskUserQuestion", { questions: ROUTER_Q }, { answers: {
      "Was soll dieser Run tun?": "Prompt umsetzen", "Bleibst du erreichbar?": "Autonom · Ship automatisch",
      "Wie weit?": "Flexibel", "Welche Durchgänge?": ["Polish danach (Recommended)"] } });
    expect(r.stdout).toBe("");
    expect(RC.readContract(dir)).toMatchObject({ source: "router", mode: "prompt", flow: "autonomous", ship: "auto", passes: ["polish"], sessionId: "s" });
    expect(RC.pendingArm(dir)).toBeNull();
  });

  test("follow-up answers update the active contract", () => {
    RC.arm(dir, { mode: "backlog" });
    run("AskUserQuestion", { questions: [{ header: "Issues", question: "Welche Issues?" }] }, { answers: { "Welche Issues?": "#12 a, #13 b" } });
    expect(RC.readContract(dir).items).toEqual(["12", "13"]);
  });

  test("an unrelated AskUserQuestion changes nothing", () => {
    run("AskUserQuestion", { questions: [{ header: "Farbe", question: "Welche Farbe?" }] }, { answers: { "Welche Farbe?": "rot" } });
    expect(RC.readRawContract(dir)).toBeNull();
  });

  test("kill switch: no marker, no arm", () => {
    run("Skill", { skill: "devops:do-run", args: "" }, {}, { DOTCLAUDE_RUN_CONTRACT: "off" });
    expect(fs.existsSync(RC.pendingPath(dir))).toBe(false);
  });
});

describe("recording", () => {
  beforeEach(() => RC.arm(dir, { mode: "prompt", ship: "auto" }));

  test("skill, agent, edit (deduped), commit, branch", () => {
    run("Skill", { skill: "devops:tune-harden", args: "--invoked-by=do-run" });
    run("Agent", { subagent_type: "devops:qa", prompt: "x" });
    run("Agent", { prompt: "x" });
    run("Edit", { file_path: path.join(dir, "src/a.js") });
    run("Write", { file_path: path.join(dir, "src/b.js") });
    run("Write", { file_path: path.join(dir, ".claude/x.md") });
    run("Bash", { command: 'git add -A && git commit -m "x"' });
    run("PowerShell", { command: "git switch -c feat/x" });
    const evs = RC.events(dir);
    expect(evs.map(e => e.k)).toEqual(["skill", "agent", "agent", "edit", "commit", "branch"]);
    expect(evs[0]).toMatchObject({ name: "auto-harden", args: "--invoked-by=do-run" });
    expect(evs[1].type).toBe("devops:qa");
    expect(evs[2].type).toBe("general-purpose");
    expect(evs[5].name).toBe("feat/x");
  });

  test("ship_release result and closes are recorded", () => {
    run(SHIP, { body: "Closes #7\nfixes #8" }, [{ type: "text", text: JSON.stringify({ success: true, merged: false }) }]);
    run(SHIP, { body: "" }, { content: [{ type: "text", text: "boom" }] });
    const [a, b] = RC.events(dir);
    expect(a).toMatchObject({ k: "release", ok: true, merged: false, closes: ["7", "8"] });
    expect(b).toMatchObject({ k: "release", ok: false });
  });

  test("a final card closes a prompt contract; a pending card does not", () => {
    run(CARD, { variant: "ready", pending: ["verify on device"] });
    expect(RC.readContract(dir)).not.toBeNull();
    run(CARD, { variant: "ship-successful" });
    expect(RC.readContract(dir)).toBeNull();
    expect(RC.readContractForCard(dir).closeReason).toContain("final card");
  });

  test("offline renderer payload is recorded as a card", () => {
    const p = path.join(dir, ".claude", "c.json");
    fs.writeFileSync(p, JSON.stringify({ variant: "ready" }));
    run("Bash", { command: `node x/mcp-server/index.js --render-card ${p}` });
    expect(RC.readContract(dir)).toBeNull();
  });

  test("Skill do-run / auto-concept delete the batch hand-off marker", () => {
    RC.markBatchHandoff(dir, {});
    run("Skill", { skill: "devops:auto-issue" });
    expect(fs.existsSync(RC.batchHandoffPath(dir))).toBe(true);
    run("Skill", { skill: "devops:auto-concept", args: "--from=do-batch" });
    expect(fs.existsSync(RC.batchHandoffPath(dir))).toBe(false);
  });
});

describe("backlog closing", () => {
  test("a final card does not close backlog; the last item's release does", () => {
    RC.arm(dir, { mode: "backlog", items: ["1", "2"] });
    run(CARD, { variant: "ship-successful" });
    expect(RC.readContract(dir)).not.toBeNull();
    const ok = [{ type: "text", text: '{"success":true,"merged":true}' }];
    run(SHIP, { body: "Closes #1" }, ok);
    expect(RC.readContract(dir)).not.toBeNull();
    RC.record(dir, { k: "park", item: "2", reason: "duplicate" });
    run(SHIP, { body: "Closes #3" }, ok);
    expect(RC.readContract(dir)).toBeNull();
  });
});

describe("one-time announcement", () => {
  test("fallback / machine contracts are announced once", () => {
    RC.arm(dir, { source: "fallback", mode: "backlog" });
    const first = run("Agent", { subagent_type: "Explore" });
    const ctx = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("click-through defaults");
    expect(ctx).toContain("run-contract.js\" arm --mode");
    // R16: re-arming replaces this live contract — the CLI needs --replace for that.
    expect(ctx).toMatch(/Re-arm: node ".*" arm --mode .* --replace\n/);
    expect(ctx).toContain("done");
    expect(RC.readContract(dir).announced).toBe(true);
    expect(run("Agent", { subagent_type: "Explore" }).stdout).toBe("");
    expect(kinds()).toEqual(["agent", "agent"]);
  });

  test("router contracts are never announced", () => {
    RC.arm(dir, { source: "router" });
    expect(run("Agent", { subagent_type: "Explore" }).stdout).toBe("");
  });
});

describe("harden pass (H-*)", () => {
  const P = require("./post.run.contract.js");
  const ok = [{ type: "text", text: '{"success":true,"merged":true}' }];
  const FLOW_SCOPE = [
    { header: "Flow", question: "Stay reachable?", options: [{ label: "Interaktiv · Ship manuell" }] },
    { header: "Scope", question: "How far?", options: [{ label: "Strikt" }, { label: "Flexibel" }] },
  ];
  const FLOW_SCOPE_A = { "Stay reachable?": "Interaktiv · Ship manuell", "How far?": "Strikt" };

  test("H-E17: the module exports its handlers and does not read stdin when required", () => {
    expect(typeof P.main).toBe("function");
    expect(P.backlogFinished({ mode: "backlog", items: ["1"] }, [{ k: "park", item: "1" }])).toBe(true);
    expect(P.backlogFinished({ mode: "prompt", items: ["1"] }, [{ k: "park", item: "1" }])).toBe(false);
  });

  test("H-B8: a final card closes the contract even when its event append failed", () => {
    const closed = [];
    const fake = { record: () => null, readContract: () => ({ mode: "prompt" }), close: (r, why) => closed.push(why) };
    P.recordCard(dir, "ready", true, fake, {});
    expect(closed).toEqual(["done: final card"]);
    P.recordCard(dir, "ready", false, fake, {});
    expect(closed).toHaveLength(1);
    const backlog = { ...fake, readContract: () => ({ mode: "backlog" }) };
    P.recordCard(dir, "ready", true, backlog, {});
    expect(closed).toHaveLength(1);
  });

  test("H-B3 / RT3-R2: an unreadable --render-card payload is recorded but does not close a run without work", () => {
    RC.arm(dir, { mode: "prompt" });
    run("Bash", { command: "cd sub && node x/mcp-server/index.js --render-card card.json" });
    expect(RC.readContract(dir)).not.toBeNull();
    expect(RC.events(dir)).toEqual([expect.objectContaining({ k: "card", variant: null })]);
  });

  test("H-B13: Flow + Scope without a do-run marker arms nothing", () => {
    run("AskUserQuestion", { questions: FLOW_SCOPE }, { answers: FLOW_SCOPE_A });
    expect(RC.readRawContract(dir)).toBeNull();
  });

  test("H-B13: Passes alone without a marker arms nothing", () => {
    run("AskUserQuestion", { questions: [{ header: "Passes", question: "Which passes?", options: [{ label: "Harden danach" }] }] },
      { answers: { "Which passes?": "Harden danach" } });
    expect(RC.readRawContract(dir)).toBeNull();
  });

  test("H-B13: Flow + Scope after a do-run (fresh same-session marker) arms", () => {
    RC.markPendingArm(dir, { sessionId: "s", args: "" });
    run("AskUserQuestion", { questions: FLOW_SCOPE }, { answers: FLOW_SCOPE_A });
    expect(RC.readContract(dir)).toMatchObject({ source: "router", strict: true });
    expect(RC.pendingArm(dir)).toBeNull();
  });

  test("H-B13: a full router call without a marker still arms", () => {
    run("AskUserQuestion", { questions: ROUTER_Q }, { answers: {
      "Was soll dieser Run tun?": "Prompt umsetzen", "Bleibst du erreichbar?": "Autonom · Ship automatisch",
      "Wie weit?": "Flexibel", "Welche Durchgänge?": ["Polish danach (Recommended)"] } });
    expect(RC.readContract(dir)).toMatchObject({ source: "router", flow: "autonomous", passes: ["polish"] });
  });

  test("H-B13: a partial call within 30 min of this session's contract merges (no marker needed)", () => {
    RC.arm(dir, { mode: "prompt", flow: "autonomous", ship: "auto", strict: false, sessionId: "s" });
    run("AskUserQuestion", { questions: FLOW_SCOPE }, { answers: FLOW_SCOPE_A });
    expect(RC.readContract(dir)).toMatchObject({ mode: "prompt", flow: "interactive", ship: "manual", strict: true });
  });

  test("C3/AUD-001: arm() write failure (target blocked by a directory) leaves the pending marker for a retry", () => {
    RC.markPendingArm(dir, { sessionId: "s", args: "" });
    // Force arm()'s temp+rename write to fail: the target path is a directory.
    fs.mkdirSync(path.join(dir, ".claude", "run-contract.json"));
    run("AskUserQuestion", { questions: ROUTER_Q }, { answers: {
      "Was soll dieser Run tun?": "Prompt umsetzen", "Bleibst du erreichbar?": "Autonom · Ship automatisch",
      "Wie weit?": "Flexibel", "Welche Durchgänge?": ["Polish danach (Recommended)"] } });
    expect(RC.readRawContract(dir)).toBeNull();
    expect(RC.pendingArm(dir)).toMatchObject({ sessionId: "s" });
  });

  test("H-C5: a ship_release acting on tool_input.cwd records its release there", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "rc-post-other-"));
    try {
      fs.mkdirSync(path.join(other, ".git"));
      RC.arm(other, { mode: "prompt", sessionId: "s" });
      run(SHIP, { cwd: other, body: "Closes #1" }, ok);
      expect(RC.events(other)).toEqual([expect.objectContaining({ k: "release", ok: true, closes: ["1"] })]);
      expect(fs.existsSync(RC.eventsPath(dir))).toBe(false);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  test("H-C5: items [1,2], park 2, then release Closes #1 closes the backlog", () => {
    RC.arm(dir, { mode: "backlog", items: ["1", "2"] });
    RC.record(dir, { k: "park", item: "2", reason: "blocked" });
    run(SHIP, { body: "Closes #1" }, ok);
    expect(RC.readContract(dir)).toBeNull();
  });

  test("H-C5: the last item parked AFTER the final release closes the backlog on the park call", () => {
    RC.arm(dir, { mode: "backlog", items: ["1", "2"] });
    run(SHIP, { body: "Closes #1" }, ok);
    expect(RC.readContract(dir)).not.toBeNull();
    RC.record(dir, { k: "park", item: "2", reason: "blocked" });
    run("Bash", { command: 'node "x/hooks/lib/run-contract.js" park 2 --reason "blocked"' });
    expect(RC.readContract(dir)).toBeNull();
    expect(RC.readContractForCard(dir).closeReason).toContain("every queued item");
  });
});

describe("red-team pass 3 (RT3-*)", () => {
  const ok = [{ type: "text", text: '{"success":true,"merged":true}' }];
  const LIB = 'node "x/hooks/lib/run-contract.js"';
  const PASSES_Q = [{ header: "Durchgänge?", question: "Welche Durchgänge?", options: [{ label: "Harden danach" }, { label: "Polish danach" }] }];
  const ctxOf = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "");

  test("RT3-R1: skip refine --item 12 and --item 13 before building leave the backlog open", () => {
    RC.arm(dir, { mode: "backlog", items: ["12", "13"], sessionId: "s" });
    RC.record(dir, { k: "skip", ob: "refine", item: "12", reason: "clear" });
    run("Bash", { command: `${LIB} skip refine --item 12 --reason "clear"` });
    RC.record(dir, { k: "skip", ob: "refine", item: "13", reason: "clear" });
    run("Bash", { command: `${LIB} skip refine --item 13 --reason "clear"` });
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("RT3-R1: skip qa --item 13 does not finish item 13", () => {
    RC.arm(dir, { mode: "backlog", items: ["12", "13"], sessionId: "s" });
    run(SHIP, { body: "Closes #12" }, ok);
    RC.record(dir, { k: "skip", ob: "qa", item: "13", reason: "docs only" });
    run("Bash", { command: `${LIB} skip qa --item 13 --reason "docs only"` });
    expect(RC.readContract(dir)).not.toBeNull();
    expect(P_backlogFinished({ mode: "backlog", items: ["13"] }, [{ k: "skip", ob: "refine", item: "13" }])).toBe(false);
  });

  test("RT3-R1: a release closing #12 plus park 13 closes the backlog", () => {
    RC.arm(dir, { mode: "backlog", items: ["12", "13"], sessionId: "s" });
    run(SHIP, { body: "Closes #12" }, ok);
    expect(RC.readContract(dir)).not.toBeNull();
    RC.record(dir, { k: "park", item: "13", reason: "blocked" });
    run("Bash", { command: `${LIB} park 13 --reason "blocked"` });
    expect(RC.readContract(dir)).toBeNull();
  });

  test("RT3-R2: an interim card via $p or stdin before any work keeps the run open", () => {
    RC.arm(dir, { mode: "prompt", sessionId: "s" });
    run("PowerShell", { command: "node x/mcp-server/index.js --render-card $p" });
    run("Bash", { command: "echo '{}' | node x/mcp-server/index.js --render-card -" });
    expect(RC.readContract(dir)).not.toBeNull();
    expect(kinds()).toEqual(["card", "card"]);
  });

  test("RT3-R2: a readable non-final payload deleted in the same command keeps an audit run open", () => {
    RC.arm(dir, { mode: "audit", sessionId: "s" });
    run("PowerShell", { command: "node x/mcp-server/index.js --render-card .claude/card.json; Remove-Item .claude/card.json" });
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("RT3-R2: an unreadable card closes only with work done and nothing open at the card gate", () => {
    const work = () => {
      RC.record(dir, { k: "skill", name: "auto-agents", args: "" });
      RC.record(dir, { k: "edit" });
    };
    RC.arm(dir, { mode: "prompt", passes: ["harden"], ship: "manual", sessionId: "s" });
    work();
    run("Bash", { command: "node x/mcp-server/index.js --render-card -" });
    expect(RC.readContract(dir)).not.toBeNull();
    RC.arm(dir, { mode: "prompt", passes: [], ship: "manual", sessionId: "s" });
    work();
    expect(RC.openObligations(RC.readContract(dir), RC.events(dir), "card")).toEqual([]);
    run("Bash", { command: "node x/mcp-server/index.js --render-card -" });
    expect(RC.readContract(dir)).toBeNull();
    expect(RC.readContractForCard(dir).closeReason).toContain("final card");
  });

  test("RT3-R8: a Passes-only re-ask 40 min after arming merges into the active contract", () => {
    const a = RC.arm(dir, { mode: "prompt", passes: [], sessionId: "s" }, { now: Date.now() - 40 * 60_000 });
    const r = run("AskUserQuestion", { questions: PASSES_Q }, { answers: { "Welche Durchgänge?": "Harden danach" } });
    expect(r.stdout).toBe("");
    expect(RC.readContract(dir)).toMatchObject({ id: a.id, passes: ["harden"] });
  });

  test("RT3-R8: a partial call after a do-run arms a new contract even over an active one", () => {
    const a = RC.arm(dir, { mode: "prompt", passes: [], sessionId: "s" });
    RC.markPendingArm(dir, { sessionId: "s", args: "" });
    run("AskUserQuestion", { questions: PASSES_Q }, { answers: { "Welche Durchgänge?": "Harden danach" } });
    const h = RC.readContract(dir);
    expect(h.id).not.toBe(a.id);
    expect(h).toMatchObject({ source: "router", passes: ["harden"] });
    expect(RC.pendingArm(dir)).toBeNull();
  });

  test("RT3-R8: a partial call with no marker and no active contract is not recorded and says so", () => {
    const r = run("AskUserQuestion", { questions: PASSES_Q }, { answers: { "Welche Durchgänge?": "Harden danach" } });
    expect(RC.readRawContract(dir)).toBeNull();
    const ctx = ctxOf(r);
    expect(ctx).toContain("NOT recorded");
    expect(ctx).toContain("run-contract.js\" arm --mode");
    // R16: no live contract of this session to replace — the plain arm line.
    expect(ctx).not.toContain("--replace");
  });

  test("RT3-X1: an interrupted or non-zero-exit git commit / branch is not recorded", () => {
    RC.arm(dir, { mode: "prompt", sessionId: "s" });
    run("Bash", { command: 'git commit -m "x"' }, { stdout: "", stderr: "", interrupted: true });
    run("Bash", { command: 'git commit -m "x"' }, { exit_code: 1, stdout: "nothing to commit" });
    run("PowerShell", { command: "git switch -c feat/x" }, { exitCode: 128 });
    expect(kinds()).toEqual([]);
    run("Bash", { command: 'git commit -m "x"' }, { stdout: "[main abc] x", stderr: "", interrupted: false });
    expect(kinds()).toEqual(["commit"]);
  });

  test("RT3-X2: this session's contract expired without work is announced once", () => {
    RC.arm(dir, { mode: "prompt", flow: "interactive", sessionId: "s" }, { now: Date.now() - 13 * 3600_000 });
    const first = ctxOf(run("Write", { file_path: path.join(dir, ".claude/x.md") }));
    expect(first).toContain("expired after 12 h");
    expect(first).toContain("arm --mode");
    expect(first).toContain("--replace"); // R16: every re-arm line carries it
    expect(run("Write", { file_path: path.join(dir, ".claude/x.md") }).stdout).toBe("");
  });

  test("RT3-X2: another session's expired contract is not announced", () => {
    RC.arm(dir, { mode: "prompt", sessionId: "other" }, { now: Date.now() - 13 * 3600_000 });
    expect(run("Write", { file_path: path.join(dir, ".claude/x.md") }).stdout).toBe("");
  });
});

describe("R1: an analysis card closes an AUDIT run only when nothing is left open", () => {
  test("open harden obligation: stays open", () => {
    RC.arm(dir, { mode: "audit", passes: ["harden"], ship: "manual", sessionId: "s" });
    RC.record(dir, { k: "edit" });
    run(CARD, { variant: "analysis" });
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("non-empty pending: stays open", () => {
    RC.arm(dir, { mode: "audit", passes: [], ship: "manual", sessionId: "s" });
    RC.record(dir, { k: "edit" });
    run(CARD, { variant: "analysis", pending: ["one more pass"] });
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("open concept hand-off: stays open", () => {
    RC.arm(dir, { mode: "audit", passes: [], ship: "manual", sessionId: "s" });
    RC.record(dir, { k: "edit" });
    run(CARD, { variant: "analysis", concept: { title: "next" } });
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("a no-work audit run closes", () => {
    RC.arm(dir, { mode: "audit", passes: [], ship: "manual", sessionId: "s" });
    run(CARD, { variant: "analysis" });
    expect(RC.readContract(dir)).toBeNull();
  });
});

const P_backlogFinished = (h, evs) => require("./post.run.contract.js").backlogFinished(h, evs);

test("no contract: Edit/Bash are a no-op and write nothing", () => {
  run("Edit", { file_path: path.join(dir, "a.js") });
  run("Bash", { command: "git commit -m x" });
  expect(fs.readdirSync(path.join(dir, ".claude"))).toEqual([]);
});
