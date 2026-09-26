/**
 * @module mcp-heartbeat
 * @version 0.3.0
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
 *   AUD-C043: per-process files live in their own subdir
 *   (`<tmp>/dotclaude-mcp-heartbeats/<name>-<pid>.pid`) — a liveness check no
 *   longer lists the whole TEMP directory (~146 k entries, ~170 ms), and the
 *   owner prunes dead siblings of its name on start (the flat pre-0.3.0
 *   `dotclaude-mcp-<name>-<pid>.pid` files too), so stale files stop piling
 *   up while any server of that name lives. The flat layout is still removed
 *   on exit and read by hooks/lib/mcp-heartbeat.js for one release.
 *
 *   PID files live in os.tmpdir() — they survive soft reboots but
 *   the PIDs they reference won't, so the health check catches it.
 */

import { writeFileSync, unlinkSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PREFIX = "dotclaude-mcp-";
/** Twin of hooks/lib/mcp-heartbeat.js HEARTBEAT_DIR. */
export const HEARTBEAT_DIR = "dotclaude-mcp-heartbeats";

/** The directory holding the per-process heartbeat files. */
export function heartbeatDir(dir = tmpdir()) {
  return join(dir, HEARTBEAT_DIR);
}

/** This process's own heartbeat file. */
export function processPidFile(name, pid = process.pid, dir = tmpdir()) {
  return join(heartbeatDir(dir), `${name}-${pid}.pid`);
}

/** The pre-0.3.0 flat per-process file — removed on exit, pruned on start. */
export function flatPidFile(name, pid = process.pid, dir = tmpdir()) {
  return join(dir, `${PREFIX}${name}-${pid}.pid`);
}

/** The pre-0.194.2 single file — written for one release, read by old hooks. */
export function legacyPidFile(name, dir = tmpdir()) {
  return join(dir, `${PREFIX}${name}.pid`);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return !!err && err.code === "EPERM"; }
}

/** `<head><digits>.pid` → the PID, else null (no regex: names may hold dots). */
function pidOf(fileName, head) {
  if (!fileName.startsWith(head) || !fileName.endsWith(".pid")) return null;
  const digits = fileName.slice(head.length, -4);
  return /^[0-9]+$/.test(digits) ? parseInt(digits, 10) : null;
}

/**
 * Delete this name's heartbeat files whose process is gone — in the subdir
 * and in the flat pre-0.3.0 layout. Never touches another name's files or a
 * live PID. Best effort; returns how many files were removed.
 */
export function pruneDead(name, dir = tmpdir(), alive = isAlive) {
  let removed = 0;
  const sweep = (folder, head) => {
    let names = [];
    try { names = readdirSync(folder); } catch { return; }
    for (const n of names) {
      const pid = pidOf(n, head);
      if (pid === null || pid === process.pid || (pid > 0 && alive(pid))) continue;
      try { unlinkSync(join(folder, n)); removed++; } catch { /* raced */ }
    }
  };
  sweep(heartbeatDir(dir), `${name}-`);
  sweep(dir, `${PREFIX}${name}-`);
  return removed;
}

/**
 * Remove this process's heartbeat: its own file always, the legacy file only
 * while it still names this PID (another session's server may own it now).
 */
export function unregister(name, pid = process.pid, dir = tmpdir()) {
  try { unlinkSync(processPidFile(name, pid, dir)); } catch { /* already gone */ }
  try { unlinkSync(flatPidFile(name, pid, dir)); } catch { /* already gone */ }
  const legacy = legacyPidFile(name, dir);
  try {
    if (parseInt(readFileSync(legacy, "utf8").trim(), 10) === pid) unlinkSync(legacy);
  } catch { /* absent or unreadable */ }
}

/** Write this process's heartbeat files (no exit handlers). */
export function writeHeartbeat(name, pid = process.pid, dir = tmpdir()) {
  mkdirSync(heartbeatDir(dir), { recursive: true });
  writeFileSync(processPidFile(name, pid, dir), String(pid), "utf8");
  try { writeFileSync(legacyPidFile(name, dir), String(pid), "utf8"); } catch { /* legacy is best-effort */ }
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
    writeHeartbeat(name);
    try { pruneDead(name); } catch { /* pruning is best-effort */ }

    // Clean up on graceful exit
    const cleanup = () => unregister(name);
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  } catch {
    // Non-fatal — health check will just skip this server
  }
}
