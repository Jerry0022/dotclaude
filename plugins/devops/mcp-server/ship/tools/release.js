/**
 * @tool ship_release
 * @description Commit, push, create PR, merge, tag, and create GitHub release.
 */

import { z } from "zod";
import { execFileSync } from "node:child_process";
import { git, gitStrict, gitArgs, currentBranch, headShort, dirtyState, isWorktree, isRebasedOnto, fileOverlap, syncLocalBranch, treeOf } from "../lib/git.js";
import { createPR, mergePR, findExistingPR, watchPRChecks } from "../lib/github.js";
import { detectRepoMode } from "../lib/repo-mode.js";

export const schema = z.object({
  base: z.string().default("main").describe("Base branch for PR (may be a feature branch for intermediate merges)"),
  title: z.string().max(70).describe("PR title (conventional commit format)"),
  body: z.string().describe("PR body (must start with Closes #N if applicable)"),
  tag: z.string().nullable().default(null).describe("Bare version tag (e.g. v0.18.0) — the tool publishes it as alpha/<tag> (ring model), null to skip. Ignored for intermediate merges"),
  releaseNotes: z.string().nullable().default(null).describe("CHANGELOG entry — NOT published at ship time (releases happen at promotion via ship_promote); recorded as releaseDeferred"),
  prerelease: z.boolean().default(false).describe("Deprecated — releases are created at promotion time; kept for caller compatibility"),
  commitMessage: z.string().nullable().default(null).describe("If set, stage all and commit with this message before pushing"),
  mergeStrategy: z.enum(["squash", "merge", "rebase"]).default("squash").describe("PR merge strategy. Use 'merge' for overlapping files to preserve ancestry chain."),
  skipChecks: z.boolean().default(false).describe("Skip the pre-merge CI checks gate. Use only for hot-fixes when CI is broken. Env DEVOPS_SHIP_SKIP_CHECKS=1 also forces skip."),
  checksTimeoutSec: z.number().int().min(30).max(3600).default(600).describe("Max seconds to wait for PR CI checks before merging. Default 10 min."),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

export async function handler(params) {
  const { base, title, body, tag, releaseNotes, commitMessage, mergeStrategy, skipChecks, checksTimeoutSec } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };

  const repoMode = detectRepoMode(cwd)
  if (repoMode === "none") {
    return { success: true, skipped: true, reason: "file-only-mode", delivered: "none" }
  }
  if (repoMode === "git-no-remote") {
    return { success: true, skipped: true, reason: "no-remote", delivered: "local-commit-only" }
  }

  const branch = currentBranch(opts);
  const intermediate = base !== "main";
  const result = { branch, base, intermediate, mode: repoMode };

  try {
    // Optional: commit version-bumped files
    if (commitMessage) {
      const state = dirtyState(opts);
      if (state.modified.length > 0) {
        // Stage every tracked modification across the repo in one call.
        // The `:/` pathspec anchors at the repo root, so this works whether
        // cwd is the repo root or a plugin subdirectory (dirtyState returns
        // repo-root-relative paths, which `git add` from cwd would otherwise
        // misresolve). gitArgs (no shell, THROWS on failure): a failed stage
        // must abort the ship — the previous git() swallowed the error as null
        // and committed anyway, dropping the modification silently. (F1)
        gitArgs(["add", "-u", ":/"], opts);
      }
      if (state.untracked.length > 0) {
        // Stage NEW files too, not just CHANGELOG. `git status --porcelain`
        // already excludes gitignored paths, so everything listed here is
        // intentional repo content. The previous behaviour silently skipped
        // every untracked file except CHANGELOG (recorded in `skippedFiles`),
        // which dropped new source files from the ship — a feature that added
        // files (e.g. a new hook + its lib module) landed half-merged on main,
        // leaving callers referencing modules that never got committed.
        //
        // Each path is staged via gitArgs (array form, no shell): a path with a
        // space or a cmd.exe metachar cannot word-split, and a failed `git add`
        // THROWS (aborting the ship) instead of being swallowed as null while
        // includedUntracked falsely reported it staged. Record only the files
        // actually staged — a throw aborts before includedUntracked is set. (F1)
        const stagedUntracked = [];
        for (const file of state.untracked) {
          // `:/${file}` resolves against repo root regardless of cwd.
          gitArgs(["add", "--", `:/${file}`], opts);
          stagedUntracked.push(file);
        }
        result.includedUntracked = stagedUntracked;
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

    // Push. The force-with-lease only ever targets the feature `branch` —
    // NEVER `base` — so it structurally cannot clobber base commits. Use an
    // EXPLICIT lease pinned to the last-known remote sha (not the bare
    // `--force-with-lease`): a bare lease trusts the remote-tracking ref, which
    // an implicit background fetch (the git-sync cron) can silently advance,
    // widening the lease so a concurrent push to the SAME branch would be
    // overwritten unseen. A brand-new branch has no remote-tracking ref → push
    // without a lease (nothing to overwrite). (#207)
    // Array form (no shell): a legal branch name containing cmd.exe metachars
    // (& ( ) | ; ^) or spaces must not break the command. `rev-parse --verify
    // --quiet` exits non-zero when the remote ref is absent (brand-new branch);
    // gitArgs surfaces that as a throw, which here means "no remote-tracking
    // ref yet" → push without a lease. (F2)
    let remoteBranchSha = null;
    try {
      remoteBranchSha = gitArgs(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], opts) || null;
    } catch {
      remoteBranchSha = null;
    }
    const leaseArg = remoteBranchSha
      ? `--force-with-lease=${branch}:${remoteBranchSha}`
      : `--force-with-lease`;
    gitArgs(["push", "-u", "origin", branch, leaseArg], { cwd, timeout: 60_000 });
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

    // Pre-Merge Checks Gate — wait for CI on the PR before merging.
    // Bypass via skipChecks param or DEVOPS_SHIP_SKIP_CHECKS=1 env.
    const checksBypassed = skipChecks || process.env.DEVOPS_SHIP_SKIP_CHECKS === "1";
    if (!checksBypassed) {
      const checkResult = watchPRChecks(pr.number, opts, { timeoutSec: checksTimeoutSec });
      result.checks = {
        status: checkResult.status,
        passed: checkResult.checks?.filter((c) => c.bucket === "pass").length || 0,
        failed: checkResult.failed?.length || 0,
        pending: checkResult.pending?.length || 0,
      };
      if (checkResult.status === "failed" || checkResult.status === "timeout" || checkResult.status === "probe-error") {
        result.success = false;
        result.checksBlocked = true;
        result.failedChecks = (checkResult.failed || []).map((c) => ({
          name: c.name || c.workflow,
          link: c.link,
        }));
        result.error =
          `${checkResult.error}. PR #${pr.number} not merged. ` +
          `Fix the failing checks and retry, or pass skipChecks:true for hot-fix override.`;
        return result;
      }
      // status === "passed" or "no-checks" → continue
    } else {
      result.checks = { status: "skipped", reason: skipChecks ? "skipChecks param" : "DEVOPS_SHIP_SKIP_CHECKS env" };
    }

    // Re-assert up-to-date against base IMMEDIATELY before merging — close the
    // time-of-check/time-of-use window. The rebase gate above can be minutes
    // stale: the pre-merge CI checks gate blocks for up to checksTimeoutSec
    // (default 600s), and a parallel ship / worktree can land on `base` during
    // that wait. Because mergePR uses `gh pr merge --admin` (needed for the bot
    // to self-merge past required-review protection), GitHub's own "require
    // branches to be up to date before merging" rule is BYPASSED — so without
    // this re-check, a stale branch would be force-merged over an advanced base
    // with --admin, the exact silent-overwrite vector #207 describes. Re-checking
    // here restores that guarantee at merge time. The skill's Step 1 loop rebases
    // and retries on rebaseRequired. (#207)
    gitStrict(`fetch origin ${base}`, { cwd, timeout: 30_000 });
    if (!isRebasedOnto(`origin/${base}`, opts)) {
      const overlap = fileOverlap(`origin/${base}`, opts);
      result.success = false;
      result.rebaseRequired = true;
      result.baseAdvancedDuringChecks = true;
      result.overlapFiles = overlap.overlap;
      result.error =
        `origin/${base} advanced while the ship was in progress (likely a parallel ship) — ` +
        `branch is no longer up to date. PR #${pr.number} left OPEN, NOT merged. ` +
        `Rebase onto origin/${base} and retry ship_release. ` +
        (overlap.overlap.length > 0
          ? `${overlap.overlap.length} overlapping file(s): ${overlap.overlap.slice(0, 10).join(", ")}`
          : "No file overlap detected — rebase should be clean.");
      return result;
    }

    // Snapshot the validated tree BEFORE the merge. Because we just re-asserted
    // HEAD ⊇ origin/base, merging HEAD into base is fast-forward-equivalent for
    // every strategy (squash/merge/rebase all yield base == HEAD's tree). The
    // post-merge guard below compares against this to prove the merge captured
    // exactly the tree that was rebased + built + tested. (#207)
    const shippedTree = treeOf("HEAD", opts);

    // Merge PR (delete branch; skip --delete-branch in worktrees
    // where gh tries to switch to base locally — cleanup handles branch deletion)
    const worktree = isWorktree(opts);
    const mergeSha = mergePR(pr.number, base, opts, { skipDeleteBranch: worktree, strategy: mergeStrategy });
    result.merged = base;
    result.mergeSha = mergeSha;

    // Post-merge tree verification. mergePR already fetched origin/base, so its
    // tree is current. With the pre-merge re-check holding, origin/base's tree
    // MUST equal the shipped HEAD tree — squash/merge/rebase are all ff-equivalent
    // here, so the merge result is byte-identical to the built+tested branch.
    //   match  → the pre-merge build/test IS the post-merge validation; nothing
    //            was dropped or overwritten.
    //   differ → either a parallel non-overlapping ship squeezed into the ~1s
    //            window between the re-check and gh's merge (GitHub 3-way merged
    //            it in — those changes are PRESERVED, not lost) OR an unexpected
    //            divergence. Non-fatal (the merge already landed) but surfaced so
    //            the skill flags "verify main is consistent". (#207)
    const baseTree = treeOf(`origin/${base}`, opts);
    result.postMergeTreeMatch = shippedTree !== null && baseTree !== null && shippedTree === baseTree;
    if (!result.postMergeTreeMatch) {
      result.postMergeWarning =
        `origin/${base} after merge does not match the shipped tree byte-for-byte. ` +
        `Most likely a concurrent ship landed in parallel and was three-way merged in ` +
        `(its changes are preserved). Verify main is logically consistent before relying on it.`;
    }

    // Sync the LOCAL base ref to the just-merged origin/base. After a remote-side
    // merge, origin/base advanced but the local base ref does NOT move on its own.
    // A bare `git fetch origin base` (the previous worktree-path behaviour) only
    // moves origin/base, leaving local base — and the main checkout used for local
    // testing — stale across ships (drifting further behind every release). This
    // worktree-safe sync fast-forwards local base wherever it is checked out, or
    // updates the bare ref directly when no worktree owns it. (#206)
    const baseSync = syncLocalBranch(base, opts);
    result.baseSync = baseSync.method;
    if (baseSync.warning) result.baseSyncWarning = baseSync.warning;

    // Alpha channel tag (only for final merges to main, skip for intermediate).
    // Every ship publishes to the EARLIEST channel autonomously — beta/stable
    // tags and GitHub Releases are created by ship_promote at promotion time
    // (ring model, spec §3.1). The tag is ANNOTATED so channel identity and
    // ship time live in the tag object (R4).
    if (!intermediate && tag) {
      const channelTag = `alpha/${tag}`;
      try {
        const remoteTag = git(`ls-remote --tags origin ${channelTag}`, opts);
        if (remoteTag && remoteTag.includes(channelTag)) {
          result.tagWarning = `Tag ${channelTag} already exists on remote — skipping creation.`;
          result.tagVerified = true;
        } else {
          // Create tag on the merge commit (origin/base), not on the current HEAD
          execFileSync("git", [
            "tag", "-a", channelTag, `origin/${base}`, "-m",
            JSON.stringify({ channel: "alpha", version: tag.replace(/^v/, "") }),
          ], { cwd, encoding: "utf8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] });
          gitStrict(`push origin ${channelTag}`, opts);
          const tagCheck = git(`ls-remote --tags origin ${channelTag}`, opts);
          result.tagVerified = tagCheck !== null && tagCheck.includes(channelTag);
        }
        result.tag = channelTag;
        result.channel = "alpha";
      } catch (e) {
        result.tag = channelTag;
        result.channel = "alpha";
        result.tagVerified = false;
        result.tagError = e.message?.slice(0, 200);
      }

      // No GitHub Release at ship time — promotion owns Releases. The notes
      // land in the stable Release when ship_promote fast-tracks/promotes.
      if (releaseNotes) {
        result.releaseDeferred = true;
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
