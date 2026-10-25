import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dr = require("./deferred-results.js");
const worker = require("./deferred-worker.js");

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "deferred-test-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("deferred-results store", () => {
  test("write then collect delivers once, ordered by name", () => {
    dr.write("s1", "b-hook", "B", dir);
    dr.write("s1", "a-hook", "A", dir);
    dr.write("s2", "a-hook", "OTHER", dir);
    expect(dr.collect("s1", { dir })).toEqual(["A", "B"]);
    expect(dr.collect("s1", { dir })).toEqual([]);
    expect(dr.collect("s2", { dir })).toEqual(["OTHER"]);
  });

  test("a result that arrives later is delivered later, not twice", () => {
    dr.write("s1", "a", "first", dir);
    expect(dr.collect("s1", { dir })).toEqual(["first"]);
    dr.write("s1", "b", "second", dir);
    expect(dr.collect("s1", { dir })).toEqual(["second"]);
    expect(dr.collect("s1", { dir })).toEqual([]);
  });

  test("empty output stores nothing", () => {
    expect(dr.write("s1", "a", "  \n", dir)).toBe(false);
    expect(dr.collect("s1", { dir })).toEqual([]);
  });

  test("files older than 24 h are pruned, even of a session that never prompts", () => {
    dr.write("gone", "a", "x", dir);
    const f = dr.resultFile("gone", "a", dir);
    const old = new Date(Date.now() - dr.MAX_AGE_MS - 60_000);
    fs.utimesSync(f, old, old);
    dr.collect("other", { dir });
    expect(fs.existsSync(f)).toBe(false);
  });
});

describe("deferOrRun", () => {
  test("hands the payload to the spawner on the hook path", () => {
    const seen = [];
    delete process.env.DEVOPS_DEFERRED_PHASE;
    const r = dr.deferOrRun({ name: "n", script: "/x.js", input: JSON.stringify({ session_id: "sid9" }), spawn: (p) => seen.push(p) });
    expect(r).toBe(true);
    expect(seen[0]).toMatchObject({ name: "n", script: "/x.js", sessionId: "sid9" });
  });

  test("does not defer in the worker, inline, or when the spawn fails", () => {
    const spawn = () => { throw new Error("no"); };
    delete process.env.DEVOPS_DEFERRED_PHASE;
    expect(dr.deferOrRun({ name: "n", script: "x", inline: true, input: "", spawn })).toBe(false);
    expect(dr.deferOrRun({ name: "n", script: "x", input: "", spawn })).toBe(false);
    process.env.DEVOPS_DEFERRED_PHASE = "bg";
    try { expect(dr.deferOrRun({ name: "n", script: "x", input: "", spawn: () => {} })).toBe(false); }
    finally { delete process.env.DEVOPS_DEFERRED_PHASE; }
  });
});

describe("deferred-worker", () => {
  test("runs the script in bg phase and stores its stdout under the session", () => {
    const script = path.join(dir, "h.js");
    fs.writeFileSync(script, "process.stdout.write(process.env.DEVOPS_DEFERRED_PHASE + ':' + require('fs').readFileSync(0,'utf8'))");
    const sid = "wtest" + process.pid;
    expect(worker.run({ name: "h", script, input: "payload", sessionId: sid, cwd: dir })).toBe(true);
    expect(dr.collect(sid)).toEqual(["bg:payload"]);
  });

  test("a failing script stores nothing", () => {
    const script = path.join(dir, "f.js");
    fs.writeFileSync(script, "process.stdout.write('x'); process.exit(1)");
    const sid = "wfail" + process.pid;
    expect(worker.run({ name: "f", script, sessionId: sid, cwd: dir })).toBe(false);
    expect(dr.collect(sid)).toEqual([]);
  });
});
