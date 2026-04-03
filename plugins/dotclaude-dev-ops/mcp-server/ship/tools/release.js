/**
 * @tool ship_release
 * @description Commit, push, create PR, merge, tag, and create GitHub release.
 */

import { z } from "zod";
import { execFileSync } from "node:child_process";
import { git, gitStrict, currentBranch, headShort, dirtyState } from "../lib/git.js";
import { createPR, mergePR, createRelease, findExistingPR } from "../lib/github.js";

export const schema = z.object({
  base: z.string().default("main").describe("Base branch for PR (may be a feature branch for intermediate merges)"),
  title: z.string().max(70).describe("PR title (conventional commit format)"),
  body: z.string().describe("PR body (must start with Closes #N if applicable)"),
  tag: z.string().nullable().default(null).describe("Version tag to create (e.g. v0.18.0), null to skip — ignored for intermediate merges"),
  releaseNotes: z.string().nullable().default(null).describe("GitHub release notes (CHANGELOG mirror) — ignored for intermediate merges"),
  prerelease: z.boolean().default(false).describe("Mark as pre-release (for 0.x versions)"),
  commitMessage: z.string().nullable().default(null).describe("If set, stage all and commit with this message before pushing"),
});

export async function handler(params) {
  const { base, title, body, tag, releaseNotes, prerelease, commitMessage } = params;
  const cwd = process.cwd();
  const branch = currentBranch();
  const intermediate = base !== "main";
  const result = { branch, base, intermediate };

  try {
    // Optional: commit version-bumped files
    if (commitMessage) {
      // Stage only tracked modified files (version bump files, CHANGELOG, etc.)
      // Do NOT use `git add -A` to avoid accidentally staging untracked build output
      // or sensitive files created between build and release steps.
      const state = dirtyState();
      if (state.modified.length > 0) {
        for (const file of state.modified) {
          git(`add -- ${file}`);
        }
      }
      if (state.untracked.length > 0) {
        // Only stage untracked files that match known version/changelog patterns
        const safePatterns = ["CHANGELOG.md", "changelog.md"];
        for (const file of state.untracked) {
          if (safePatterns.some(p => file.endsWith(p))) {
            git(`add -- ${file}`);
          }
        }
        const skipped = state.untracked.filter(f => !safePatterns.some(p => f.endsWith(p)));
        if (skipped.length > 0) {
          result.skippedFiles = skipped;
        }
      }
      execFileSync("git", ["commit", "-m", commitMessage], {
        cwd,
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      result.commit = headShort();
    } else {
      // Guard: abort if there are staged or modified files that would be left behind
      const state = dirtyState();
      if (state.dirty) {
        throw new Error(
          `Uncommitted changes detected but no commitMessage provided. ` +
          `${state.modified.length} modified, ${state.untracked.length} untracked file(s) would be lost. ` +
          `Pass commitMessage to include them, or commit/stash before shipping.`
        );
      }
      result.commit = headShort();
    }

    // Push (use longer timeout for large repos / slow networks)
    gitStrict(`push -u origin ${branch}`, { timeout: 60_000 });
    result.pushed = true;

    // Check for existing open PR before creating a new one
    const existingPR = findExistingPR({ base, head: branch });
    let pr;
    if (existingPR) {
      pr = existingPR;
      result.prReused = true;
    } else {
      pr = createPR({ title, body, base, head: branch });
    }
    result.pr = { number: pr.number, url: pr.url, title };

    // Merge PR (squash + delete branch)
    gitStrict(`fetch origin ${base}`);
    const mergeSha = mergePR(pr.number, base);
    result.merged = base;
    result.mergeSha = mergeSha;

    // Sync local base branch
    gitStrict(`checkout ${base}`);
    gitStrict(`pull origin ${base}`);

    // Tag + Release (only for final merges to main, skip for intermediate)
    // Tag/release failures are non-fatal — the merge already landed on GitHub.
    if (!intermediate && tag) {
      try {
        // Check if tag already exists before creating
        const localTag = git(`tag -l ${tag}`);
        if (localTag) {
          result.tagWarning = `Tag ${tag} already exists locally — skipping creation`;
        } else {
          gitStrict(`tag ${tag}`);
        }

        const remoteTag = git(`ls-remote --tags origin ${tag}`);
        if (remoteTag && remoteTag.includes(tag)) {
          result.tagWarning = (result.tagWarning || "") + ` Tag ${tag} already exists on remote.`;
          result.tagVerified = true;
        } else {
          gitStrict(`push origin ${tag}`);
          const tagCheck = git(`ls-remote --tags origin ${tag}`);
          result.tagVerified = tagCheck !== null && tagCheck.includes(tag);
        }
        result.tag = tag;
      } catch (e) {
        result.tag = tag;
        result.tagVerified = false;
        result.tagError = e.message?.slice(0, 200);
        // Non-fatal: merge already landed, tag can be created manually
      }

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
    } else if (intermediate && tag) {
      result.tag = null;
      result.tagSkipped = "intermediate merge — tag/release deferred to final ship to main";
    }

    result.success = true;
  } catch (e) {
    result.success = false;
    result.error = e.message?.slice(0, 1000) || "Unknown error";
  }

  return result;
}
