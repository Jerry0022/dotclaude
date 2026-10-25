/**
 * @module run-child
 * @version 0.1.0
 * @plugin devops
 * @description Async child-process runner for the single devops MCP server.
 *   One server process carries every tool of a session (card, usage, ship,
 *   issues), so nothing long may run on its event loop: a 15-minute
 *   `ship_build` that blocked it would also block `render_completion_card`.
 *   runChild() spawns, returns a promise, and never blocks:
 *     - timeout → the whole process tree is killed (taskkill /T /F on Windows,
 *       the process group on POSIX) and the promise resolves with timedOut
 *     - stdout/stderr are capped (memory stays bounded; truncated is flagged)
 *     - every live child is tracked, so killAllChildrenSync() on server
 *       shutdown leaves no orphans (it runs from process 'exit', so it is sync)
 *   The promise never rejects: a spawn error resolves with `error` set.
 */

import { spawn, spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";
export const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;

/** @type {Set<import("node:child_process").ChildProcess>} */
const active = new Set();

export function activeChildCount() {
  return active.size;
}

/**
 * Kill a child and everything it started. Resolves once the kill is done
 * (on Windows when taskkill exits — the tree is gone then), never rejects.
 */
export function killTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      if (IS_WIN) {
        const k = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        k.on("error", () => { try { child.kill(); } catch { /* gone */ } resolve(); });
        k.on("close", () => resolve());
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        resolve();
      }
    } catch { resolve(); /* already gone */ }
  });
}

/** Sync tree-kill of every tracked child — safe inside a process 'exit' handler. */
export function killAllChildrenSync() {
  for (const child of active) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (IS_WIN) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    } catch { /* gone */ }
  }
  active.clear();
}

function collector(max) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  return {
    push(buf) {
      if (size >= max) { truncated = true; return; }
      const room = max - size;
      const part = buf.length > room ? buf.subarray(0, room) : buf;
      if (part.length < buf.length) truncated = true;
      chunks.push(part);
      size += part.length;
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
    get truncated() { return truncated; },
  };
}

/**
 * Run a command without blocking the event loop.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: object, input?: string, timeoutMs?: number, maxOutput?: number }} [opts]
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string,
 *   timedOut: boolean, truncated: boolean, durationMs: number, error: string|null }>}
 */
export function runChild(cmd, args, opts = {}) {
  const { cwd, env, input, timeoutMs = 10 * 60_000, maxOutput = DEFAULT_MAX_OUTPUT } = opts;
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        // POSIX: own process group, so a timeout kill reaches grandchildren too.
        detached: !IS_WIN,
      });
    } catch (e) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 0, error: e.message });
      return;
    }
    active.add(child);
    const out = collector(maxOutput);
    const err = collector(maxOutput);
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    let killing = null;
    const timer = setTimeout(() => { timedOut = true; killing = killTree(child); }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.stdin.on("error", () => { /* child closed stdin early */ });
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(child);
      // After a timeout, resolve only once the whole tree is gone (no orphan
      // can still be writing when the caller reports the step as killed).
      const done = () => resolve({
        code, signal, stdout: out.text(), stderr: err.text(), timedOut,
        truncated: out.truncated || err.truncated, durationMs: Date.now() - started, error: spawnError,
      });
      if (killing) killing.then(done); else done();
    };
    child.on("error", (e) => { spawnError = e.message; finish(null, null); });
    child.on("close", finish);
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
