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
