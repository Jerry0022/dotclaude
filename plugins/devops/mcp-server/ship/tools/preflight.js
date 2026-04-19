/**
 * @tool ship_preflight
 * @description Pre-flight safety checks before shipping.
 */

import { z } from "zod";
import { git, currentBranch, dirtyState, commitsAhead, unpushedCommits, isWorktree, detectParentBranch, detectDefaultBranch, branchExists, fileOverlap, getConfig } from "../lib/git.js";
import { readVersion, verifyVersionFiles } from "../lib/version.js";
import { writeSentinel } from "../lib/sentinel.js";

export const schema = z.object({
  base: z.string().optional().describe("Base branch to ship into. Omit to auto-detect: parent branch (from sub-branch naming) or the repository's default branch (origin/HEAD, typically 'main' or 'master')."),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

export async function handler(params) {
  let { base } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };
  const checks = [];
  const errors = [];

  // 1. Current branch
  const branch = currentBranch(opts);
  if (!branch || branch === "HEAD") {
    errors.push(`Cannot ship from '${branch || "detached HEAD"}' — must be on a feature branch`);
    checks.push({ name: "branch", value: branch, ok: false });
  }

  // Resolve the repo's default branch once — used both as a fallback for `base`
  // and as the reference point for the "intermediate merge" check below.
  const defaultBranch = detectDefaultBranch(opts) || "main";
  const baseWasExplicit = typeof base === "string" && base.length > 0;

  // 2. Auto-detect parent branch for sub-branch → feature-branch merges.
  //    Only when the caller didn't pass an explicit base.
  let autoDetectedBase = null;
  if (!baseWasExplicit && branch && branch !== defaultBranch) {
    const parent = detectParentBranch(branch, opts);
    if (parent) {
      autoDetectedBase = parent.parent;
      base = parent.parent;
    }
  }
  // No explicit base and no parent detected → fall back to the repo default.
  if (!base) base = defaultBranch;

  const intermediate = base !== defaultBranch;

  if (branch === base) {
    errors.push(`Cannot ship from '${branch}' — already on base branch '${base}'`);
  }
  checks.push({ name: "branch", value: branch, ok: !errors.length });

  checks.push({ name: "default-branch", value: defaultBranch });
  if (autoDetectedBase) {
    checks.push({ name: "auto-detected-base", value: autoDetectedBase, source: "sub-branch naming" });
  } else if (!baseWasExplicit && base === defaultBranch && branch && (branch.match(/\//g) || []).length >= 2) {
    checks.push({ name: "sub-branch-warning", value: branch, message: "Branch looks like a sub-branch but no parent branch was found. Push the integration branch first." });
    errors.push(`Branch '${branch}' looks like a sub-branch (2+ path segments) but no parent branch exists. Push the integration branch first, or pass an explicit base.`);
  }
  checks.push({ name: "intermediate", value: intermediate });

  // 3. Verify base branch exists (locally or on origin)
  const baseExists = branchExists(base, opts);
  if (!baseExists) {
    errors.push(`Base branch '${base}' does not exist locally or on origin`);
  }
  checks.push({ name: "base-exists", ok: !!baseExists, value: baseExists });

  // 4. Dirty state
  const state = dirtyState(opts);
  if (state.dirty) {
    errors.push(
      `Dirty working tree: ${state.modified.length} modified, ${state.untracked.length} untracked`
    );
  }
  checks.push({ name: "clean-tree", ok: !state.dirty, modified: state.modified.length, untracked: state.untracked.length });

  // 5. Fetch base from origin to ensure accurate commit count
  git(`fetch origin ${base}`, opts);

  // 6. Commits ahead (compare against origin/ ref for accuracy)
  const originBase = `origin/${base}`;
  const ahead = commitsAhead(baseExists === "remote" || baseExists === "local" ? originBase : base, opts);
  if (ahead === 0) {
    errors.push(`No commits ahead of ${base} — nothing to ship`);
  }
  checks.push({ name: "commits-ahead", value: ahead, ok: ahead > 0 });

  // 7. Unpushed commits (hard gate — must be 0 before shipping)
  const unpushed = unpushedCommits(opts);
  if (unpushed !== null && unpushed > 0) {
    errors.push(`${unpushed} unpushed commit(s) — push before shipping`);
  }
  checks.push({ name: "all-pushed", value: unpushed, ok: unpushed === 0 || unpushed === null });

  // 8. Base branch ahead check (warning — resolved autonomously by ship skill)
  const baseBehindCount = (() => {
    const count = git(`rev-list --count HEAD..${originBase}`, opts);
    return count ? parseInt(count, 10) : 0;
  })();
  checks.push({
    name: "base-ahead",
    value: baseBehindCount,
    ok: baseBehindCount === 0,
    ...(baseBehindCount > 0 && { warning: `Base branch '${base}' is ${baseBehindCount} commit(s) ahead — rebase will be handled automatically` }),
  });

  // 9. File overlap detection (warning — resolved autonomously by ship skill)
  const overlap = fileOverlap(originBase, opts);
  if (overlap.overlap.length > 0) {
    checks.push({
      name: "file-overlap",
      ok: false,
      count: overlap.overlap.length,
      files: overlap.overlap.slice(0, 20),
      totalBranchFiles: overlap.branchFiles.length,
      totalBaseFiles: overlap.baseFiles.length,
      mergeBase: overlap.mergeBase?.slice(0, 8),
      warning: `${overlap.overlap.length} file(s) modified in both branches — will be resolved during rebase`,
    });
  } else {
    checks.push({ name: "file-overlap", ok: true, count: 0 });
  }

  // 10. Git config check (warning — auto-fixed by ship skill)
  const conflictStyle = getConfig("merge.conflictstyle", opts);
  if (conflictStyle !== "diff3" && conflictStyle !== "zdiff3") {
    checks.push({ name: "config-conflictstyle", ok: false, current: conflictStyle, recommended: "diff3", warning: "Will be set automatically before rebase" });
  } else {
    checks.push({ name: "config-conflictstyle", ok: true, current: conflictStyle });
  }

  // Version consistency (skip for intermediate merges — versions only matter on main)
  let versionInfo = { version: null, type: null };
  if (!intermediate) {
    versionInfo = readVersion(cwd);
    let versionOk = true;
    let versionMismatches = [];
    if (versionInfo.version) {
      const result = verifyVersionFiles(versionInfo.version, cwd);
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

  // Worktree detection
  const inWorktree = isWorktree(opts);
  checks.push({ name: "worktree", value: inWorktree });

  // Collect warnings from checks (non-blocking issues resolved autonomously)
  const warnings = checks.filter(c => c.warning).map(c => c.warning);

  // Determine if rebase is needed (any merge-safety warnings present)
  const needsRebase = checks.some(c =>
    !c.ok && (c.name === "base-ahead" || c.name === "file-overlap" || c.name === "config-conflictstyle")
  );

  const ready = errors.length === 0;

  // Mark the ship pipeline as in-progress only after all hard gates passed,
  // so pre.main.guard / pre.edit.branch don't block ship internals when Claude
  // falls back to Bash. Cleared by ship_cleanup on every exit path.
  if (ready) writeSentinel(cwd);

  return {
    ready,
    branch,
    base,
    autoDetectedBase,
    intermediate,
    ahead,
    unpushed,
    inWorktree,
    needsRebase,
    version: versionInfo.version,
    projectType: versionInfo.type,
    checks,
    warnings,
    errors,
  };
}
