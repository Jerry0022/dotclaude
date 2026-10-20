/**
 * The card's "🧠 N Calls" note — read the tool-call counter post.flow.completion
 * writes under the REAL harness session id (`dotclaude-devops-toolcalls-<id>`).
 *
 * The model renders the card with `session_id` "self", a Desktop `local_…` id
 * or nothing, so the exact lookup misses on the normal path. The old fallback
 * read the newest counter of ANY session, so two parallel sessions showed
 * whichever one called a tool last (card audit row 6). Resolution order:
 *
 *   1. the exact file for the given id (the hooks' `sessionFile` naming);
 *   2. the real id: a counter (≤ 30 min old) whose session has a transcript under this
 *      work tree's Claude Code project directory
 *      (`<config>/projects/<slug(cwd)>/<id>.jsonl`), newest first;
 *   3. still unresolvable (no project directory to check against): the
 *      newest counter no older than 30 minutes.
 *
 * When the project directory exists but no counter of its sessions does, the
 * note is hidden (0) rather than borrowed from a foreign session.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const TOOLCALL_PREFIX = "dotclaude-devops-toolcalls-";
export const TOOLCALL_MAX_AGE_MS = 30 * 60 * 1000;

/** Claude Code's project directory name for a cwd: every non-alphanumeric → "-". */
export function projectSlug(cwd) {
  return String(cwd || "").replace(/[^A-Za-z0-9]/g, "-");
}

/** Candidate project directories for `cwd`, in lookup order. */
function projectDirs(cwd, env) {
  if (!cwd) return [];
  const slug = projectSlug(cwd);
  const roots = [];
  if (env.CLAUDE_CONFIG_DIR) roots.push(env.CLAUDE_CONFIG_DIR);
  roots.push(join(env.HOME || env.USERPROFILE || homedir(), ".claude"));
  return roots.map((r) => join(r, "projects", slug)).filter((d) => {
    try { return statSync(d).isDirectory(); } catch { return false; }
  });
}

function readCount(file) {
  try { return parseInt(readFileSync(file, "utf8"), 10) || 0; } catch { return 0; }
}

/**
 * @param {string|undefined} sessionId the card's (sanitised) session id
 * @param {{ cwd?: string, dir?: string, env?: object, now?: number }} [opts]
 * @returns {number}
 */
export function readToolCallCount(sessionId, opts = {}) {
  const dir = opts.dir || tmpdir();
  const env = opts.env || process.env;
  const now = opts.now || Date.now();
  const exact = join(dir, `${TOOLCALL_PREFIX}${sessionId || "unknown"}`);
  if (existsSync(exact)) return readCount(exact);

  let files = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(TOOLCALL_PREFIX) || f.endsWith(".tmp")) continue;
      const full = join(dir, f);
      try { files.push({ id: f.slice(TOOLCALL_PREFIX.length), full, mtime: statSync(full).mtimeMs }); } catch { /* vanished */ }
    }
  } catch { return 0; }
  files = files.filter((f) => now - f.mtime <= TOOLCALL_MAX_AGE_MS).sort((a, b) => b.mtime - a.mtime);

  const projects = projectDirs(opts.cwd, env);
  if (projects.length) {
    const own = files.find((f) => projects.some((p) => existsSync(join(p, `${f.id}.jsonl`))));
    return own ? readCount(own.full) : 0;
  }
  return files.length ? readCount(files[0].full) : 0;
}
