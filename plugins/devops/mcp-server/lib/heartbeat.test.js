import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { processPidFile, legacyPidFile, unregister } from "./heartbeat.js";

const require = createRequire(import.meta.url);
const reader = require("../../hooks/lib/mcp-heartbeat.js");
const status = require("../../hooks/lib/mcp-status.js");

// Every open Claude session runs its own copy of each MCP server. With ONE
// shared PID file per name, the first server to exit deleted it and every hook
// reported "heartbeat dead" while the other sessions' servers answered fine
// (2026-09-24). These tests pin the per-process files and the reader over them.

const NAME = "dotclaude-completion";

// A second live process standing in for another session's server.
const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
afterAll(() => { try { other.kill(); } catch {} });

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-pp-"));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TMPDIR = dir; process.env.TEMP = dir; process.env.TMP = dir;
  try { return fn(dir); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/** What register() writes for a server process `pid` in `dir`. */
function registerAs(pid, dir) {
  fs.writeFileSync(processPidFile(NAME, pid, dir), String(pid));
  fs.writeFileSync(legacyPidFile(NAME, dir), String(pid));
}

// The completion server lost its register call in #93 ("unused import"), so
// every hook read it as dead and put the offline card path first. Each of the
// three servers must register under its .mcp.json name after connecting.
describe("heartbeat — every devops server registers itself", () => {
  for (const [file, name] of [["../index.js", "dotclaude-completion"], ["../ship/index.js", "dotclaude-ship"], ["../issues/index.js", "dotclaude-issues"]]) {
    test(`${name} registers after server.connect`, () => {
      const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
      const mcpName = new RegExp(`const SERVER_NAME = "${name}"`);
      expect(src).toMatch(mcpName);
      const reg = src.indexOf("registerHeartbeat(SERVER_NAME)");
      expect(reg).toBeGreaterThan(-1);
      expect(reg).toBeGreaterThan(src.indexOf("server.connect("));
    });
  }
});

describe("heartbeat — one file per server process", () => {
  test("two registrations, the first-registered exits → still alive", () => {
    withTmp((dir) => {
      registerAs(other.pid, dir);
      registerAs(process.pid, dir); // last writer owns the legacy slot
      unregister(NAME, other.pid, dir);
      expect(fs.existsSync(processPidFile(NAME, other.pid, dir))).toBe(false);
      expect(reader.isMcpServerAlive(NAME)).toBe(true);
      expect(status.isServerAlive(NAME)).toBe(true);
    });
  });

  test("two registrations, the legacy-slot owner exits → still alive (the observed bug)", () => {
    withTmp((dir) => {
      registerAs(process.pid, dir);
      registerAs(other.pid, dir);
      unregister(NAME, other.pid, dir);
      expect(fs.existsSync(legacyPidFile(NAME, dir))).toBe(false);
      expect(reader.isMcpServerAlive(NAME)).toBe(true);
    });
  });

  test("an exiting server never deletes a legacy file another server owns", () => {
    withTmp((dir) => {
      registerAs(other.pid, dir);
      registerAs(process.pid, dir);
      unregister(NAME, other.pid, dir);
      expect(fs.readFileSync(legacyPidFile(NAME, dir), "utf8")).toBe(String(process.pid));
    });
  });

  test("all servers gone → dead; dead files are reported for cleanup", () => {
    withTmp((dir) => {
      const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
      registerAs(gone, dir);
      const st = reader.heartbeatState(NAME);
      expect(st.any).toBe(true);
      expect(st.alive).toEqual([]);
      expect(st.dead.map((d) => d.pid)).toEqual([gone, gone]);
      expect(reader.isMcpServerAlive(NAME)).toBe(false);
    });
  });

  test("a legacy-only file from an older server still counts (one-release compat)", () => {
    withTmp((dir) => {
      fs.writeFileSync(legacyPidFile(NAME, dir), String(process.pid));
      expect(reader.isMcpServerAlive(NAME)).toBe(true);
    });
  });

  test("another server's files never answer for this one", () => {
    withTmp((dir) => {
      fs.writeFileSync(path.join(dir, `dotclaude-mcp-dotclaude-ship-${process.pid}.pid`), String(process.pid));
      expect(reader.isMcpServerAlive(NAME)).toBe(false);
    });
  });
});
