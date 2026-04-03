/**
 * @tool ship_preflight
 * @description Pre-flight safety checks before shipping.
 */

import { z } from "zod";
import { git, currentBranch, dirtyState, commitsAhead, unpushedCommits, isWorktree, detectParentBranch, branchExists } from "../lib/git.js";
import { readVersion, verifyVersionFiles } from "../lib/version.js";

export const schema = z.object({
  base: z.string().default("main").describe("Base branch to ship into (auto-detected from sub-branch naming if 'main')"),
});

export async function handler(params) {
  let { base } = params;
  const checks = [];
  const errors = [];

  // 1. Current branch
  const branch = currentBranch();
  if (!branch || branch === "HEAD") {
    errors.push(`Cannot ship from '${branch || "detached HEAD"}' — must be on a feature branch`);
    checks.push({ name: "branch", value: branch, ok: false });
  }

  // 2. Auto-detect parent branch for sub-branch → feature-branch merges
  //    Only when base is "main" (default) and current branch has a parent.
  let autoDetectedBase = null;
  if (base === "main" && branch && branch !== "main") {
    const parent = detectParentBranch(branch);
    if (parent) {
      autoDetectedBase = parent.parent;
      base = parent.parent;
    }
  }
  const intermediate = base !== "main";

  if (branch === base) {
    errors.push(`Cannot ship from '${branch}' — already on base branch '${base}'`);
  }
  checks.push({ name: "branch", value: branch, ok: !errors.length });

  if (autoDetectedBase) {
    checks.push({ name: "auto-detected-base", value: autoDetectedBase, source: "sub-branch naming" });
  } else if (base === "main" && branch && (branch.match(/\//g) || []).length >= 2) {
    // Branch has 2+ slashes (e.g. feat/42/core) — likely a sub-branch, but no parent was found.
    // 1-slash branches (feat/x, fix/x) are standard feature branches and should ship to main.
    // 2+ slashes strongly indicate a sub-branch where the parent wasn't pushed yet.
    checks.push({ name: "sub-branch-warning", value: branch, message: "Branch looks like a sub-branch but no parent branch was found. Push the integration branch first." });
    errors.push(`Branch '${branch}' looks like a sub-branch (2+ path segments) but no parent branch exists. Push the integration branch first, or pass an explicit base.`);
  }
  checks.push({ name: "intermediate", value: intermediate });

  // 3. Verify base branch exists (locally or on origin)
  const baseExists = branchExists(base);
  if (!baseExists) {
    errors.push(`Base branch '${base}' does not exist locally or on origin`);
  }
  checks.push({ name: "base-exists", ok: !!baseExists, value: baseExists });

  // 4. Dirty state
  const state = dirtyState();
  if (state.dirty) {
    errors.push(
      `Dirty working tree: ${state.modified.length} modified, ${state.untracked.length} untracked`
    );
  }
  checks.push({ name: "clean-tree", ok: !state.dirty, modified: state.modified.length, untracked: state.untracked.length });

  // 5. Fetch base from origin to ensure accurate commit count
  git(`fetch origin ${base}`);

  // 6. Commits ahead (compare against origin/ ref for accuracy)
  const originBase = `origin/${base}`;
  const ahead = commitsAhead(baseExists === "remote" || baseExists === "local" ? originBase : base);
  if (ahead === 0) {
    errors.push(`No commits ahead of ${base} — nothing to ship`);
  }
  checks.push({ name: "commits-ahead", value: ahead, ok: ahead > 0 });

  // 7. Unpushed commits (hard gate — must be 0 before shipping)
  // Note: null means no upstream is configured (new branch, never pushed).
  // This is OK — ship_release will push with -u to set upstream.
  const unpushed = unpushedCommits();
  if (unpushed !== null && unpushed > 0) {
    errors.push(`${unpushed} unpushed commit(s) — push before shipping`);
  }
  checks.push({ name: "all-pushed", value: unpushed, ok: unpushed === 0 || unpushed === null });

  // 8. Base branch ahead check (merge-conflict risk)
  const _behind = commitsAhead("HEAD", { base: originBase });
  const baseBehindCount = (() => {
    const count = git(`rev-list --count HEAD..${originBase}`);
    return count ? parseInt(count, 10) : 0;
  })();
  if (baseBehindCount > 0) {
    checks.push({ name: "base-ahead", value: baseBehindCount, ok: false });
    errors.push(`Base branch '${base}' is ${baseBehindCount} commit(s) ahead of HEAD — merge or rebase base first to avoid conflicts`);
  } else {
    checks.push({ name: "base-ahead", value: 0, ok: true });
  }

  // 9. Version consistency (skip for intermediate merges — versions only matter on main)
  let versionInfo = { version: null, type: null };
  if (!intermediate) {
    versionInfo = readVersion();
    let versionOk = true;
    let versionMismatches = [];
    if (versionInfo.version) {
      const result = verifyVersionFiles(versionInfo.version);
      versionOk = result.consistent;
      versionMismatches = result.mismatches;
      if (!versionOk) {
        errors.push(`Version mismatch: ${versionMismatches.map(m => m.file).join(", ")}`);
      }
    }
    checks.push({ name: "version-consistent", ok: versionOk, version: versionInfo.version, mismatches: versionMismatches });
  } else {
    checks.push({ name: "version-consistent", ok: true, skipped: true, reason: "intermediate merge" });
  }

  // 9. Worktree detection
  const inWorktree = isWorktree();
  checks.push({ name: "worktree", value: inWorktree });

  const ready = errors.length === 0;
  return {
    ready,
    branch,
    base,
    autoDetectedBase,
    intermediate,
    ahead,
    unpushed,
    inWorktree,
    version: versionInfo.version,
    projectType: versionInfo.type,
    checks,
    errors,
  };
}
