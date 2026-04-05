/**
 * @tool ship_cleanup
 * @description Post-ship cleanup: delete local branch, prune worktrees and remotes.
 *   NOTE: ExitWorktree must be called by Claude BEFORE this tool if in a worktree.
 */

import { z } from "zod";
import { git, gitStrict, isWorktree, getWorktreeBranches } from "../lib/git.js";

export const schema = z.object({
  branch: z.string().describe("Feature branch to delete"),
  base: z.string().default("main").describe("Base branch (should already be checked out)"),
  cwd: z.string().nullable().default(null).describe("Working directory override (agent cwd) for worktree detection"),
});

export async function handler(params) {
  const { branch, base, cwd: agentCwd } = params;
  const intermediate = base !== "main";
  const cleaned = [];
  const warnings = [];

  // Guard: refuse to run inside a worktree
  // Check both the MCP server cwd and the agent-provided cwd
  const opts = agentCwd ? { cwd: agentCwd } : {};
  if (isWorktree() || isWorktree(opts)) {
    return {
      success: false,
      error: "Still inside a worktree. Call ExitWorktree(action: 'remove') first, then retry ship_cleanup.",
      cleaned: [],
      warnings: [],
    };
  }

  // Guard: refuse to delete a branch attached to an active worktree
  const worktreeBranches = getWorktreeBranches(opts);
  if (worktreeBranches.has(branch)) {
    return {
      success: false,
      error: `Branch '${branch}' is attached to an active worktree. Cannot delete — worktree session would break. Remove the worktree first (ExitWorktree action:'remove'), then retry.`,
      cleaned: [],
      warnings: [],
    };
  }

  // Record the branch we're on before any checkout, so we can restore it
  const branchBeforeCleanup = git("rev-parse --abbrev-ref HEAD");

  // Guard: verify we're on base branch
  const current = branchBeforeCleanup;
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

  // For intermediate merges: note that the base (feature branch) stays alive
  if (intermediate) {
    warnings.push(`Intermediate merge: base branch '${base}' preserved for further sub-branch merges or final ship to main`);
  }

  // Restore the original branch if we switched away from a non-base branch
  // (avoids disrupting other work in the main working tree)
  if (branchBeforeCleanup && branchBeforeCleanup !== base && branchBeforeCleanup !== branch) {
    try {
      gitStrict(`checkout ${branchBeforeCleanup}`);
      cleaned.push(`restored:${branchBeforeCleanup}`);
    } catch {
      warnings.push(`Could not restore original branch '${branchBeforeCleanup}' — staying on '${base}'`);
    }
  }

  return {
    success: true,
    intermediate,
    branchBeforeCleanup,
    cleaned,
    warnings,
  };
}
