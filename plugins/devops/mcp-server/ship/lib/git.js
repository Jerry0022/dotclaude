/**
 * @module ship/lib/git
 * @description Thin wrappers around git CLI for deterministic execSync calls.
 */

import { execSync } from "node:child_process";

const DEFAULT_TIMEOUT = 15_000;
// eslint-disable-next-line no-unused-vars -- reserved for push/fetch operations
const PUSH_TIMEOUT = 60_000;

/**
 * Run a git command and return trimmed stdout, or null on failure.
 */
export function git(cmd, opts = {}) {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = opts;
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: "utf8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Run a git command and throw on failure (returns trimmed stdout).
 */
export function gitStrict(cmd, opts = {}) {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = opts;
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Get current branch name.
 */
export function currentBranch(opts) {
  return git("rev-parse --abbrev-ref HEAD", opts);
}

/**
 * Check if working tree is dirty. Returns { dirty, untracked, modified, lines }.
 *
 * Uses `--porcelain -z` so the output is NUL-separated with unescaped paths.
 * This avoids two bugs of the plain-porcelain + trim() approach:
 *   1. `.trim()` on the whole output consumed the leading space of the first
 *      line, shifting `slice(3)` off-by-one for dotfile paths (e.g. the first
 *      line " M .claude-plugin/marketplace.json" became
 *      "M .claude-plugin/..." → slice(3) = "claude-plugin/..." with the
 *      leading dot eaten, making `git add` fail with "pathspec did not match").
 *   2. Paths with special characters were quoted/escaped in porcelain v1.
 *
 * Paths are returned relative to the repository root (porcelain semantics),
 * regardless of `opts.cwd`.
 */
export function dirtyState(opts) {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = opts || {};
  let raw;
  try {
    raw = execSync("git status --porcelain -z", {
      cwd,
      encoding: "utf8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return { dirty: false, untracked: [], modified: [], lines: [] };
  }

  const tokens = raw.split("\0");
  const lines = [];
  const untracked = [];
  const modified = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok || tok.length < 3) continue;
    const xy = tok.slice(0, 2);
    const path = tok.slice(3);
    lines.push(tok);

    if (xy === "??") untracked.push(path);
    else modified.push(path);

    // Rename/copy entries emit the source path as a separate NUL-terminated
    // token right after — consume it so it does not become a phantom entry.
    if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C") i++;
  }

  return {
    dirty: lines.length > 0,
    untracked,
    modified,
    lines,
  };
}

/**
 * Count commits ahead of base branch.
 */
export function commitsAhead(base = "main", opts) {
  const count = git(`rev-list --count ${base}..HEAD`, opts);
  return count ? parseInt(count, 10) : 0;
}

/**
 * Count commits not yet pushed to upstream.
 * Returns null if no upstream is configured (new branches that were never pushed).
 * Callers treat null as "OK" — the push step in ship_release will set upstream via -u.
 */
export function unpushedCommits(opts) {
  // Guard: check if upstream is set before using @{upstream}
  const upstream = git("rev-parse --abbrev-ref @{upstream}", opts);
  if (upstream === null) {
    return null; // no upstream configured — branch never pushed, ship_release handles this
  }
  const count = git("rev-list --count @{upstream}..HEAD", opts);
  return count !== null ? parseInt(count, 10) : null;
}

/**
 * Get short commit hash of HEAD.
 */
export function headShort(opts) {
  return git("rev-parse --short HEAD", opts);
}

/**
 * Check if inside a git worktree (not the main working tree).
 */
export function isWorktree(opts) {
  const result = git("rev-parse --git-common-dir", opts);
  const gitDir = git("rev-parse --git-dir", opts);
  return result !== null && gitDir !== null && result !== gitDir;
}

/**
 * Get all branches currently attached to active worktrees.
 * Returns a Set of branch names (e.g. "claude/priceless-goldwasser").
 * Includes the main working tree's branch as well.
 */
export function getWorktreeBranches(opts) {
  const output = git("worktree list --porcelain", opts);
  if (!output) return new Set();
  const branches = new Set();
  for (const line of output.split("\n")) {
    if (line.startsWith("branch refs/heads/")) {
      branches.add(line.slice("branch refs/heads/".length));
    }
  }
  return branches;
}

/**
 * Detect the repository's default branch (the branch `origin/HEAD` points to,
 * typically "main" or "master"). Returns null if origin/HEAD is not set.
 *
 * Callers should fall back to "main" when null is returned — a repo without
 * origin/HEAD is either a fresh local repo or one whose remote.origin.HEAD
 * was never resolved (`git remote set-head origin --auto`).
 */
export function detectDefaultBranch(opts) {
  const ref = git("symbolic-ref --short refs/remotes/origin/HEAD", opts);
  if (!ref) return null;
  // `symbolic-ref --short` returns e.g. "origin/main" — strip the remote prefix.
  return ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
}

/**
 * Check if a branch exists locally or on origin.
 */
export function branchExists(name, opts) {
  const local = git(`rev-parse --verify refs/heads/${name}`, opts);
  if (local !== null) return "local";
  const remote = git(`rev-parse --verify refs/remotes/origin/${name}`, opts);
  if (remote !== null) return "remote";
  return null;
}

/**
 * Detect files modified in both the current branch and the base since their common ancestor.
 * Returns { mergeBase, branchFiles, baseFiles, overlap }.
 */
export function fileOverlap(base, opts) {
  const mergeBase = git(`merge-base HEAD ${base}`, opts);
  if (!mergeBase) return { mergeBase: null, branchFiles: [], baseFiles: [], overlap: [] };

  const branchRaw = git(`diff --name-only ${mergeBase} HEAD`, opts) || "";
  const baseRaw = git(`diff --name-only ${mergeBase} ${base}`, opts) || "";

  const branchFiles = branchRaw.split("\n").filter(Boolean);
  const baseFiles = baseRaw.split("\n").filter(Boolean);
  const baseSet = new Set(baseFiles);
  const overlap = branchFiles.filter((f) => baseSet.has(f));

  return { mergeBase, branchFiles, baseFiles, overlap };
}

/**
 * Check if the current branch contains all commits from the given base ref.
 * Returns true if HEAD is up-to-date with (or ahead of) base.
 */
export function isRebasedOnto(base, opts) {
  const behind = git(`rev-list --count HEAD..${base}`, opts);
  return behind !== null && parseInt(behind, 10) === 0;
}

/**
 * Check git config value. Returns the value or null.
 */
export function getConfig(key, opts) {
  return git(`config --get ${key}`, opts);
}

/**
 * Detect parent branch from sub-branch naming convention.
 * Convention: sub-branches are `<parent>/<role>` (e.g. feat/42-video-filters/core).
 * Strips the last path segment and checks if the remainder exists as a branch.
 * Returns { parent, source } or null if no parent found.
 */
export function detectParentBranch(branch, opts) {
  if (!branch) return null;
  const lastSlash = branch.lastIndexOf("/");
  if (lastSlash <= 0) return null;

  const candidate = branch.slice(0, lastSlash);
  const source = branchExists(candidate, opts);
  if (source) return { parent: candidate, source };

  // Try one more level up (e.g. feat/42/frontend/sub → feat/42/frontend → feat/42)
  const secondSlash = candidate.lastIndexOf("/");
  if (secondSlash > 0) {
    const grandparent = candidate.slice(0, secondSlash);
    const gpSource = branchExists(grandparent, opts);
    if (gpSource) return { parent: grandparent, source: gpSource };
  }

  return null;
}
