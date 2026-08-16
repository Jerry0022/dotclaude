import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, start, stopCmd, status, readLock, writeLock, isAlive } from "./batch-watchdog.js";
import { activate, deactivate, appendNote, touchActivity, lockPath } from "../hooks/lib/batch-state.js";

let cwd;
let strays = [];

/**
 * A real, live, foreign process to stand in for a running watchdog.
 * Never use `process.pid` here — stopCmd sends SIGTERM to whatever the lock
 * names, and that would kill the test worker itself.
 */
function spawnIdleProcess() {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  child.unref();
  strays.push(child);
  return child.pid;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "batch-wd-test-"));
  strays = [];
});

afterEach(() => {
  try { stopCmd(cwd); } catch { /* best effort */ }
  for (const c of strays) { try { c.kill("SIGKILL"); } catch { /* already gone */ } }
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

const MIN = 60_000;
const base = {
  modeActive: true,
  noteCount: 3,
  lastActivity: 0,
  now: 11 * MIN,
  inactivityMs: 10 * MIN,
  alreadyNotified: false,
};

describe("decide — when the reminder fires", () => {
  test("fires once the quiet window is exceeded", () => {
    expect(decide(base)).toBe("fire");
  });

  test("waits inside the quiet window", () => {
    expect(decide({ ...base, now: 9 * MIN })).toBe("wait");
  });

  test("does not fire twice for the same quiet stretch", () => {
    expect(decide({ ...base, alreadyNotified: true })).toBe("wait");
  });

  test("an empty queue is never worth a toast", () => {
    expect(decide({ ...base, noteCount: 0 })).toBe("wait");
  });

  test("no clock yet means wait, not fire", () => {
    expect(decide({ ...base, lastActivity: null })).toBe("wait");
  });

  test("a deactivated mode stops the watchdog", () => {
    expect(decide({ ...base, modeActive: false })).toBe("stop");
  });

  test("mode deactivation outranks everything else", () => {
    expect(decide({ ...base, modeActive: false, noteCount: 0, lastActivity: null })).toBe("stop");
  });
});

describe("lock file — orphan protection", () => {
  test("a live PID is detected, a dead one is not", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(0)).toBe(false);
    // PID 2^31-1 is above Windows' and Linux' practical range.
    expect(isAlive(2147483647)).toBe(false);
  });

  test("start is idempotent while a live watchdog holds the lock", () => {
    activate(cwd);
    const alive = spawnIdleProcess();
    writeLock(cwd, alive);
    expect(start(cwd)).toBeNull();
    expect(readLock(cwd).pid).toBe(alive);
  });

  test("a stale lock from a crashed watchdog does not block a restart", () => {
    activate(cwd);
    writeLock(cwd, 2147483647);
    const pid = start(cwd);
    expect(pid).toBeTruthy();
    expect(pid).not.toBe(2147483647);
  });

  test("stop clears the lock file and the process it named", () => {
    activate(cwd);
    const alive = spawnIdleProcess();
    writeLock(cwd, alive);
    stopCmd(cwd);
    expect(fs.existsSync(lockPath(cwd))).toBe(false);
  });

  test("stop on a project that never ran a watchdog is harmless", () => {
    expect(stopCmd(cwd)).toBe(true);
  });
});

describe("status", () => {
  test("reports mode and note count for a fresh collection", () => {
    activate(cwd);
    appendNote(cwd, "eine notiz");
    touchActivity(cwd);
    const s = status(cwd);
    expect(s.modeActive).toBe(true);
    expect(s.notes).toBe(1);
    expect(s.running).toBe(false);
  });

  test("reports inactive after the mode is switched off", () => {
    activate(cwd);
    deactivate(cwd);
    expect(status(cwd).modeActive).toBe(false);
  });

  test("survives a project with no .claude directory at all", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "batch-wd-bare-"));
    try {
      const s = status(bare);
      expect(s).toEqual({ running: false, pid: null, startedAt: null, notes: 0, modeActive: false });
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
