/**
 * @tool ship_preflight
 * @description Pre-flight safety checks before shipping.
 */

import { z } from "zod";
import { git, currentBranch, dirtyState, commitsAhead, unpushedCommits, isWorktree } from "../lib/git.js";
import { readVersion, verifyVersionFiles } from "../lib/version.js";

export const schema = z.object({
  base: z.string().default("main").describe("Base branch to ship into"),
});

export async function handler(params) {
  const { base } = params;
  const checks = [];
  const errors = [];

  // 1. Current branch
  const branch = currentBranch();
  if (!branch || branch === base) {
    errors.push(`Cannot ship from '${branch || "detached HEAD"}' — must be on a feature branch`);
  }
  checks.push({ name: "branch", value: branch, ok: !errors.length });

  // 2. Dirty state
  const state = dirtyState();
  if (state.dirty) {
    errors.push(
      `Dirty working tree: ${state.modified.length} modified, ${state.untracked.length} untracked`
    );
  }
  checks.push({ name: "clean-tree", ok: !state.dirty, modified: state.modified.length, untracked: state.untracked.length });

  // 3. Commits ahead
  const ahead = commitsAhead(base);
  if (ahead === 0) {
    errors.push(`No commits ahead of ${base} — nothing to ship`);
  }
  checks.push({ name: "commits-ahead", value: ahead, ok: ahead > 0 });

  // 4. Unpushed commits
  const unpushed = unpushedCommits();
  checks.push({ name: "all-pushed", value: unpushed, ok: unpushed === 0 });

  // 5. Version consistency
  const { version, type } = readVersion();
  let versionOk = true;
  let versionMismatches = [];
  if (version) {
    const result = verifyVersionFiles(version);
    versionOk = result.consistent;
    versionMismatches = result.mismatches;
    if (!versionOk) {
      errors.push(`Version mismatch: ${versionMismatches.map(m => m.file).join(", ")}`);
    }
  }
  checks.push({ name: "version-consistent", ok: versionOk, version, mismatches: versionMismatches });

  // 6. Worktree detection
  const inWorktree = isWorktree();
  checks.push({ name: "worktree", value: inWorktree });

  const ready = errors.length === 0;
  return {
    ready,
    branch,
    base,
    ahead,
    unpushed,
    inWorktree,
    version,
    projectType: type,
    checks,
    errors,
  };
}
