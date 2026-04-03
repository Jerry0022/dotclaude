/**
 * @module ship/lib/git
 * @description Thin wrappers around git CLI for deterministic execSync calls.
 */

import { execSync } from "node:child_process";

const DEFAULT_TIMEOUT = 15_000;

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
 * Returns null if no upstream is configured (instead of letting git fail).
 */
export function unpushedCommits(opts) {
  // Guard: check if upstream is set before using @{upstream}
  const upstream = git("rev-parse --abbrev-ref @{upstream}", opts);
  if (upstream === null) {
    return null; // no upstream configured
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
