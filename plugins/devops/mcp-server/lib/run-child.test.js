import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChild, activeChildCount, killAllChildrenSync } from "./run-child.js";
import { guardHandler, logCrash, crashLogPath } from "./crash-guard.js";
import { readFileSync } from "node:fs";

const node = process.execPath;

describe("runChild", () => {
  test("resolves with stdout, stdin input and exit code", async () => {
    const r = await runChild(node, ["-e", "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{process.stdout.write(s.toUpperCase());process.exit(3)})"], { input: "abc" });
    expect(r).toMatchObject({ code: 3, stdout: "ABC", timedOut: false, error: null });
  });

  test("does not block the event loop while the child runs", async () => {
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 20);
    await runChild(node, ["-e", "setTimeout(()=>{}, 600)"]);
    clearInterval(iv);
    expect(ticks).toBeGreaterThan(5);
  });

  test("kills the whole tree on timeout — no grandchild survives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-child-"));
    const pidFile = join(dir, "grandchild.pid");
    const grand = "setInterval(()=>{},1000)";
    const parent = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:'ignore'}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(()=>{},1000)`;
    const r = await runChild(node, ["-e", parent], { timeoutMs: 3000 });
    expect(r.timedOut).toBe(true);
    expect(activeChildCount()).toBe(0);
    const gpid = Number(readFileSync(pidFile, "utf8"));
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      try { process.kill(gpid, 0); await new Promise((res) => setTimeout(res, 250)); } catch { alive = false; }
    }
    expect(alive).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  test("caps output and flags truncation", async () => {
    const r = await runChild(node, ["-e", "process.stdout.write('x'.repeat(100000))"], { maxOutput: 1000 });
    expect(r.stdout.length).toBe(1000);
    expect(r.truncated).toBe(true);
  });

  test("a missing command resolves with error, never rejects", async () => {
    const r = await runChild("definitely-not-a-command-xyz", []);
    expect(r.error || r.code !== 0).toBeTruthy();
  });

  test("killAllChildrenSync ends running children", async () => {
    const p = runChild(node, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 60_000 });
    await new Promise((res) => setTimeout(res, 300));
    expect(activeChildCount()).toBe(1);
    killAllChildrenSync();
    const r = await p;
    expect(r.code === 0).toBe(false);
  }, 15_000);
});

describe("crash-guard", () => {
  test("guardHandler turns a throw into an MCP error result", async () => {
    const h = guardHandler("boom", async () => { throw new Error("kaputt"); });
    const r = await h({});
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toMatchObject({ error: true, tool: "boom", message: "kaputt" });
  });

  test("logCrash appends to the crash log and rotates past 1 MB", () => {
    const dir = mkdtempSync(join(tmpdir(), "crash-log-"));
    writeFileSync(crashLogPath(dir), "");
    appendFileSync(crashLogPath(dir), "x".repeat(1024 * 1024 + 10));
    logCrash("unit", new Error("first"), dir);
    expect(readFileSync(crashLogPath(dir), "utf8")).toMatch(/unit: Error: first/);
    expect(readFileSync(crashLogPath(dir) + ".1", "utf8").length).toBeGreaterThan(1024 * 1024);
    rmSync(dir, { recursive: true, force: true });
  });
});
