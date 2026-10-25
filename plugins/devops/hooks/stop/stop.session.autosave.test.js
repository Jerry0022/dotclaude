import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const worker = require("../lib/session-autosave-worker.js");
const gate = require("../lib/session-archive-gate.js");
const { main, lastCardVariant, RUNNING, FINISHED } = require("./stop.session.autosave.js");

let dir;
let cwd;
const sid = `sess-${process.pid}`;
const hook = (extra = {}) => ({ session_id: sid, cwd, transcript_path: path.join(dir, "t.jsonl"), ...extra });
// the "worker" runs in-process, so the test controls how long it takes
const fakeWorker = (ms, out = {}) => () => {
  fs.writeFileSync(worker.markerFile(sid), JSON.stringify({ pid: process.pid, start: Date.now() }));
  setTimeout(() => {
    fs.writeFileSync(`${worker.markerFile(sid)}.result`, JSON.stringify(out));
    fs.unlinkSync(worker.markerFile(sid));
  }, ms);
};
const card = (variant) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__x__render_completion_card", input: { variant } }] } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "autosave-stop-"));
  cwd = path.join(dir, ".claude", "worktrees", "w1");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(dir, "t.jsonl"), "");
});
afterEach(() => {
  for (const f of [worker.markerFile(sid), `${worker.markerFile(sid)}.result`]) { try { fs.unlinkSync(f); } catch { /* none */ } }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("stop.session.autosave time budget", () => {
  test("done in time and nothing to report: silent", async () => {
    expect(await main(hook(), { waitMs: 2000, spawn: fakeWorker(50) })).toBeNull();
  });

  test("done in time with a save: the autosaved line", async () => {
    const out = await main(hook(), { waitMs: 2000, spawn: fakeWorker(50, { message: "[devops] autosaved x" }) });
    expect(JSON.parse(out).systemMessage).toBe("[devops] autosaved x");
  });

  test("slower than the budget: one running line, marker stays live and blocks archiving", async () => {
    const out = await main(hook(), { waitMs: 150, spawn: fakeWorker(600) });
    expect([RUNNING.de, RUNNING.en]).toContain(JSON.parse(out).systemMessage);
    expect(gate.autosaveRunning(sid)).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(gate.autosaveRunning(sid)).toBe(false);
  });

  test("a second turn while the save still runs starts no second worker", async () => {
    fs.writeFileSync(worker.markerFile(sid), JSON.stringify({ pid: process.pid, start: Date.now() }));
    let spawned = 0;
    const out = await main(hook(), { waitMs: 2000, spawn: () => { spawned++; } });
    expect(spawned).toBe(0);
    expect(JSON.parse(out).systemMessage).toMatch(/Sicherung|Saving/);
  });

  test("ship-successful card this turn: 'Save finished' line; ordinary card: silent", async () => {
    fs.writeFileSync(path.join(dir, "t.jsonl"), `${card("ship-successful")}\n`);
    const out = await main(hook(), { waitMs: 2000, spawn: fakeWorker(20) });
    expect([FINISHED.de, FINISHED.en]).toContain(JSON.parse(out).systemMessage);
    fs.writeFileSync(path.join(dir, "t.jsonl"), `${card("ready")}\n`);
    expect(await main(hook(), { waitMs: 2000, spawn: fakeWorker(20) })).toBeNull();
    expect(lastCardVariant(path.join(dir, "t.jsonl"))).toBe("ready");
  });

  test("outside a session worktree and for subagents: nothing starts", async () => {
    let spawned = 0;
    const spawn = () => { spawned++; };
    expect(await main(hook({ cwd: dir }), { spawn })).toBeNull();
    expect(await main(hook({ agent_id: "a1" }), { spawn })).toBeNull();
    expect(spawned).toBe(0);
  });
});

describe("running marker", () => {
  test("stale (> 10 min) or dead pid reads as not running", () => {
    fs.writeFileSync(worker.markerFile(sid), JSON.stringify({ pid: process.pid, start: Date.now() - 11 * 60 * 1000 }));
    expect(worker.isRunning(sid)).toBe(false);
    fs.writeFileSync(worker.markerFile(sid), JSON.stringify({ pid: 2147483000, start: Date.now() }));
    expect(worker.isRunning(sid)).toBe(false);
  });

  test("the worker writes the marker, the result, and removes the marker", async () => {
    const res = await worker.run({ sessionId: sid, cwd: dir, mode: "local" }); // not a session worktree: nothing to save
    expect(res).toEqual({});
    expect(fs.existsSync(worker.markerFile(sid))).toBe(false);
    expect(JSON.parse(fs.readFileSync(`${worker.markerFile(sid)}.result`, "utf8"))).toEqual({});
  });
});
