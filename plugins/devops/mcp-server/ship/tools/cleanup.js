/**
 * @tool ship_cleanup
 * @description Post-ship cleanup: delete local branch, prune worktrees and remotes.
 *   NOTE: ExitWorktree must be called by Claude BEFORE this tool if in a worktree.
 */

import { z } from "zod";
import { execFileSync } from "node:child_process";
import { git, gitArgs, gitTry, isWorktree, getWorktreeBranches, detectDefaultBranch, NETWORK_TIMEOUT } from "../lib/git.js";
import { dirtySessionWorktrees } from "../lib/worktree.js";
import { clearSentinel } from "../lib/sentinel.js";
import { clearLockoutMarker } from "../lib/lockout-marker.js";
import { releaseLandingLockFor } from "../lib/landing-lock.js";
import { detectRepoMode, refusesGitWrites, probeTimeoutError } from "../lib/repo-mode.js";

export const schema = z.object({
  branch: z.string().describe("Feature branch to delete"),
  base: z.string().default("main").describe("Base branch (should already be checked out)"),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
  keep: z.boolean().default(false).describe("Keep-mode: skip all branch/worktree deletion. Only clears the ship-in-progress sentinel (so Edit guards reset) and the do-ship lockout marker. Use when follow-up work is expected in this same branch/worktree."),
});

/**
 * Clear the per-ship state every exit must drop: the ship-in-progress sentinel
 * (main-branch guards resume) and do-ship's `.claude/.ship-lockout` marker (the
 * next interactive ship must not inherit an AFK lockout). Returns the entries
 * for `cleaned`; the marker is listed only when one was actually removed.
 */
function clearShipState(cwd) {
  clearSentinel(cwd);
  return clearLockoutMarker(cwd) ? ["sentinel", "lockout-marker"] : ["sentinel"];
}

/**
 * `git status --porcelain` lines of the worktree (leading status column kept),
 * timeout-bounded; null when git fails - the caller then runs its own check.
 */
export function porcelainLines(cwd) {
  try {
    const out = execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], {
      windowsHide: true, cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter((l) => l.trim() !== "");
  } catch { return null; }
}

/**
 * Keep-mode after a merged ship (#942): the squash landed on `origin/<base>`,
 * the remote branch is gone, but the kept local branch still carries the
 * pre-squash commits — they exist on no remote and the app refuses a clean
 * archive. When the branch's tree equals the merged base, point the branch at
 * `origin/<base>` (a guarded ref move like local-merge.js: same tree, so index
 * and working tree already match) and drop the gone upstream.
 *
 * Moves nothing unless all hold: HEAD is `branch`, the tree is clean, the
 * upstream was set and is gone (a ship-blocked exit never pushed or still has
 * its remote branch), and the trees match. Returns { synced, from, to } or
 * { synced: false, reason }.
 */
