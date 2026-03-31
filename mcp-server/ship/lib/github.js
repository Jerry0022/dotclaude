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
 * Squash-merge a PR by number, delete remote branch.
 * Verifies merge actually succeeded via PR state check. Returns merge commit sha.
 */
export function mergePR(prNumber, opts) {
  gh(
    `pr merge ${prNumber} --squash --delete-branch --admin`,
    opts,
  );
  // Verify the PR is actually in MERGED state
  const state = gh(`pr view ${prNumber} --json state -q .state`, opts);
  if (state !== "MERGED") {
    throw new Error(`PR #${prNumber} merge failed — state is "${state}", expected "MERGED"`);
  }
  // Fetch updated main and get the merge commit
  execSync("git fetch origin main", {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const sha = execSync("git rev-parse --short origin/main", {
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

