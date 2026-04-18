/**
 * @module ship/lib/sentinel
 * @description Writes/clears the ship-in-progress sentinel file.
 *   Mirror of hooks/lib/ship-sentinel.js (CJS) for the MCP server (ESM).
 *   Keep the SENTINEL_REL path in sync between both.
 */

import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

export const SENTINEL_REL = ".claude/.ship-in-progress";

export function sentinelPath(cwd) {
  return join(cwd, ".claude", ".ship-in-progress");
}

export function writeSentinel(cwd) {
  if (!cwd) return false;
  const p = sentinelPath(cwd);
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ts: Date.now(), pid: process.pid }), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function clearSentinel(cwd) {
  if (!cwd) return false;
  const p = sentinelPath(cwd);
  try { unlinkSync(p); return true; } catch { return false; }
}
