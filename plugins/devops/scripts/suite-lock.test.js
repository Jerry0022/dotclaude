import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { isFullRun, isFree, tryAcquire, release } from "../../../vitest.suite-lock.mjs";

// The machine-wide lock that queues full `vitest run`s from parallel sessions
// (vitest.suite-lock.mjs). Every test uses its own lock file — the real one is
// held by this very run's main process.

let dir;
let file;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "suite-lock-"));
  file = path.join(dir, "suite.lock");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isFullRun", () => {
  const cli = (...args) => ["node", "C:/x/node_modules/vitest/vitest.mjs", ...args];

  test("a bare run and a run with flags only are full runs", () => {
    expect(isFullRun(cli("run"))).toBe(true);
    expect(isFullRun(cli("run", "--reporter=json", "--outputFile", "out.json"))).toBe(true);
    expect(isFullRun(cli("run", "--reporter", "dot"))).toBe(true);
  });

  test("a run with a file filter or a test-name pattern value is not confused", () => {
    expect(isFullRun(cli("run", "plugins/devops/hooks/lib/locale.test.js"))).toBe(false);
    expect(isFullRun(cli("run", "-t", "some name"))).toBe(true);
    expect(isFullRun(cli("run", "-t", "some name", "locale"))).toBe(false);
  });

  test("watch mode never locks", () => {
    expect(isFullRun(cli())).toBe(false);
  });
});

describe("lock file", () => {
  test("the first caller acquires, the second waits while the owner lives", () => {
    const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: owner.pid, since: Date.now() }));
      expect(tryAcquire(file)).toBe(false);
    } finally {
      owner.kill();
    }
  });

  test("an absent lock is acquired and released by its owner", () => {
    expect(tryAcquire(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(process.pid);
    release(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  test("a lock left by a dead process is taken over", () => {
    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    return new Promise((resolve) => dead.on("exit", resolve)).then(() => {
      fs.writeFileSync(file, JSON.stringify({ pid: dead.pid, since: Date.now() }));
      expect(tryAcquire(file)).toBe(true);
      expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(process.pid);
    });
  });

  test("a lock older than the stale limit is free even if its pid lives", () => {
    const lock = { pid: process.ppid, since: Date.now() - 41 * 60 * 1000 };
    expect(isFree(lock)).toBe(true);
    expect(isFree({ ...lock, since: Date.now() })).toBe(false);
  });

  test("release leaves a lock owned by someone else alone", () => {
    fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, since: Date.now() }));
    release(file);
    expect(fs.existsSync(file)).toBe(true);
  });

  test("an unreadable lock counts as free", () => {
    fs.writeFileSync(file, "not json");
    expect(tryAcquire(file)).toBe(true);
  });
});
