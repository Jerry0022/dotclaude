/**
 * @module ship/lib/git
 * @description Thin wrappers around git CLI for deterministic execSync calls.
 */

import { execSync } from "node:child_process";

const DEFAULT_TIMEOUT = 15_000;
const PUSH_TIMEOUT = 60_000; // Push/fetch may take longer on large repos or slow networks

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
 */
export function dirtyState(opts) {
  const status = git("status --porcelain", opts) || "";
  const lines = status.split("\n").filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith("??"));
  const modified = lines.filter((l) => !l.startsWith("??"));
  return {
    dirty: lines.length > 0,
    untracked: untracked.map((l) => l.slice(3)),
    modified: modified.map((l) => l.slice(3)),
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
