/**
 * @module ship/lib/resolve-root
 * @description Resolve the git repository root directory.
 *   Used by version.js for the repo-root sweep (plugin-dev scenario).
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";

let _cached = null;

/**
 * Returns the absolute path to the git repository root, or null if not in a repo.
 * Result is cached for the lifetime of the MCP server process.
 */
export function resolveGitRoot() {
  if (_cached !== null) return _cached || null;
  try {
    const raw = execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    _cached = resolve(raw);
    return _cached;
  } catch {
    _cached = ""; // mark as resolved (no git root)
    return null;
  }
}
