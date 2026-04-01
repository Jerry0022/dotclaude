/**
 * @tool ship_release
 * @description Commit, push, create PR, merge, tag, and create GitHub release.
 */

import { z } from "zod";
import { execSync, execFileSync } from "node:child_process";
import { git, gitStrict, currentBranch, headShort } from "../lib/git.js";
import { createPR, mergePR, createRelease } from "../lib/github.js";

export const schema = z.object({
  base: z.string().default("main").describe("Base branch for PR"),
  title: z.string().max(70).describe("PR title (conventional commit format)"),
  body: z.string().describe("PR body (must start with Closes #N if applicable)"),
  tag: z.string().nullable().default(null).describe("Version tag to create (e.g. v0.18.0), null to skip"),
  releaseNotes: z.string().nullable().default(null).describe("GitHub release notes (CHANGELOG mirror)"),
  prerelease: z.boolean().default(false).describe("Mark as pre-release (for 0.x versions)"),
  commitMessage: z.string().nullable().default(null).describe("If set, stage all and commit with this message before pushing"),
});

export async function handler(params) {
  const { base, title, body, tag, releaseNotes, prerelease, commitMessage } = params;
  const cwd = process.cwd();
  const branch = currentBranch();
  const result = { branch, base };

  try {
    // Optional: commit version-bumped files
    if (commitMessage) {
      gitStrict("add -A");
      execFileSync("git", ["commit", "-m", commitMessage], {
        cwd,
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      result.commit = headShort();
    } else {
      result.commit = headShort();
    }

    // Push
    gitStrict(`push -u origin ${branch}`);
    result.pushed = true;

    // Create PR
    const pr = createPR({ title, body, base, head: branch });
    result.pr = { number: pr.number, url: pr.url, title };

    // Merge PR (squash + delete branch)
    gitStrict(`fetch origin ${base}`);
    const mergeSha = mergePR(pr.number, base);
    result.merged = base;
    result.mergeSha = mergeSha;

    // Sync local main
    gitStrict(`checkout ${base}`);
    gitStrict(`pull origin ${base}`);

    // Tag (if provided)
    if (tag) {
      gitStrict(`tag ${tag}`);
      gitStrict(`push origin ${tag}`);
      result.tag = tag;

      // Verify tag on remote
      const tagCheck = git(`ls-remote --tags origin ${tag}`);
      result.tagVerified = tagCheck !== null && tagCheck.includes(tag);

      // Create GitHub Release
      if (releaseNotes) {
        try {
          createRelease({ tag, title: tag, notes: releaseNotes, prerelease });
          result.release = true;
        } catch (e) {
          result.release = false;
          result.releaseError = e.message?.slice(0, 200);
        }
      }
    }

    result.success = true;
  } catch (e) {
    result.success = false;
    result.error = e.message?.slice(0, 500) || "Unknown error";
  }

  return result;
}
