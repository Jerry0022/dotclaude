import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { killRates } = require("./hook-telemetry.js");
const LIB = path.dirname(fileURLToPath(import.meta.url));
let dir;
let file;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-tel-"));
  file = path.join(dir, "tel.jsonl");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function runHook(script, input, code = "") {
  const hook = path.join(dir, script);
  fs.writeFileSync(hook, [
    `require(${JSON.stringify(path.join(LIB, "plugin-guard.js"))});`,
    `const { parseHookInput } = require(${JSON.stringify(path.join(LIB, "hook-input.js"))});`,
    "let r='';process.stdin.on('data',d=>r+=d);",
    `process.stdin.on('end',()=>{parseHookInput(r);${code}});`,
  ].join("\n"));
  const env = { ...process.env, DEVOPS_HOOK_TELEMETRY: file, HOME: dir, USERPROFILE: dir };
  delete env.VITEST;
  delete env.CLAUDE_PLUGIN_ROOT;
  return spawnSync(process.execPath, [hook], { cwd: dir, input: JSON.stringify(input), encoding: "utf8", env });
}
const records = () => fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("hook-telemetry", () => {
  test("silent run: start + end(ok) with event and tool from the payload", () => {
    runHook("a.js", { hook_event_name: "PostToolUse", tool_name: "Edit" });
    const [s, e] = records();
    expect(s).toMatchObject({ hook: "a", phase: "start" });
    expect(e).toMatchObject({ hook: "a", phase: "end", event: "PostToolUse", tool: "Edit", outcome: "ok", chars: 0 });
    expect(e.ms).toBeGreaterThanOrEqual(0);
  });

  test("output, block and error outcomes; stdout and exit code stay untouched", () => {
    const o = runHook("o.js", { tool_name: "Bash" }, "process.stdout.write('hello');");
    expect(o.stdout).toBe("hello");
    const b = runHook("b.js", {}, "process.exitCode = 2;");
    expect(b.status).toBe(2);
    runHook("e.js", {}, "process.exitCode = 1;");
    const ends = records().filter((r) => r.phase === "end");
    expect(ends.map((r) => [r.hook, r.outcome])).toEqual([["o", "output"], ["b", "block"], ["e", "error"]]);
    expect(ends[0].chars).toBe(5);
  });

  test("a disabled plugin writes nothing", () => {
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
    runHook("d.js", {});
    expect(fs.existsSync(file)).toBe(false);
  });

  test("rotates at 1 MB keeping one .1", () => {
    fs.writeFileSync(file, "x".repeat(1024 * 1024 + 10));
    runHook("r.js", {});
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.statSync(file).size).toBeLessThan(1000);
  });

  test("killRates: a start without an end counts as killed once past the grace period", () => {
    const now = 1_000_000_000_000;
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push({ ts: now - 500000 + i, id: `ok${i}`, hook: "h", phase: "start" });
      if (i % 5) lines.push({ ts: now - 500000 + i, id: `ok${i}`, hook: "h", phase: "end", outcome: "ok" });
    }
    lines.push({ ts: now - 1000, id: "live", hook: "h", phase: "start" }); // still running: ignored
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
    const [r] = killRates(file, { now });
    expect(r).toMatchObject({ hook: "h", runs: 20, killed: 4, rate: 0.2 });
  });

  test("killRates: the dispatcher's timeout/skipped end records count as killed, without grace", () => {
    const now = 1_000_000_000_000;
    const lines = [
      { ts: now - 10, id: "w1", hook: "g", phase: "start" },
      { ts: now - 5, id: "w1", hook: "g", phase: "end", outcome: "timeout", dispatched: true },
      { ts: now - 4, id: "w2", hook: "g", phase: "end", outcome: "skipped", dispatched: true },
      { ts: now - 3, id: "w3", hook: "g", phase: "start" },
      { ts: now - 2, id: "w3", hook: "g", phase: "end", outcome: "ok" },
    ];
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
    const [r] = killRates(file, { now });
    expect(r).toMatchObject({ hook: "g", runs: 3, killed: 2 });
  });
});
