/**
 * @tool ship_release
 * @description Commit, push, create PR, merge, tag, and create GitHub release.
 */

import { z } from "zod";
import { execFileSync } from "node:child_process";
import { git, gitStrict, currentBranch, headShort, dirtyState, isWorktree, isRebasedOnto, fileOverlap } from "../lib/git.js";
import { createPR, mergePR, createRelease, findExistingPR } from "../lib/github.js";

export const schema = z.object({
  base: z.string().default("main").describe("Base branch for PR (may be a feature branch for intermediate merges)"),
  title: z.string().max(70).describe("PR title (conventional commit format)"),
  body: z.string().describe("PR body (must start with Closes #N if applicable)"),
  tag: z.string().nullable().default(null).describe("Version tag to create (e.g. v0.18.0), null to skip — ignored for intermediate merges"),
  releaseNotes: z.string().nullable().default(null).describe("GitHub release notes (CHANGELOG mirror) — ignored for intermediate merges"),
  prerelease: z.boolean().default(false).describe("Mark as pre-release (for 0.x versions)"),
  commitMessage: z.string().nullable().default(null).describe("If set, stage all and commit with this message before pushing"),
  mergeStrategy: z.enum(["squash", "merge", "rebase"]).default("squash").describe("PR merge strategy. Use 'merge' for overlapping files to preserve ancestry chain."),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

export async function handler(params) {
  const { base, title, body, tag, releaseNotes, prerelease, commitMessage, mergeStrategy } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };
  const branch = currentBranch(opts);
  const intermediate = base !== "main";
  const result = { branch, base, intermediate };

  try {
    // Optional: commit version-bumped files
    if (commitMessage) {
      const state = dirtyState(opts);
      if (state.modified.length > 0) {
        for (const file of state.modified) {
          git(`add -- ${file}`, opts);
        }
      }
      if (state.untracked.length > 0) {
        const safePatterns = ["CHANGELOG.md", "changelog.md"];
        for (const file of state.untracked) {
          if (safePatterns.some(p => file.endsWith(p))) {
            git(`add -- ${file}`, opts);
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
      result.commit = headShort(opts);
    } else {
      const state = dirtyState(opts);
      if (state.dirty) {
        throw new Error(
          `Uncommitted changes detected but no commitMessage provided. ` +
          `${state.modified.length} modified, ${state.untracked.length} untracked file(s) would be lost. ` +
          `Pass commitMessage to include them, or commit/stash before shipping.`
        );
      }
      result.commit = headShort(opts);
    }

    // Safety gate: verify branch is rebased onto latest base (prevents silent overwrites)
    gitStrict(`fetch origin ${base}`, { cwd, timeout: 30_000 });
    if (!isRebasedOnto(`origin/${base}`, opts)) {
      // Check overlap to give actionable context
      const overlap = fileOverlap(`origin/${base}`, opts);
      result.success = false;
      result.rebaseRequired = true;
      result.overlapFiles = overlap.overlap;
      result.error =
        `Branch is not rebased onto origin/${base} (${base} has commits HEAD doesn't include). ` +
        `Run: git rebase origin/${base} — then retry ship_release. ` +
        (overlap.overlap.length > 0
          ? `${overlap.overlap.length} overlapping file(s): ${overlap.overlap.slice(0, 10).join(", ")}`
          : "No file overlap detected — rebase should be clean.");
      return result;
    }
    result.rebased = true;

    // Push (use longer timeout for large repos / slow networks)
    gitStrict(`push -u origin ${branch} --force-with-lease`, { cwd, timeout: 60_000 });
    result.pushed = true;

    // Check for existing open PR before creating a new one
    const existingPR = findExistingPR({ base, head: branch }, opts);
    let pr;
    if (existingPR) {
      if (existingPR.mergeable === "CONFLICTING") {
        result.success = false;
        result.error = `Existing PR #${existingPR.number} is in CONFLICTING state — branch needs updating. Close the PR or rebase and force-push.`;
        return result;
      }
      pr = existingPR;
      result.prReused = true;
    } else {
      pr = createPR({ title, body, base, head: branch }, opts);
    }
    result.pr = { number: pr.number, url: pr.url, title };
    result.mergeStrategy = mergeStrategy;

    // Merge PR (delete branch; skip --delete-branch in worktrees
    // where gh tries to switch to base locally — cleanup handles branch deletion)
    const worktree = isWorktree(opts);
    const mergeSha = mergePR(pr.number, base, opts, { skipDeleteBranch: worktree, strategy: mergeStrategy });
    result.merged = base;
    result.mergeSha = mergeSha;

    // Sync local base branch (worktree-safe: can't checkout base if another worktree owns it)
    if (isWorktree(opts)) {
      gitStrict(`fetch origin ${base}`, opts);
    } else {
      gitStrict(`checkout ${base}`, opts);
      gitStrict(`pull origin ${base}`, opts);
    }

    // Tag + Release (only for final merges to main, skip for intermediate)
    if (!intermediate && tag) {
      try {
        const remoteTag = git(`ls-remote --tags origin ${tag}`, opts);
        if (remoteTag && remoteTag.includes(tag)) {
          result.tagWarning = `Tag ${tag} already exists on remote — skipping creation.`;
          result.tagVerified = true;
        } else {
          // Create tag on the merge commit (origin/base), not on the current HEAD
          gitStrict(`tag ${tag} origin/${base}`, opts);
          gitStrict(`push origin ${tag}`, opts);
          const tagCheck = git(`ls-remote --tags origin ${tag}`, opts);
          result.tagVerified = tagCheck !== null && tagCheck.includes(tag);
        }
        result.tag = tag;
      } catch (e) {
        result.tag = tag;
        result.tagVerified = false;
        result.tagError = e.message?.slice(0, 200);
      }

      if (releaseNotes) {
        try {
          createRelease({ tag, title: tag, notes: releaseNotes, prerelease }, opts);
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
