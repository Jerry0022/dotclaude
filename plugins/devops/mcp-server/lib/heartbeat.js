/**
 * @module mcp-heartbeat
 * @version 0.2.0
 * @description Lightweight heartbeat for MCP servers.
 *   Each server calls register() at startup to write a PID file.
 *   The PreToolUse hook (pre.mcp.health.js) checks these PIDs
 *   to detect dead servers after hard shutdowns / session resume.
 *
 *   One file PER PROCESS (`dotclaude-mcp-<name>-<pid>.pid`): every open Claude
 *   session runs its own copy of each server, and a single shared file per
 *   name let the last writer own the slot — when any session's server exited,
 *   it deleted the file although the others were alive, and every hook
 *   reported "heartbeat dead" (observed 2026-09-24). Readers live in
 *   hooks/lib/mcp-heartbeat.js.
 *
 *   The legacy single file `dotclaude-mcp-<name>.pid` is still written for one
 *   release, so hooks of an older install keep reading something; it is only
 *   removed on exit when it still holds this process's PID.
 *
 *   PID files live in os.tmpdir() — they survive soft reboots but
 *   the PIDs they reference won't, so the health check catches it.
 */

import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PREFIX = "dotclaude-mcp-";

/** This process's own heartbeat file. */
export function processPidFile(name, pid = process.pid, dir = tmpdir()) {
  return join(dir, `${PREFIX}${name}-${pid}.pid`);
}

/** The pre-0.194.2 single file — written for one release, read by old hooks. */
export function legacyPidFile(name, dir = tmpdir()) {
  return join(dir, `${PREFIX}${name}.pid`);
}

/**
 * Remove this process's heartbeat: its own file always, the legacy file only
 * while it still names this PID (another session's server may own it now).
 */
export function unregister(name, pid = process.pid, dir = tmpdir()) {
  try { unlinkSync(processPidFile(name, pid, dir)); } catch { /* already gone */ }
  const legacy = legacyPidFile(name, dir);
  try {
    if (parseInt(readFileSync(legacy, "utf8").trim(), 10) === pid) unlinkSync(legacy);
  } catch { /* absent or unreadable */ }
}

/**
 * Register this MCP server's PID.
 * Call once after server.connect() succeeds.
 *
 * @param {string} name  Server name matching .mcp.json key
 *                        (e.g. "dotclaude-completion", "dotclaude-ship", "dotclaude-issues")
 */
export function register(name) {
  try {
    writeFileSync(processPidFile(name), String(process.pid), "utf8");
    try { writeFileSync(legacyPidFile(name), String(process.pid), "utf8"); } catch { /* legacy is best-effort */ }

    // Clean up on graceful exit
    const cleanup = () => unregister(name);
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  } catch {
    // Non-fatal — health check will just skip this server
  }
}
