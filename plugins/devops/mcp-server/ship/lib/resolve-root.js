/**
 * @module ship/lib/resolve-root
 * @description Resolve the git repository root directory.
 *   Used by version.js for the repo-root sweep (plugin-dev scenario).
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";

const _cache = new Map();

/**
 * Returns the absolute path to the git repository root, or null if not in a repo.
 * Result is cached per-cwd for the lifetime of the MCP server process.
 * @param {string} [cwd] - Working directory to resolve from (e.g. worktree path).
 */
export function resolveGitRoot(cwd) {
  const key = cwd || "";
  if (_cache.has(key)) return _cache.get(key) || null;
  try {
    const opts = { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] };
    if (cwd) opts.cwd = cwd;
    const raw = execSync("git rev-parse --show-toplevel", opts).trim();
    const resolved = resolve(raw);
    _cache.set(key, resolved);
    return resolved;
  } catch {
    _cache.set(key, ""); // mark as resolved (no git root)
    return null;
  }
}
