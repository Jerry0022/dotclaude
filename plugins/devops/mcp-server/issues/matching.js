/**
 * @module issues/matching
 * @description Pure fuzzy-matching utilities for issue search — the same
 *   code the prompt.issue.detect hook runs (hooks/lib/issue-match.js) — plus
 *   the input contract of the `match_issues` tool.
 */

import { createRequire } from "node:module";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const shared = createRequire(import.meta.url)("../../hooks/lib/issue-match.js");

export const tokenize = shared.tokenize;
export const scoreIssue = shared.scoreIssue;

/** `gh issue list --limit`; a list this long may have been cut off. */
export const ISSUE_LIST_LIMIT = 100;

/**
 * Project directory for the `gh`/`git` calls. The server itself runs in the
 * plugin folder, which is not the user's repo — so an explicit `cwd` wins, then
 * CLAUDE_PROJECT_DIR; undefined means "unknown".
 */
export function resolveCwd(arg, env = process.env) {
  if (typeof arg === "string" && arg.trim()) return arg;
  const e = env && env.CLAUDE_PROJECT_DIR;
  return typeof e === "string" && e.trim() ? e : undefined;
}

/**
 * Canonical cache key for a project dir: resolved absolute path of an
 * existing directory, else null — `./x`, `x/` and `x` share one entry and a
 * nonexistent path never gets one.
 */
export function normalizeCwd(dir) {
  if (typeof dir !== "string" || !dir.trim()) return null;
  const abs = path.resolve(dir);
  try { return fs.statSync(abs).isDirectory() ? abs : null; } catch { return null; }
}

/** Max project caches the server keeps (and refreshes every interval). */
export const MAX_CACHES = 16;

/**
 * LRU get-or-create on a Map: a hit moves the key to the newest end; past
 * `cap` entries the least recently used one is dropped.
 */
export function lruGet(map, key, make, cap = MAX_CACHES) {
  let v = map.get(key);
  if (v) map.delete(key);
  else v = make();
  map.set(key, v);
  while (map.size > cap) map.delete(map.keys().next().value);
  return v;
}

/** Input bounds for match_issues (a negative max_results used to slice(0, -1)). */
export const matchIssuesShape = {
  query: z.string().describe("The user's prompt text to match against open issues"),
  max_results: z.number().int().min(1).max(20).default(3).describe("Max number of matches to return (1-20)"),
  threshold: z.number().min(0).max(1).default(0.25).describe("Minimum confidence threshold (0-1)"),
  cwd: z.string().optional().describe(
    "Absolute path of the user's project. The MCP server runs in the plugin folder, " +
    "so gh/git would otherwise look at the wrong repo. Defaults to CLAUDE_PROJECT_DIR.",
  ),
};
