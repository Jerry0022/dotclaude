import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { processPidFile, flatPidFile, legacyPidFile, unregister, writeHeartbeat, pruneDead, heartbeatDir } from "./heartbeat.js";

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
  writeHeartbeat(NAME, pid, dir);
}

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

// AUD-C043: ~170 stale per-process files piled up in TEMP while any server of
// the name lived, and every liveness check listed all ~146 k TEMP entries.
describe("heartbeat — subdir layout, pruning, cheap reads (AUD-C043)", () => {
  test("register writes into the dedicated subdir, not TEMP itself", () => {
    withTmp((dir) => {
      registerAs(process.pid, dir);
      expect(fs.existsSync(path.join(heartbeatDir(dir), `${NAME}-${process.pid}.pid`))).toBe(true);
      expect(fs.existsSync(flatPidFile(NAME, process.pid, dir))).toBe(false);
      expect(reader.processPidFileFor(NAME, process.pid)).toBe(processPidFile(NAME, process.pid, dir));
    });
  });

  test("pruneDead removes dead files of this name in both layouts, keeps live ones and other names", () => {
    withTmp((dir) => {
      const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
      writeHeartbeat(NAME, gone, dir);
      writeHeartbeat(NAME, other.pid, dir);
      fs.writeFileSync(flatPidFile(NAME, gone, dir), String(gone));
      fs.writeFileSync(flatPidFile(NAME, other.pid, dir), String(other.pid));
      writeHeartbeat("dotclaude-ship", gone, dir);
      const alive = (pid) => pid === other.pid;
      expect(pruneDead(NAME, dir, alive)).toBe(2);
      expect(fs.existsSync(processPidFile(NAME, gone, dir))).toBe(false);
      expect(fs.existsSync(flatPidFile(NAME, gone, dir))).toBe(false);
      expect(fs.existsSync(processPidFile(NAME, other.pid, dir))).toBe(true);
      expect(fs.existsSync(flatPidFile(NAME, other.pid, dir))).toBe(true);
      expect(fs.existsSync(processPidFile("dotclaude-ship", gone, dir))).toBe(true);
    });
  });

  test("unregister also removes this process's flat pre-0.3.0 file", () => {
    withTmp((dir) => {
      fs.writeFileSync(flatPidFile(NAME, other.pid, dir), String(other.pid));
      writeHeartbeat(NAME, other.pid, dir);
      unregister(NAME, other.pid, dir);
      expect(fs.existsSync(flatPidFile(NAME, other.pid, dir))).toBe(false);
      expect(fs.existsSync(processPidFile(NAME, other.pid, dir))).toBe(false);
    });
  });

  test("a flat-layout file of an older server still counts (one-release compat)", () => {
    withTmp((dir) => {
      fs.writeFileSync(flatPidFile(NAME, process.pid, dir), String(process.pid));
      expect(reader.isMcpServerAlive(NAME)).toBe(true);
      expect(reader.heartbeatState(NAME).alive).toEqual([process.pid]);
    });
  });

  test("a live subdir heartbeat skips the TEMP scan; isMcpServerAlive stops at the first live PID", () => {
    withTmp((dir) => {
      registerAs(process.pid, dir);
      const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
      fs.writeFileSync(flatPidFile(NAME, gone, dir), String(gone));
      const st = reader.heartbeatState(NAME);
      expect(st.dead.map((d) => d.file)).not.toContain(flatPidFile(NAME, gone, dir));
      expect(reader.heartbeats(NAME, { stopAtLive: true })).toHaveLength(1);
      expect(reader.isMcpServerAlive(NAME)).toBe(true);
    });
  });
});