export function syncKeptBranch(cwd, branch, base) {
  const opts = { cwd };
  if (gitTry(["rev-parse", "--abbrev-ref", "HEAD"], opts) !== branch) return { synced: false, reason: "not-on-branch" };
  const dirty = porcelainLines(cwd);
  if (dirty === null || dirty.length > 0) return { synced: false, reason: "dirty-tree" };
  if (!gitTry(["config", "--get", `branch.${branch}.merge`], opts)) return { synced: false, reason: "no-upstream" };
  gitTry(["fetch", "--prune", "origin"], { cwd, timeout: NETWORK_TIMEOUT });
  if (gitTry(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], opts)) {
    return { synced: false, reason: "upstream-present" };
  }
  const headSha = gitTry(["rev-parse", "HEAD"], opts);
  const baseSha = gitTry(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`], opts);
  if (!headSha || !baseSha) return { synced: false, reason: "unresolved-ref" };
  if (headSha === baseSha) return { synced: false, reason: "already-on-base" };
  if (gitTry(["rev-parse", `${headSha}^{tree}`], opts) !== gitTry(["rev-parse", `${baseSha}^{tree}`], opts)) {
    return { synced: false, reason: "tree-differs" };
  }
  try {
    gitArgs(["update-ref", `refs/heads/${branch}`, baseSha, headSha], opts);
  } catch (e) {
    return { synced: false, reason: `update-ref failed: ${String(e && e.message).split("\n")[0]}` };
  }
  gitTry(["branch", "--unset-upstream", branch], opts);
  return { synced: true, from: headSha, to: baseSha };
}

export async function handler(params) {
  const { branch, base, cwd, keep } = params;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };
  const intermediate = base !== (detectDefaultBranch(opts) || "main");
  const cleaned = [];
  const warnings = [];

  // Repo-mode gate. This was the ONLY ship tool without one, while being the
  // most destructive: it runs `git checkout <base>`, `git pull --ff-only
  // origin <base>` and branch deletion.
  //   - "none":             those commands died with a raw git fatal, at the
  //                         last step of a pipeline preflight had declared
  //                         ready in file-only mode.
  //   - "git-foreign-root": far worse — the repo belongs to an ANCESTOR
  //                         directory, so the checkout and pull silently
  //                         operated on a repository the user never targeted.
  const repoMode = detectRepoMode(cwd);
  // Timed-out probe: keep the sentinel and the lockout marker (the ship may
  // still be in flight) and say so — never delete a branch on a guess, never
  // report a cleanup (#411).
  if (repoMode === "unknown") {
    return {
      success: false,
      skipped: false,
      reason: "git-probe-timeout",
      mode: repoMode,
      intermediate,
      branchBeforeCleanup: null,
      cleaned: [],
      warnings: [],
      error: probeTimeoutError(cwd),
    };
  }
  if (refusesGitWrites(repoMode)) {
    const shipState = clearShipState(cwd);
    const reason = repoMode === "none" ? "file-only-mode" : "foreign-repo-root";
    return {
      success: true,
      skipped: true,
      reason,
      mode: repoMode,
      intermediate,
      branchBeforeCleanup: null,
      cleaned: shipState,
      warnings: [
        repoMode === "none"
          ? "No git repository — nothing to clean up (no branch, no worktree, no remote)."
          : `Repository root is not this directory (${cwd} sits inside a parent repo). ` +
            `Refusing to check out, pull or delete branches in a repo this project does not own.`,
      ],
    };
  }

  // A landing lock this branch still holds (release crashed before its finally).
  let landingLockReleased = false;
  try { landingLockReleased = releaseLandingLockFor(cwd, { branch }); } catch { /* never blocks cleanup */ }
  const lockFields = landingLockReleased ? { landingLockReleased: true } : {};

  // Keep-mode (also every ship-blocked exit): skip all destructive cleanup.
  // Only the per-ship state goes, so Edit/branch guards stop treating this as
  // "ship in progress" and the next ship does not inherit the lockout marker.
  if (keep) {
    const shipState = clearShipState(cwd);
    const keepWarnings = [`Keep-mode: branch '${branch}' and worktree preserved for follow-up work`];
    let branchSync = { synced: false, reason: "intermediate" };
    if (!intermediate) {
      try { branchSync = syncKeptBranch(cwd, branch, base); } catch (e) { branchSync = { synced: false, reason: String(e && e.message) }; }
    }
    if (branchSync.synced) {
      shipState.push(`branch-synced:${base}`);
      keepWarnings.push(`Keep-mode: '${branch}' moved to origin/${base} (merged, same tree) — no unpushed commits left`);
    } else if (branchSync.reason === "tree-differs") {
      keepWarnings.push(`Keep-mode: '${branch}' left as is — its tree differs from origin/${base}, so it holds work that did not land`);
    }
    return {
      success: true,
      kept: true,
      intermediate,
      branchBeforeCleanup: git("rev-parse --abbrev-ref HEAD", opts) || null,
      cleaned: shipState,
      warnings: keepWarnings,
      branchSync,
      porcelain: porcelainLines(cwd),
      ...lockFields,
    };
  }

  // Guard: refuse to run inside a worktree
  if (isWorktree(opts)) {
    clearShipState(cwd);
    return {
      success: false,
      error: "Still inside a worktree. Harness-created worktree (Claude Desktop): call ship_cleanup with keep: true — the app owns the worktree lifecycle and ship_release already deleted the remote branch. EnterWorktree-created worktree: call ExitWorktree(action: 'remove') first, then retry.",
      cleaned: [],
      warnings: [],
    };
  }

  // Guard: refuse to delete a branch attached to an active worktree
  const worktreeBranches = getWorktreeBranches(opts);
  if (worktreeBranches.has(branch)) {
    clearShipState(cwd);
    return {
      success: false,
      error: `Branch '${branch}' is attached to an active worktree. Cannot delete — worktree session would break. Harness-created worktree (Claude Desktop): use keep: true — the app removes worktree + branch. EnterWorktree-created: ExitWorktree(action:'remove') first, then retry.`,
      cleaned: [],
      warnings: [],
    };
  }

  // Record the branch we're on before any checkout, so we can restore it
  const branchBeforeCleanup = git("rev-parse --abbrev-ref HEAD", opts);

  // Guard: verify we're on base branch
  const current = branchBeforeCleanup;
  if (current !== base) {
    try {
      gitArgs(["checkout", base], opts);
      cleaned.push(`checkout:${base}`);
    } catch (e) {
      clearShipState(cwd);
      return {
        success: false,
        error: `Failed to checkout ${base}: ${e.message}`,
        cleaned,
        warnings,
      };
    }
  }

  // Sync local base to origin/base. The PR merged remote-side, so origin/${base}
  // advanced but the local ref does NOT move on its own. This MUST run even when
  // we are already on ${base} — otherwise a ship that ends on main leaves local
  // main stale ("ship succeeded but main not updated locally").
  // See skills/do-ship/deep-knowledge/cleanup.md §2.
  // No remote: ship_release merged into the local base itself, so there is no
  // origin to sync from, compare against or delete a branch on.
  const noRemote = repoMode === "git-no-remote";
  if (!noRemote) {
    try {
      gitArgs(["pull", "--ff-only", "origin", base], { ...opts, timeout: NETWORK_TIMEOUT });
      cleaned.push(`sync:${base}`);
    } catch (e) {
      warnings.push(
        `Could not fast-forward local '${base}' to origin/${base}: ${e.message}. ` +
          `Local '${base}' may be stale — run: git pull --ff-only origin ${base}`
      );
    }
    // Hard post-condition: local base must equal origin/base after a ship.
    const localBase = gitTry(["rev-parse", base], opts);
    const remoteBase = gitTry(["rev-parse", `origin/${base}`], opts);
    if (localBase && remoteBase && localBase !== remoteBase) {
      warnings.push(
        `Local '${base}' (${localBase.slice(0, 7)}) != origin/${base} (${remoteBase.slice(0, 7)}) ` +
          `after ship — main not fully landed locally.`
      );
    }
  }

  // Verify remote branch is gone (merge step should have deleted it)
  const remoteBranch = noRemote ? null : gitTry(["ls-remote", "--heads", "origin", branch], { ...opts, timeout: NETWORK_TIMEOUT });
  if (remoteBranch) {
    try {
      gitArgs(["push", "origin", "--delete", branch], { ...opts, timeout: NETWORK_TIMEOUT });
      cleaned.push(`remote-branch:${branch}`);
    } catch {
      warnings.push(`Could not delete remote branch ${branch} — may already be deleted`);
    }
  }

  // Delete local branch
  try {
    gitArgs(["branch", "-D", branch], opts);
    cleaned.push(`local-branch:${branch}`);
  } catch {
    warnings.push(`Local branch ${branch} not found or already deleted`);
  }

  // Prune
  git("worktree prune", opts);
  cleaned.push("worktree-prune");

  if (!noRemote) {
    git("remote prune origin", opts);
    cleaned.push("remote-prune");
  }

  // For intermediate merges: note that the base (feature branch) stays alive
  if (intermediate) {
    warnings.push(`Intermediate merge: base branch '${base}' preserved for further sub-branch merges or final ship to main`);
  }

  // Final-gate invariant: every file in a session worktree must be
  // tracked→committed→pushed→merged OR gitignored — never in limbo. The hard
  // block lives in preflight; cleanup runs AFTER the merge, so we only warn
  // loudly here (failing cleanup post-merge would strand the user). A dirty
  // sibling session worktree means work was driven from the main repo while
  // the worktree was left untouched — its changes are NOT on main.
  for (const wt of dirtySessionWorktrees(opts)) {
    warnings.push(
      `WARNING: session worktree '${wt.path}' (branch '${wt.branch || "detached"}') still has ${wt.changes} uncommitted change(s) AFTER ship. These changes were NOT included in this ship — inspect the worktree and commit-or-discard before archiving the session.`
    );
  }

  // Restore the original branch if we switched away from a non-base branch
  if (branchBeforeCleanup && branchBeforeCleanup !== base && branchBeforeCleanup !== branch) {
    try {
      gitArgs(["checkout", branchBeforeCleanup], opts);
      cleaned.push(`restored:${branchBeforeCleanup}`);
    } catch {
      warnings.push(`Could not restore original branch '${branchBeforeCleanup}' — staying on '${base}'`);
    }
  }

  cleaned.push(...clearShipState(cwd).filter((c) => c !== "sentinel"));
  return {
    success: true,
    intermediate,
    branchBeforeCleanup,
    cleaned,
    warnings,
    porcelain: porcelainLines(cwd),
    ...lockFields,
  };
}
