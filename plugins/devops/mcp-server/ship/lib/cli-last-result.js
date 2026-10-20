/**
 * @module ship/lib/cli-last-result
 * @description The offline ship CLI's last result on disk:
 *   `<repo root>/.claude/.ship-cli-last.json` = `{ tool, at, root, result }`.
 *
 *   Runtime state (git-ignored via hooks/lib/runtime-ignores.js). The
 *   run-contract post hook (post.run.contract.js) reads it when the CLI's
 *   stdout was redirected to a file and the Bash tool response carries no
 *   JSON — a CLI ship_release then still counts as the do-ship release. The
 *   hook only trusts fresh entries (≤ 10 min) of the same repo root.
 */

import { createRequire } from "node:module";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LAST_RESULT_FILE = ".ship-cli-last.json";

/** The file for a target-repo cwd (same root resolution as the hooks). */
export function lastResultPath(cwd) {
  const { projectRoot } = createRequire(import.meta.url)("../../../hooks/lib/project-root.js");
  const root = projectRoot(cwd);
  return { root, file: join(root, ".claude", LAST_RESULT_FILE) };
}

/** Write atomically; returns the path, or null when skipped/failed. Never throws. */
export function writeLastResult(tool, params, result, { now = Date.now() } = {}) {
  let tmp = null;
  try {
    if (!params || typeof params.cwd !== "string" || !params.cwd.trim()) return null;
    const { root, file } = lastResultPath(params.cwd);
    mkdirSync(dirname(file), { recursive: true });
    tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tool, at: new Date(now).toISOString(), root, result }, null, 2));
    renameSync(tmp, file);
    return file;
  } catch {
    if (tmp) { try { unlinkSync(tmp); } catch { /* nothing to clean */ } }
    return null;
  }
}
