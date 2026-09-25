/**
 * Local merge for repos without a remote (git-no-remote).
 *
 * With an origin, a ship lands via PR → merge on GitHub. Without one the ship
 * used to stop at the commit on the feature branch, so the work never reached
 * main and sub-branches never reached their parent. This module does the same
 * landing locally: the branch's tree becomes a new commit on `base` (squash),
 * a merge commit (merge) or a fast-forward (rebase) — without checking `base`
 * out, so it works from a worktree while `base` sits in the main checkout.
 *
 * The branch must already contain `base` (rebased onto it) — then the branch's
 * tree IS the merge result and no content merge is ever computed here. A base
 * that moved ahead is reported as `rebaseRequired`, exactly like the remote
 * flow does, and nothing is written.
 */

import { execFileSync } from "node:child_process";
import { worktreePathForBranch } from "./git.js";

const TIMEOUT = 15_000;

function run(args, cwd, input) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
    ...(input !== undefined && { input }),
  }).trim();
}

function tryRun(args, cwd) {
  try { return run(args, cwd); } catch { return null; }
}

function isAncestor(a, b, cwd) {
  try { run(["merge-base", "--is-ancestor", a, b], cwd); return true; } catch { return false; }
}

export class LocalMergeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Land the current HEAD of `branch` on the local `base`.
 *
 * @param {{ branch: string, base: string, strategy?: "squash"|"merge"|"rebase", message: string, cwd: string }} p
 * @returns {{ mergeSha: string, strategy: string, via: "worktree"|"ref"|"none", path?: string, noop?: boolean }}
 * @throws {LocalMergeError} code "base-missing" | "rebase-required" | "base-dirty"
 */
export function localMerge({ branch, base, strategy = "squash", message, cwd }) {
  const headSha = run(["rev-parse", "HEAD"], cwd);
  if (branch === base) {
    // Shipping on base itself (a local-only repo worked on main): the commit
    // already is the landing.
    return { mergeSha: headSha, strategy: "none", via: "none", noop: true };
  }
  const baseSha = tryRun(["rev-parse", "--verify", `refs/heads/${base}`], cwd);
  if (!baseSha) {
    throw new LocalMergeError("base-missing", `Local branch '${base}' does not exist — nothing to merge into.`);
  }
  if (!isAncestor(baseSha, headSha, cwd)) {
    throw new LocalMergeError(
      "rebase-required",
      `'${base}' has commits that '${branch}' does not contain. Rebase first: git rebase ${base}`,
    );
  }
  if (baseSha === headSha) {
    return { mergeSha: headSha, strategy, via: "none", noop: true };
  }

  const tree = run(["rev-parse", "HEAD^{tree}"], cwd);
  let target;
  if (strategy === "rebase") {
    target = headSha;
  } else {
    const parents = strategy === "merge" ? ["-p", baseSha, "-p", headSha] : ["-p", baseSha];
    target = run(["commit-tree", tree, ...parents, "-F", "-"], cwd, `${message}\n`);
  }

  // `base` checked out somewhere (typically the main checkout): move it there
  // with a fast-forward, so that working tree follows. A dirty checkout is left
  // alone — the ff would refuse anyway, and nothing may be overwritten.
  const wt = worktreePathForBranch(base, { cwd });
  if (wt) {
    const dirty = tryRun(["status", "--porcelain", "--untracked-files=no"], wt);
    if (dirty === null || dirty !== "") {
      throw new LocalMergeError(
        "base-dirty",
        `'${base}' is checked out in ${wt} with uncommitted changes — commit or stash them there, then retry.`,
      );
    }
    run(["merge", "--ff-only", target], wt);
    return { mergeSha: target, strategy, via: "worktree", path: wt };
  }
  // Not checked out anywhere: move the ref, guarded by its old value.
  run(["update-ref", `refs/heads/${base}`, target, baseSha], cwd);
  return { mergeSha: target, strategy, via: "ref" };
}

/**
 * Create the ring tag locally (no remote to push it to). An existing tag is
 * left as it is and reported.
 * @returns {{ created: boolean, warning?: string }}
 */
export function localTag({ tag, sha, version, cwd }) {
  if (tryRun(["rev-parse", "--verify", `refs/tags/${tag}`], cwd)) {
    return { created: false, warning: `Tag ${tag} already exists locally — skipping creation.` };
  }
  run(["tag", "-a", tag, sha, "-m", JSON.stringify({ channel: "alpha", version })], cwd);
  return { created: true };
}
