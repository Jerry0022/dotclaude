#!/usr/bin/env node
/**
 * Release-only gate for the "Full suite" workflow.
 *
 * Every ship pushes twice to its PR: the feature commit (early draft PR) and,
 * after ship_version_bump, the release commit (version + CHANGELOG). The full
 * suite ran on both — 4–11 min for a commit that changes no code. This gate
 * lets the second run reuse the first: when the push only adds release files
 * on top of a head whose `suite` check is green, the shards are skipped and
 * the `suite` aggregate reports success. The required check stays in place.
 *
 * Fails open: any API error, a force-push (base not an ancestor), a code file
 * in the diff or a head without a green `suite` → the suite runs as before.
 *
 * Usage (GitHub Actions): node .github/scripts/release-only-gate.js
 *   env: GITHUB_TOKEN, GITHUB_REPOSITORY, BEFORE_SHA, HEAD_SHA, EVENT_ACTION
 *   writes `skip=true|false` to $GITHUB_OUTPUT
 */

"use strict";

const fs = require("node:fs");

/** Files a release commit may touch (ship_version_bump + CHANGELOG). */
const RELEASE_FILES = [
  /^CHANGELOG\.md$/,
  /^README\.md$/,
  /^\.claude-plugin\/marketplace\.json$/,
  /^plugins\/[^/]+\/\.claude-plugin\/plugin\.json$/,
];

const isReleaseFile = (f) => RELEASE_FILES.some((re) => re.test(f));

/**
 * Pure decision.
 * @param {{ action?: string, compareStatus?: string, files?: string[], suiteGreen?: boolean }} i
 * @returns {{ skip: boolean, reason: string }}
 */
function decide({ action, compareStatus, files, suiteGreen }) {
  if (action !== "synchronize") return { skip: false, reason: "not a follow-up push" };
  if (compareStatus !== "ahead") return { skip: false, reason: `previous head is not an ancestor (${compareStatus || "unknown"})` };
  if (!Array.isArray(files) || files.length === 0) return { skip: false, reason: "no changed files reported" };
  const code = files.filter((f) => !isReleaseFile(f));
  if (code.length) return { skip: false, reason: `non-release files changed: ${code.slice(0, 5).join(", ")}` };
  if (!suiteGreen) return { skip: false, reason: "previous head has no green suite check" };
  return { skip: true, reason: `release-only push (${files.join(", ")}) on a green head` };
}

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, BEFORE_SHA: before, HEAD_SHA: head, EVENT_ACTION: action } = process.env;
  let verdict;
  try {
    if (action !== "synchronize" || !before || !head || /^0+$/.test(before)) {
      verdict = decide({ action });
    } else {
      const cmp = await gh(`/repos/${repo}/compare/${before}...${head}`, token);
      const runs = await gh(`/repos/${repo}/commits/${before}/check-runs?check_name=suite&per_page=20`, token);
      const suiteGreen = (runs.check_runs || []).some((r) => r.status === "completed" && r.conclusion === "success");
      verdict = decide({ action, compareStatus: cmp.status, files: (cmp.files || []).map((f) => f.filename), suiteGreen });
    }
  } catch (e) {
    verdict = { skip: false, reason: `gate error, running the suite: ${e.message}` };
  }
  console.log(`release-only gate: skip=${verdict.skip} — ${verdict.reason}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${verdict.skip}\n`);
}

if (require.main === module) main();

module.exports = { decide, isReleaseFile, RELEASE_FILES };
