/**
 * @module crash-guard
 * @version 0.1.0
 * @plugin devops
 * @description Keeps the single devops MCP server alive. Claude Code does not
 *   restart a dead stdio MCP server within a session, so one crash used to
 *   cost the card, usage and ship tools until the next session. This module:
 *     - guardHandler(): wraps a tool handler — a throw or rejection becomes an
 *       MCP error result (isError) instead of an unhandled failure
 *     - installProcessGuards(): uncaughtException / unhandledRejection are
 *       logged to the crash log and the server keeps serving; the process
 *       ends only when the client closes stdin (or SIGINT/SIGTERM), and every
 *       child process is tree-killed on the way out (lib/run-child.js)
 *   Crash log: <tmp>/dotclaude-mcp-crash.log (rotated at 1 MB to .1).
 */

import { appendFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const CRASH_LOG = "dotclaude-mcp-crash.log";
const MAX_LOG_BYTES = 1024 * 1024;

let crashes = 0;
export function crashCount() { return crashes; }

export function crashLogPath(dir = tmpdir()) {
  return join(dir, CRASH_LOG);
}

/** Append one entry; rotate past 1 MB. Never throws. */
export function logCrash(kind, err, dir = tmpdir()) {
  crashes++;
  const file = crashLogPath(dir);
  const detail = err && err.stack ? err.stack : String(err);
  try {
    try { if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, file + ".1"); } catch { /* absent */ }
    appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${kind}: ${detail}\n`, "utf8");
  } catch { /* the log is best effort */ }
  try { process.stderr.write(`[dotclaude-mcp] ${kind} (kept serving): ${detail.split("\n")[0]}\n`); } catch { /* stderr gone */ }
}

/** Wrap a tool handler: a throw becomes an MCP error result. */
export function guardHandler(name, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      logCrash(`tool ${name} threw`, e);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: true, tool: name, message: e && e.message ? e.message : String(e) }) }],
        isError: true,
      };
    }
  };
}

/**
 * Install the process-level guards. `onShutdown` runs once, synchronously,
 * before the process ends (kill children, drop heartbeat).
 */
export function installProcessGuards({ onShutdown } = {}) {
  process.on("uncaughtException", (e) => logCrash("uncaughtException", e));
  process.on("unhandledRejection", (e) => logCrash("unhandledRejection", e));
  let done = false;
  const shutdown = () => {
    if (done) return;
    done = true;
    try { if (onShutdown) onShutdown(); } catch (e) { logCrash("shutdown", e); }
  };
  process.on("exit", shutdown);
  // The client closing stdin is the one regular end of a stdio server.
  const end = () => { shutdown(); process.exit(0); };
  process.stdin.on("end", end);
  process.stdin.on("close", end);
  return shutdown;
}
