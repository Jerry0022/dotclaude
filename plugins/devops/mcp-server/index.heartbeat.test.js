import { test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { processPidFile, flatPidFile, heartbeatDir, unregister } from "./lib/heartbeat.js";

// AUD-C011: the completion server lost its register() call in #93, so every
// hook (card-guard, stop.flow.guard, post.flow.completion) reported
// "heartbeat dead — render offline first" while the server answered all
// session. Import the real server module with a private TEMP and VITEST unset
// (the guard that keeps the other card tests from registering the worker).
const NAME = "dotclaude-completion";

// Same SDK/zod mock preamble as index.meter.test.js; connect() records whether
// the heartbeat already existed (it must be written AFTER connect).
const seen = vi.hoisted(() => ({ connected: false, fileAtConnect: null }));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool() {}
    async connect() { seen.connected = true; seen.fileAtConnect = globalThis.__hbProbe ? globalThis.__hbProbe() : null; }
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  const z = new Proxy({}, { get: () => () => node });
  return { z };
});

test("after connect the server writes its per-process heartbeat and prunes a dead sibling", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-srv-"));
  const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
  fs.mkdirSync(heartbeatDir(dir), { recursive: true });
  fs.writeFileSync(processPidFile(NAME, gone, dir), String(gone));
  fs.writeFileSync(flatPidFile(NAME, gone, dir), String(gone));
  const keys = ["TEMP", "TMP", "TMPDIR", "VITEST", "DEVOPS_COMPLETION_NO_USAGE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const events = ["exit", "SIGINT", "SIGTERM"];
  const before = Object.fromEntries(events.map((e) => [e, process.listeners(e).slice()]));
  process.env.TEMP = dir; process.env.TMP = dir; process.env.TMPDIR = dir;
  process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
  delete process.env.VITEST;
  try {
    const own = processPidFile(NAME, process.pid, dir);
    globalThis.__hbProbe = () => fs.existsSync(own);
    await import("./index.js");
    expect(seen.connected).toBe(true);
    expect(seen.fileAtConnect).toBe(false);
    expect(fs.existsSync(own)).toBe(true);
    expect(fs.readFileSync(own, "utf8")).toBe(String(process.pid));
    expect(fs.existsSync(processPidFile(NAME, gone, dir))).toBe(false);
    expect(fs.existsSync(flatPidFile(NAME, gone, dir))).toBe(false);
  } finally {
    delete globalThis.__hbProbe;
    unregister(NAME, process.pid, dir);
    for (const e of events) {
      for (const l of process.listeners(e)) if (!before[e].includes(l)) process.removeListener(e, l);
    }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}, 30000);
