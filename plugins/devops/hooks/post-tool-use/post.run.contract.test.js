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
    RC.record(dir, { k: "skip", ob: "refine", item: "2", reason: "duplicate" });
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

test("no contract: Edit/Bash are a no-op and write nothing", () => {
  run("Edit", { file_path: path.join(dir, "a.js") });
  run("Bash", { command: "git commit -m x" });
  expect(fs.readdirSync(path.join(dir, ".claude"))).toEqual([]);
});
