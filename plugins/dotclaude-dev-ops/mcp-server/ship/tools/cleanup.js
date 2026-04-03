/**
 * @tool ship_cleanup
 * @description Post-ship cleanup: delete local branch, prune worktrees and remotes.
 *   NOTE: ExitWorktree must be called by Claude BEFORE this tool if in a worktree.
 */

import { z } from "zod";
import { git, gitStrict, isWorktree } from "../lib/git.js";

export const schema = z.object({
  branch: z.string().describe("Feature branch to delete"),
  base: z.string().default("main").describe("Base branch (should already be checked out)"),
});

export async function handler(params) {
  const { branch, base } = params;
  const cleaned = [];
  const warnings = [];

  // Guard: refuse to run inside a worktree
  if (isWorktree()) {
    return {
      success: false,
      error: "Still inside a worktree. Call ExitWorktree(action: 'remove') first, then retry ship_cleanup.",
      cleaned: [],
      warnings: [],
    };
  }

  // Guard: verify we're on base branch
  const current = git("rev-parse --abbrev-ref HEAD");
  if (current !== base) {
    try {
      gitStrict(`checkout ${base}`);
      gitStrict(`pull origin ${base}`);
      cleaned.push(`checkout:${base}`);
    } catch (e) {
      return {
        success: false,
        error: `Failed to checkout ${base}: ${e.message}`,
        cleaned,
        warnings,
      };
    }
  }

  // Verify remote branch is gone (merge step should have deleted it)
  const remoteBranch = git(`ls-remote --heads origin ${branch}`);
  if (remoteBranch) {
    try {
      gitStrict(`push origin --delete ${branch}`);
      cleaned.push(`remote-branch:${branch}`);
    } catch {
      warnings.push(`Could not delete remote branch ${branch} — may already be deleted`);
    }
  }

  // Delete local branch
  try {
    gitStrict(`branch -D ${branch}`);
    cleaned.push(`local-branch:${branch}`);
  } catch {
    warnings.push(`Local branch ${branch} not found or already deleted`);
  }

  // Prune
  git("worktree prune");
  cleaned.push("worktree-prune");

  git("remote prune origin");
  cleaned.push("remote-prune");

  return {
    success: true,
    cleaned,
    warnings,
  };
}
