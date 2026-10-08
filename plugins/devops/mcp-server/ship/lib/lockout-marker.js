/**
 * @module ship/lib/lockout-marker
 * @description Clears do-ship's per-ship lockout marker `.claude/.ship-lockout`.
 *   ESM door to hooks/lib/ship-lockout-marker.js (CJS), which owns the path,
 *   the TTL and the why. ship_cleanup clears it next to the ship-in-progress
 *   sentinel, so no exit path that cleans up strands it.
 */

import { createRequire } from "node:module";

export function clearLockoutMarker(cwd) {
  if (!cwd) return false;
  // Lazy: MCP servers do no work before connect (CONVENTIONS.md § Boot Discipline).
  const require = createRequire(import.meta.url);
  const { clearMarker } = require("../../../hooks/lib/ship-lockout-marker.js");
  return clearMarker(cwd);
}
