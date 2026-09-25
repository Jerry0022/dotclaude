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
const HOOK = path.join(__dirname, "prompt.run.contract.js");
const ENV = { ...process.env };
delete ENV.DOTCLAUDE_RUN_CONTRACT;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-prompt-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, ".claude"));
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function run(prompt, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, session_id: "s", prompt }), cwd: dir, encoding: "utf8", env: { ...ENV, ...env },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

describe("prompt.run.contract", () => {
  test("RUN_BACKLOG_AUTOSTART arms a machine contract, silently", () => {
    const r = run("RUN_BACKLOG_AUTOSTART: ship=auto passes=harden strict=off queue=473,474 phase=presence");
    expect(r).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(RC.readContract(dir)).toMatchObject({
      source: "machine", mode: "backlog", flow: "autonomous", ship: "auto", passes: ["harden"], items: ["473", "474"], presence: false,
    });
  });

  test("AUTONOMOUS_AUTOSTART arms prompt mode", () => {
    run("AUTONOMOUS_AUTOSTART: ship=manual passes=none");
    expect(RC.readContract(dir)).toMatchObject({ mode: "prompt", flow: "autonomous", ship: "manual", passes: [] });
  });

  test("a repeated prompt refreshes in place: id and events kept", () => {
    run("RUN_BACKLOG_AUTOSTART: ship=auto queue=1");
    const first = RC.readContract(dir);
    RC.record(dir, { k: "edit" });
    run("RUN_BACKLOG_AUTOSTART: ship=auto queue=1,2");
    const next = RC.readContract(dir);
    expect(next.id).toBe(first.id);
    expect(next.items).toEqual(["1", "2"]);
    expect(RC.events(dir)).toHaveLength(1);
  });

  test("refreshing a router contract keeps its source", () => {
    RC.arm(dir, { source: "router", mode: "backlog" });
    run("RUN_BACKLOG_AUTOSTART: ship=auto");
    expect(RC.readContract(dir).source).toBe("router");
  });

  test("ordinary prompts and the kill switch do nothing", () => {
    run("mach mal RUN_BACKLOG_AUTOSTART: nicht");
    run("RUN_BACKLOG_AUTOSTART: ship=auto", { DOTCLAUDE_RUN_CONTRACT: "off" });
    expect(RC.readRawContract(dir)).toBeNull();
  });
});

describe("AUD-002: a typed devops slash command records a skill event", () => {
  test("typed /auto-harden on an active contract records a skill event", () => {
    RC.arm(dir, { mode: "prompt" }, { sessionId: "s" });
    const r = run("/auto-harden --invoked-by=do-run");
    expect(r).toMatchObject({ code: 0, stdout: "" });
    const evs = RC.events(dir);
    expect(evs).toContainEqual(expect.objectContaining({ k: "skill", name: "auto-harden", args: "--invoked-by=do-run" }));
  });

  test("devops:do-ship prefix form and the harness <command-name> form both record", () => {
    RC.arm(dir, { mode: "backlog" }, { sessionId: "s" });
    run("/devops:do-ship --queued=1/1");
    expect(RC.events(dir)).toContainEqual(expect.objectContaining({ k: "skill", name: "do-ship" }));

    RC.arm(dir, { mode: "backlog" }, { sessionId: "s" });
    run("<command-name>/devops:auto-agents</command-name><command-args>--from=do-run #473</command-args>");
    expect(RC.events(dir)).toContainEqual(expect.objectContaining({ k: "skill", name: "auto-agents", args: "--from=do-run #473" }));
  });

  test("no active contract → no event, no crash", () => {
    const r = run("/auto-polish");
    expect(r.code).toBe(0);
    expect(RC.readRawContract(dir)).toBeNull();
  });

  test("a non-devops typed slash command is ignored", () => {
    const r = run("/help");
    expect(r).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(fs.readdirSync(path.join(dir, ".claude"))).toEqual([]);
  });
});

describe("AUD-003: a typed do-run / auto-concept clears a pending batch hand-off", () => {
  test("typed /do-run clears the marker", () => {
    RC.markBatchHandoff(dir, { sessionId: "s" });
    run("/do-run backlog");
    expect(RC.batchHandoffPending(dir, { sessionId: "s" })).toBeNull();
  });

  test("typed /auto-concept clears the marker", () => {
    RC.markBatchHandoff(dir, { sessionId: "s" });
    run("/auto-concept --from=do-batch some idea");
    expect(RC.batchHandoffPending(dir, { sessionId: "s" })).toBeNull();
  });

  test("an unrelated typed command leaves the marker alone", () => {
    RC.markBatchHandoff(dir, { sessionId: "s" });
    run("/auto-harden");
    expect(RC.batchHandoffPending(dir, { sessionId: "s" })).toBeTruthy();
  });
});

describe("RT2-R2: the <command-name> tag only counts when it opens the prompt", () => {
  test("a <command-name> tag pasted mid-prompt (e.g. a quoted transcript excerpt) records no event, clears no hand-off, arms no marker", () => {
    RC.arm(dir, { mode: "backlog" }, { sessionId: "s" });
    RC.markBatchHandoff(dir, { sessionId: "s" });
    const r = run(
      'here is what happened: <command-name>/devops:do-ship</command-name><command-args>--queued=1/1</command-args>',
    );
    expect(r.code).toBe(0);
    expect(RC.events(dir)).not.toContainEqual(expect.objectContaining({ k: "skill", name: "do-ship" }));
    expect(RC.batchHandoffPending(dir, { sessionId: "s" })).toBeTruthy();
  });

  test("a foreign plugin prefix on the tag form is never counted as ours", () => {
    RC.arm(dir, { mode: "backlog" }, { sessionId: "s" });
    run("<command-name>/other:do-ship</command-name><command-args>x</command-args>");
    expect(RC.events(dir)).not.toContainEqual(expect.objectContaining({ k: "skill", name: "do-ship" }));
  });

  test("a leading tag still records (regression guard)", () => {
    RC.arm(dir, { mode: "backlog" }, { sessionId: "s" });
    run("<command-name>/devops:do-ship</command-name><command-args>--queued=1/1</command-args>");
    expect(RC.events(dir)).toContainEqual(expect.objectContaining({ k: "skill", name: "do-ship" }));
  });

  test("a sentence merely mentioning a slash command records no event", () => {
    RC.arm(dir, { mode: "prompt" }, { sessionId: "s" });
    const r = run("bitte später /auto-harden laufen lassen");
    expect(r.code).toBe(0);
    expect(RC.events(dir)).not.toContainEqual(expect.objectContaining({ k: "skill", name: "auto-harden" }));
  });
});
