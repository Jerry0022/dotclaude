/**
 * @module mcp-heartbeat
 * @version 0.1.0
 * @description Lightweight heartbeat for MCP servers.
 *   Each server calls register() at startup to write a PID file.
 *   The PreToolUse hook (pre.mcp.health.js) checks these PIDs
 *   to detect dead servers after hard shutdowns / session resume.
 *
 *   PID files live in os.tmpdir() — they survive soft reboots but
 *   the PIDs they reference won't, so the health check catches it.
 */

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PREFIX = "dotclaude-mcp-";

/**
 * Register this MCP server's PID.
 * Call once after server.connect() succeeds.
 *
 * @param {string} name  Server name matching .mcp.json key
 *                        (e.g. "dotclaude-completion", "dotclaude-ship", "dotclaude-issues")
 */
export function register(name) {
  const pidFile = join(tmpdir(), `${PREFIX}${name}.pid`);
  try {
    writeFileSync(pidFile, String(process.pid), "utf8");

    // Clean up on graceful exit
    const cleanup = () => {
      try { unlinkSync(pidFile); } catch { /* already gone */ }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  } catch {
    // Non-fatal — health check will just skip this server
  }
}
