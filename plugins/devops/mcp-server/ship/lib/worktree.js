/**
 * @module ship/lib/worktree
 * @description Detect sibling session worktrees and their dirty state.
 *
 *   A "session worktree" is a linked git worktree that lives under
 *   `.claude/worktrees/<name>` (the convention agent sessions use). The ship
 *   pipeline runs from a cwd that may be the MAIN repo root while such a
 *   session worktree is active on the side. If git-mutating work + the ship
 *   were driven from the main repo (instead of inside the worktree), the
 *   feature branch + commits land on the main repo and merge to the default
 *   branch successfully — but the session worktree itself is never inspected
 *   and can be left in a dirty "limbo" state (uncommitted/partial changes).
 *
 *   This helper lets preflight (hard gate) and cleanup (post-merge warning)
 *   enforce the invariant: at ship completion every file in a session worktree
 *   must be tracked→committed→pushed→merged OR gitignored — never in-between.
 *
 *   Style mirrors ship/lib/git.js (thin execSync wrappers, null-on-failure).
 */

import { git } from "./git.js";

// Path segment that marks a worktree as an agent session worktree.
// `git worktree list --porcelain` always emits forward-slash paths, even on
// Windows — match on the forward-slash form so the check is OS-agnostic.
const SESSION_WORKTREE_MARKER = "/.claude/worktrees/";

/**
 * Normalize a filesystem path for comparison: forward slashes, no trailing
 * slash, drive letter lower-cased (Windows paths from different sources differ
 * only in drive-letter case). Mirrors what we need to reliably tell whether a
 * porcelain worktree path is the same directory as `opts.cwd`.
 */
function normPath(p) {
  if (!p) return "";
  let n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Lower-case a leading "C:" style drive letter for case-insensitive match.
  if (/^[A-Za-z]:/.test(n)) n = n[0].toLowerCase() + n.slice(1);
  return n;
}

/**
 * Parse `git worktree list --porcelain` into structured entries.
 * Each entry: { path, branch|null, detached }.
 *
 * Porcelain format is record-per-worktree, blank-line separated:
 *   worktree <abs-path>
 *   HEAD <sha>
 *   branch refs/heads/<name>   (omitted when detached; `detached` line instead)
 */
export function listWorktrees(opts) {
  const output = git("worktree list --porcelain", opts);
  if (!output) return [];
  const entries = [];
  let cur = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) entries.push(cur);
      cur = { path: line.slice("worktree ".length).trim(), branch: null, detached: false };
    } else if (line.startsWith("branch refs/heads/") && cur) {
      cur.branch = line.slice("branch refs/heads/".length).trim();
    } else if (line === "detached" && cur) {
      cur.detached = true;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

/**
 * Whether a worktree path is an agent session worktree (under
 * `.claude/worktrees/`).
 */
export function isSessionWorktreePath(p) {
  return normPath(p).includes(SESSION_WORKTREE_MARKER);
}

/**
 * Report dirtiness of a single worktree at `path`.
 * Returns { path, dirty, changes } where `changes` is the count of porcelain
 * lines. `git status --porcelain` excludes gitignored files by default, so a
 * non-empty result means uncommitted tracked changes OR non-gitignored
 * untracked files — exactly the "limbo" state we must not ship past.
 *
 * On git failure (path gone, not a worktree) we report dirty:false — a path we
 * cannot inspect must not manufacture a false-positive block.
 */
export function worktreeDirty(path, opts = {}) {
  const status = git("status --porcelain", { ...opts, cwd: path });
  if (status === null) return { path, dirty: false, changes: 0 };
  const lines = status.split("\n").filter(Boolean);
  return { path, dirty: lines.length > 0, changes: lines.length };
}

/**
 * List sibling session worktrees (under `.claude/worktrees/`) and their dirty
 * state, EXCLUDING the worktree at `opts.cwd` itself.
 *
 * Intended for use when shipping from the MAIN repo: it surfaces a session
 * worktree that was never inspected because the git-mutating work + ship were
 * driven from the main repo root instead of inside the worktree.
 *
 * Returns an array of { path, branch, dirty, changes }. Excluding `cwd` means
 * the normal in-worktree ship (where the session worktree IS the cwd) does not
 * flag itself — preflight's own clean-tree check already covers that case.
 */
export function sessionWorktrees(opts = {}) {
  const cwdNorm = normPath(opts.cwd || process.cwd());
  return listWorktrees(opts)
    .filter((w) => isSessionWorktreePath(w.path) && normPath(w.path) !== cwdNorm)
    .map((w) => {
      const { dirty, changes } = worktreeDirty(w.path, opts);
      return { path: w.path, branch: w.branch, dirty, changes };
    });
}

/**
 * Convenience: the subset of sessionWorktrees() that are dirty. Empty array
 * means the invariant holds (no sibling session worktree in limbo).
 */
export function dirtySessionWorktrees(opts = {}) {
  return sessionWorktrees(opts).filter((w) => w.dirty);
}
