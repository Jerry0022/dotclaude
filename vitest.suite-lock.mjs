/**
 * Machine-wide lock for FULL suite runs (vitest globalSetup).
 *
 * The suite is sized for one run per machine: vitest.config.mjs caps the
 * workers at a third of the cores because each worker spawns hooks, git and
 * servers of its own. Parallel Claude sessions each run `npm test` before a
 * ship, though — four full suites at once were measured on 2026-09-23, and the
 * git-sync worlds that take 10-15 s alone then took 100-650 s: 14 tests timed
 * out, 13 files failed on "Timeout calling onTaskUpdate", every one of them
 * green when run alone. No per-test timeout absorbs a 40x slowdown, so full
 * runs queue behind each other instead.
 *
 * Targeted runs (`vitest run some.test.js`) skip the lock — they are the
 * edit-test loop and stay light. The lock is a file in the OS temp dir holding
 * the owner's pid; a dead pid or an age past STALE_MS frees it, and a waiter
 * gives up after MAX_WAIT_MS and runs anyway (a slow run beats a hung one).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCK_FILE = process.env.DOTCLAUDE_SUITE_LOCK_FILE
  || path.join(os.tmpdir(), "dotclaude-vitest-suite.lock");
const STALE_MS = 40 * 60 * 1000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const POLL_MS = 2000;

/**
 * True for `vitest run` without a test filter, i.e. the whole suite once.
 * Watch mode (`vitest` alone) never locks — it would hold the lock for hours.
 */
export function isFullRun(argv = process.argv) {
  const i = argv.indexOf("run");
  if (i === -1) return false;
  const rest = argv.slice(i + 1);
  // Flags that take a value: skip the value too.
  const valued = new Set(["--reporter", "--outputFile", "--config", "-c", "--root", "-r", "--dir", "--project", "--pool", "--maxWorkers", "--minWorkers", "--testTimeout", "--hookTimeout", "-t", "--testNamePattern", "--shard", "--mode", "--environment"]);
  for (let j = 0; j < rest.length; j++) {
    const a = rest[j];
    if (a.startsWith("-")) {
      if (valued.has(a)) j++;
      continue;
    }
    return false;
  }
  return true;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Free when absent, unreadable, owned by a dead pid, or older than staleMs. */
export function isFree(lock, now = Date.now(), staleMs = STALE_MS) {
  if (!lock || typeof lock.pid !== "number") return true;
  if (lock.pid === process.pid) return true;
  if (now - (lock.since || 0) > staleMs) return true;
  return !alive(lock.pid);
}

/** One atomic attempt: create the file exclusively, or take over a free one. */
export function tryAcquire(file = LOCK_FILE, info = {}) {
  const body = JSON.stringify({ pid: process.pid, since: Date.now(), cwd: process.cwd(), ...info });
  try {
    fs.writeFileSync(file, body, { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") return true; // temp dir unusable → never block the run
  }
  if (!isFree(readLock(file))) return false;
  try {
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, body, { flag: "wx" });
    return true;
  } catch {
    return false; // another waiter won the takeover race
  }
}

export function release(file = LOCK_FILE) {
  const lock = readLock(file);
  if (lock && lock.pid === process.pid) fs.rmSync(file, { force: true });
}

export default async function setup() {
  if (process.env.DOTCLAUDE_SUITE_LOCK === "0" || !isFullRun()) return;
  const start = Date.now();
  let told = false;
  while (!tryAcquire()) {
    if (Date.now() - start > MAX_WAIT_MS) {
      process.stderr.write("[suite-lock] waited 30 min — running anyway\n");
      return;
    }
    if (!told) {
      const l = readLock(LOCK_FILE) || {};
      process.stderr.write(`[suite-lock] another full test run is active (pid ${l.pid}, ${l.cwd || "?"}) — waiting for it to finish\n`);
      told = true;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (told) process.stderr.write(`[suite-lock] acquired after ${Math.round((Date.now() - start) / 1000)} s\n`);
  const onExit = () => release();
  process.once("exit", onExit);
  return () => {
    process.off("exit", onExit);
    release();
  };
}
