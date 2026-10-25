import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { runEvent, laneGroups, dispatchDisabled, selectModules } = require("./dispatch.js");

let dir;
const FIXTURES = {
  // reads stdin as a stream, answers with context
  "ctx.js": `let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>raw+=d);process.stdin.on('end',()=>{
    const h=JSON.parse(raw);process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:h.hook_event_name,additionalContext:'ctx:'+h.tool_name}}));});`,
  // exit-2 gate via process.exit
  "block.js": `process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('BLOCKED by fixture\\n');process.exit(2);});`,
  // exit-2 via exitCode, after a large write (drain)
  "drain.js": `process.stdout.write('x'.repeat(100000));process.stderr.write('late block');process.exitCode=2;`,
  // fd-0 read + fd-1 writeSync + main-module check
  "fd.js": `const fs=require('fs');const raw=fs.readFileSync(0,'utf8');fs.writeSync(1,JSON.stringify({systemMessage:'fd:'+JSON.parse(raw).tool_name+':'+(require.main===module)+':'+require('path').basename(process.argv[1])}));process.exit(0);`,
  // module-level state never leaks between modules
  "state-a.js": `globalThis.__seen=(globalThis.__seen||0)+1;process.env.FIXTURE_LEAK='a';process.stdout.write(JSON.stringify({systemMessage:'a'+globalThis.__seen}));`,
  "state-b.js": `globalThis.__seen=(globalThis.__seen||0)+1;process.stdout.write(JSON.stringify({systemMessage:'b'+globalThis.__seen+(process.env.FIXTURE_LEAK||'')}));`,
  // a busy loop is terminated at its budget
  "spin.js": `for(;;){}`,
  // an uncaught throw is a non-blocking error
  "throw.js": `throw new Error('kaboom');`,
  // records the run id the dispatcher handed in, then spins into its budget
  "id-spin.js": `require('fs').writeFileSync(require('path').join(__dirname,'seen-id.txt'),require('worker_threads').workerData.telemetryId);for(;;){}`,
};
const mod = (name, o = {}) => ({ name: name.replace(/\.js$/, ""), file: path.join(dir, name), timeoutS: 10, isolate: "worker", dispatch: true, ...o });
const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
const run = (modules, o = {}) => runEvent({ event: "PreToolUse", raw: payload, modules, budgetS: 20, tele: null, ...o });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
  for (const [f, src] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(dir, f), src);
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("dispatcher runs modules in worker threads like separate processes", () => {
  test("stream stdin, context reply", async () => {
    const r = await run([mod("ctx.js")]);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe("ctx:Bash");
    expect(r.code).toBe(0);
  });

  test("a gate's exit 2 still blocks, and the other modules still ran and kept their context", async () => {
    const r = await run([mod("ctx.js"), mod("block.js"), mod("fd.js")]);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("BLOCKED by fixture\n");
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.additionalContext).toBe("ctx:Bash");
    expect(out.systemMessage).toBe("fd:Bash:true:fd.js");
  });

  test("process.exitCode = 2 after a large write: exit code and stdout survive", async () => {
    const r = await run([mod("drain.js")]);
    expect(r.code).toBe(2);
    expect(r.stdout.length).toBe(100000);
    expect(r.stderr).toBe("late block");
  });

  test("module state and env never leak between modules (one lane, sequential)", async () => {
    const r = await run([mod("state-a.js"), mod("state-b.js")], { lanes: [["state-a", "state-b"]] });
    expect(JSON.parse(r.stdout).systemMessage).toBe("a1\nb1");
  });

  test("a module over its budget is terminated and the rest still answer", async () => {
    const t0 = Date.now();
    const r = await run([mod("spin.js", { timeoutS: 1 }), mod("ctx.js")]);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.results[0].timedOut).toBe(true);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe("ctx:Bash");
  });

  test("a module is skipped once the event budget is spent", async () => {
    const r = await run([mod("spin.js", { timeoutS: 5 }), mod("ctx.js")], { budgetS: 1, lanes: [["spin", "ctx"]] });
    expect(r.results[0].timedOut).toBe(true);
    expect(r.results[1].skipped).toBe(true);
    expect(r.stdout).toBe("");
  });

  test("a module prepared ahead in its lane times out under its own run id (one kill, one record)", async () => {
    const recs = [];
    const tele = { record: (r) => recs.push(r) };
    const r = await run([mod("ctx.js"), mod("id-spin.js", { timeoutS: 1 })], { tele, lanes: [["ctx", "id-spin"]] });
    expect(r.results[1].timedOut).toBe(true);
    const seen = fs.readFileSync(path.join(dir, "seen-id.txt"), "utf8");
    expect(recs).toEqual([expect.objectContaining({ hook: "id-spin", outcome: "timeout", id: seen })]);
  });

  test("the opt-out writes no dispatcher end record for a killed child (its own start already counts)", async () => {
    const recs = [];
    const r = await run([mod("spin.js", { timeoutS: 1 })], { tele: { record: (x) => recs.push(x) }, processMode: true });
    expect(r.results[0].timedOut).toBe(true);
    expect(recs).toEqual([]);
  });

  test("an uncaught throw fails open (exit 1 of that module only)", async () => {
    const r = await run([mod("throw.js"), mod("ctx.js")]);
    expect(r.code).toBe(0);
    expect(r.results[0].code).toBe(1);
    expect(r.stderr).toMatch(/kaboom/);
  });

  test("the opt-out runs the same modules as separate processes with the same merged reply", async () => {
    const mods = [mod("ctx.js"), mod("block.js"), mod("fd.js")];
    const a = await run(mods);
    const b = await run(mods, { processMode: true });
    expect(b).toMatchObject({ code: a.code, stdout: a.stdout, stderr: a.stderr });
    expect(dispatchDisabled({ DEVOPS_HOOK_DISPATCH: "0" })).toBe(true);
    expect(dispatchDisabled({ DEVOPS_HOOK_DISPATCH: "off" })).toBe(true);
    expect(dispatchDisabled({})).toBe(false);
  });
});

describe("lanes and selection", () => {
  test("laneGroups: known lanes keep their members together, unknown modules share one lane", () => {
    const mods = ["a", "b", "c", "x", "y"].map((name) => ({ name }));
    expect(laneGroups(mods, [["a", "c"], ["b"]])).toEqual([[0, 2], [1], [3, 4]]);
    expect(laneGroups(mods, undefined)).toEqual([[0, 1, 2, 3, 4]]);
  });

  test("selectModules applies each module's own matcher", () => {
    const manifest = { hooks: { PreToolUse: [
      { matcher: "Bash", hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/a.js"' }] },
      { matcher: "Edit|Write", hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/b.js"' }] },
      { hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/c.js"', timeout: 5 }] },
    ] } };
    const names = (tool) => selectModules(manifest, "PreToolUse", { tool_name: tool }, "/root").map((m) => m.name);
    expect(names("Bash")).toEqual(["a", "c"]);
    expect(names("Write")).toEqual(["b", "c"]);
  });
});
