/**
 * @module ship/lib/github
 * @description Wrappers around the gh CLI for PR, merge, tag, and release operations.
 */

import { execSync } from "node:child_process";

const DEFAULT_TIMEOUT = 30_000;

function gh(cmd, opts = {}) {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = opts;
  return execSync(`gh ${cmd}`, {
    cwd,
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Create a PR and return { number, url }.
 */
export function createPR({ title, body, base = "main", head }, opts) {
  const raw = gh(
    `pr create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --base ${base} --head ${head} --json number,url`,
    opts,
  );
  return JSON.parse(raw);
}

/**
 * Squash-merge a PR by number, delete remote branch. Returns merge commit sha.
 */
export function mergePR(prNumber, opts) {
  gh(
    `pr merge ${prNumber} --squash --delete-branch --admin`,
    opts,
  );
  // Get the merge commit from main
  const sha = execSync("git rev-parse --short main", {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT,
  }).trim();
  return sha;
}

/**
 * Create a GitHub release for a tag.
 */
export function createRelease({ tag, title, notes, prerelease = false }, opts) {
  const preFlag = prerelease ? " --prerelease" : "";
  const notesEscaped = notes.replace(/"/g, '\\"');
  gh(
    `release create ${tag} --title "${title}" --notes "${notesEscaped}"${preFlag}`,
    opts,
  );
}

/**
 * Get repo name in owner/repo format.
 */
export function repoName(opts) {
  return gh("repo view --json nameWithOwner -q .nameWithOwner", opts);
}
