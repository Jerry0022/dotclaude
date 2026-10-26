/**
 * Sub-branch cleanup after the final ship of an integration branch (#876).
 *
 * Sub-branches merged into an integration branch with plain `git merge`
 * commits never had a ship of their own, so per-ship cleanup (which deletes
 * only the head it merged) left them behind once the integration branch
 * landed. After that final ship every ref named `<integration>-*` whose tip is
 * an ancestor of the shipped head is provably contained and goes — remote and
 * local (a local one only when no worktree has it checked out). Anything with a
 * commit the shipped head lacks stays; so do main, the default branch and the
 * integration branch itself. A remote ref is deleted only while origin still
 * points at the tip that was proven contained.
 */
import { gitArgs, gitTry, NETWORK_TIMEOUT } from "./git.js";
import { deleteRemoteBranch } from "./github.js";

const NEVER = new Set(["main", "master", "HEAD", "origin"]);

function isAncestor(sha, head, opts) {
  try {
    gitArgs(["merge-base", "--is-ancestor", sha, head], opts);
    return true;
  } catch {
    return false;
  }
}

function checkedOutBranches(opts) {
  const out = gitTry(["worktree", "list", "--porcelain"], opts);
  if (out === null) return null;
  return new Set(out.split("\n").filter((l) => l.startsWith("branch refs/heads/")).map((l) => l.slice("branch refs/heads/".length).trim()));
}

/**
 * @param {{branch:string, defaultBranch:string, head?:string|null}} subject  integration branch + shipped head sha
 * @param {object} [opts]  git opts ({cwd, timeout})
 * @param {{dryRun?:boolean, deleteRemote?:Function}} [seams]
 * @returns {{deleted:{name:string, where:"remote"|"local"}[], kept:{name:string, reason:string}[]}}
 */
export function pruneMergedSubBranches({ branch, defaultBranch, head }, opts = {}, { dryRun = false, deleteRemote = deleteRemoteBranch } = {}) {
  const res = { deleted: [], kept: [] };
  if (!branch || !head || NEVER.has(branch) || branch === defaultBranch) return res;
  const prefix = `${branch}-`;
  const netOpts = { ...opts, timeout: NETWORK_TIMEOUT };
  const protectedName = (n) => NEVER.has(n) || n === defaultBranch || n === branch || !n.startsWith(prefix) || n === prefix;

  const remoteRefs = (gitTry(["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/remotes/origin"], opts) || "")
    .split("\n").map((l) => l.trim().split("\t")).filter(([r, s]) => r && s)
    .map(([r, s]) => ({ name: r.slice("refs/remotes/origin/".length), sha: s })).filter((r) => r.name.startsWith(prefix));
  const localRefs = (gitTry(["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads"], opts) || "")
    .split("\n").map((l) => l.trim().split("\t")).filter(([r, s]) => r && s)
    .map(([r, s]) => ({ name: r.slice("refs/heads/".length), sha: s })).filter((r) => r.name.startsWith(prefix));

  for (const { name, sha } of remoteRefs) {
    if (protectedName(name)) continue;
    if (!isAncestor(sha, head, opts)) { res.kept.push({ name, reason: "not-contained" }); continue; }
    // origin may have moved since the last fetch: only the proven tip is deleted
    const live = gitTry(["ls-remote", "origin", `refs/heads/${name}`], netOpts);
    if (!live || live.split(/\s+/)[0] !== sha) { res.kept.push({ name, reason: live ? "moved" : "unverified" }); continue; }
    if (dryRun) { res.deleted.push({ name, where: "remote" }); continue; }
    const del = deleteRemote(name, netOpts);
    if (!del.ok) { res.kept.push({ name, reason: "delete-failed" }); continue; }
    gitTry(["update-ref", "-d", `refs/remotes/origin/${name}`], opts);
    res.deleted.push({ name, where: "remote" });
  }

  const busy = checkedOutBranches(opts);
  for (const { name, sha } of localRefs) {
    if (protectedName(name)) continue;
    if (!isAncestor(sha, head, opts)) { res.kept.push({ name, reason: "not-contained" }); continue; }
    if (busy === null || busy.has(name)) { res.kept.push({ name, reason: "checked-out" }); continue; }
    if (dryRun) { res.deleted.push({ name, where: "local" }); continue; }
    // -D is safe here: the ancestor proof above is the check -d would make against HEAD
    if (gitTry(["branch", "-D", name], opts) !== null) res.deleted.push({ name, where: "local" });
    else res.kept.push({ name, reason: "delete-failed" });
  }
  return res;
}
