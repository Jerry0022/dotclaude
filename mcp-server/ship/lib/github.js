/**
 * @module ship/lib/github
 * @description Wrappers around the gh CLI for PR, merge, tag, and release operations.
 */

import { execSync, execFileSync } from "node:child_process";

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
 * Body is passed via stdin to avoid shell escaping issues.
 */
export function createPR({ title, body, base = "main", head }, opts) {
  const cwd = opts?.cwd || process.cwd();
  const raw = execFileSync(
    "gh",
    ["pr", "create", "--title", title, "--body-file", "-", "--base", base, "--head", head, "--json", "number,url"],
    {
      cwd,
      encoding: "utf8",
      input: body,
      timeout: DEFAULT_TIMEOUT,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
  return JSON.parse(raw);
}

/**
 * Squash-merge a PR by number, delete remote branch.
 * Verifies merge actually succeeded via PR state check. Returns merge commit sha.
 * @param {number} prNumber
 * @param {string} base - Base branch name (e.g. "main", "develop")
 * @param {object} [opts]
 */
export function mergePR(prNumber, base = "main", opts) {
  gh(
    `pr merge ${prNumber} --squash --delete-branch --admin`,
    opts,
  );
  // Verify the PR is actually in MERGED state
  const state = gh(`pr view ${prNumber} --json state -q .state`, opts);
  if (state !== "MERGED") {
    throw new Error(`PR #${prNumber} merge failed — state is "${state}", expected "MERGED"`);
  }
  // Fetch updated base branch and get the merge commit
  execSync(`git fetch origin ${base}`, {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const sha = execSync(`git rev-parse --short origin/${base}`, {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT,
  }).trim();
  return sha;
}

/**
 * Create a GitHub release for a tag.
 * Notes are passed via stdin to avoid shell escaping issues.
 */
export function createRelease({ tag, title, notes, prerelease = false }, opts) {
  const cwd = opts?.cwd || process.cwd();
  const args = ["release", "create", tag, "--title", title, "--notes-file", "-"];
  if (prerelease) args.push("--prerelease");
  execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
    input: notes,
    timeout: DEFAULT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

