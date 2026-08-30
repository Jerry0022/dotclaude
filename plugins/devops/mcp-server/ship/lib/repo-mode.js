import { execFileSync } from "node:child_process"
import path from "node:path"

// No cache: long-lived MCP server could see git init / remote changes
// between calls. Each detectRepoMode runs <5ms; staleness is the bigger risk.

// Every probe is bounded. The MCP server is long-lived and `cwd` can sit on a
// network drive or a stale mount, where an unbounded execFileSync blocks the
// whole server. Matches the timeout every hook-side detector already sets.
const PROBE_TIMEOUT_MS = 4000

function gitOut(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PROBE_TIMEOUT_MS,
    }).trim()
  } catch {
    return null
  }
}

/** Compare two filesystem paths for identity, tolerating separator + case differences. */
function samePath(a, b) {
  if (!a || !b) return false
  const norm = (p) => {
    const resolved = path.resolve(String(p)).replace(/[\\/]+$/, "")
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  return norm(a) === norm(b)
}

/**
 * Classify how `cwd` relates to git.
 *
 *   "none"             — not inside a work tree at all
 *   "git-foreign-root" — inside a work tree whose ROOT is not `cwd`; the repo
 *                        belongs to an ancestor directory, not to this project
 *   "git-no-remote"    — this directory is the repo root, but has no origin
 *   "git"              — this directory is the repo root and has an origin
 *
 * WHY "git-foreign-root" EXISTS
 * `git rev-parse --is-inside-work-tree` is ANCESTOR-AWARE: it succeeds for any
 * directory nested under a repo. A plain non-git project that happens to live
 * below a dotfiles/home/monorepo checkout therefore classified as "git", and
 * ship_cleanup went on to run `git checkout <base>` and `git pull --ff-only`
 * against the ANCESTOR's repo — writes to something the user never targeted.
 * Callers that perform destructive git operations must refuse this mode.
 *
 * Note the strict `=== "true"` on the work-tree probe: the command PRINTS
 * "false" and exits 0 when cwd is inside a `.git` directory or a bare repo, so
 * an exit-code-only check misclassified both as a normal work tree.
 */
export function detectRepoMode(cwd) {
  if (gitOut(["rev-parse", "--is-inside-work-tree"], cwd) !== "true") return "none"

  const toplevel = gitOut(["rev-parse", "--show-toplevel"], cwd)
  if (!toplevel || !samePath(toplevel, cwd)) return "git-foreign-root"

  return gitOut(["remote", "get-url", "origin"], cwd) === null ? "git-no-remote" : "git"
}

/**
 * Is `cwd` inside a git work tree at all?
 *
 * Deliberately true for "git-foreign-root" — it IS a work tree, just one
 * rooted above `cwd`. Callers that care about the distinction (anything
 * destructive) must test `detectRepoMode` directly.
 */
export function isGitRepo(cwd) {
  const mode = detectRepoMode(cwd)
  return mode === "git" || mode === "git-no-remote" || mode === "git-foreign-root"
}

/**
 * Modes in which a tool must NOT run destructive git operations: there is
 * either no repo, or the repo belongs to a directory above this project.
 */
export function refusesGitWrites(mode) {
  return mode === "none" || mode === "git-foreign-root"
}
