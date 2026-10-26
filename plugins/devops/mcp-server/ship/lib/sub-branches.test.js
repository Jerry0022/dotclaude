import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pruneMergedSubBranches } from "./sub-branches.js";

const tmp = [];
const mk = (p) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
  tmp.push(d);
  return d;
};
afterEach(() => {
  while (tmp.length) try { fs.rmSync(tmp.pop(), { recursive: true, force: true }); } catch { /* temp */ }
});
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const commit = (cwd, f, msg) => {
  fs.writeFileSync(path.join(cwd, f), msg);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", msg);
};

/** main + integration branch `feat/mvp` with sub-branches b0 (merged in), b1 (merged in), b2 (extra commit) on origin. */
function setup() {
  const origin = mk("sub-origin-");
  git(origin, "init", "-q", "--bare", "-b", "main");
  const dir = mk("sub-work-");
  git(dir, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "t@e.com"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git(dir, "config", k, v);
  git(dir, "remote", "add", "origin", origin);
  commit(dir, "a.txt", "0");
  git(dir, "push", "-q", "origin", "main");
  git(dir, "checkout", "-q", "-b", "feat/mvp");
  for (const n of ["b0", "b1", "b2"]) {
    git(dir, "checkout", "-q", "-b", `feat/mvp-${n}`, "feat/mvp");
    commit(dir, `${n}.txt`, n);
    git(dir, "checkout", "-q", "feat/mvp");
    if (n !== "b2") git(dir, "merge", "-q", "--no-ff", "-m", `merge ${n}`, `feat/mvp-${n}`);
  }
  git(dir, "push", "-q", "origin", "feat/mvp", "feat/mvp-b0", "feat/mvp-b1", "feat/mvp-b2");
  git(dir, "branch", "-q", "feat/mvpx", "feat/mvp"); // shares the name stem but not the `feat/mvp-` prefix
  git(dir, "push", "-q", "origin", "feat/mvpx");
  return { dir, origin, head: git(dir, "rev-parse", "HEAD") };
}
const remoteHeads = (origin) => git(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").sort();

// real git repos on a loaded machine: generous per-test limit
const SLOW = 180_000;

describe("pruneMergedSubBranches (#876)", { timeout: SLOW }, () => {
  test("deletes contained <branch>-* refs on origin and locally; keeps unmerged work, the integration branch, main and look-alikes", () => {
    const { dir, origin, head } = setup();
    const res = pruneMergedSubBranches({ branch: "feat/mvp", defaultBranch: "main", head }, { cwd: dir });
    expect(res.deleted.map((d) => `${d.where}:${d.name}`).sort())
      .toEqual(["local:feat/mvp-b0", "local:feat/mvp-b1", "remote:feat/mvp-b0", "remote:feat/mvp-b1"]);
    expect(res.kept).toEqual(expect.arrayContaining([{ name: "feat/mvp-b2", reason: "not-contained" }]));
    expect(remoteHeads(origin)).toEqual(["feat/mvp", "feat/mvp-b2", "feat/mvpx", "main"]);
    expect(git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").sort())
      .toEqual(["feat/mvp", "feat/mvp-b2", "feat/mvpx", "main"]);
    expect(git(dir, "for-each-ref", "refs/remotes/origin/feat/mvp-b0")).toBe("");
  });

  test("dry run deletes nothing", () => {
    const { dir, origin, head } = setup();
    const res = pruneMergedSubBranches({ branch: "feat/mvp", defaultBranch: "main", head }, { cwd: dir }, { dryRun: true });
    expect(res.deleted).toHaveLength(4);
    expect(remoteHeads(origin)).toHaveLength(6);
  });

  test("a sub-branch checked out in a worktree keeps its local ref", () => {
    const { dir, head } = setup();
    git(dir, "checkout", "-q", "feat/mvp-b0");
    const res = pruneMergedSubBranches({ branch: "feat/mvp", defaultBranch: "main", head }, { cwd: dir }, { deleteRemote: () => ({ ok: true }) });
    expect(res.deleted.map((d) => `${d.where}:${d.name}`)).not.toContain("local:feat/mvp-b0");
    expect(res.kept).toContainEqual({ name: "feat/mvp-b0", reason: "checked-out" });
  });

  test("origin moved past the proven tip: the remote ref stays", () => {
    const { dir, origin, head } = setup();
    const other = mk("sub-other-");
    git(other, "clone", "-q", origin, ".");
    git(other, "config", "user.email", "t@e.com");
    git(other, "config", "user.name", "t");
    git(other, "checkout", "-q", "feat/mvp-b1");
    commit(other, "late.txt", "late");
    git(other, "push", "-q", "origin", "feat/mvp-b1");
    const res = pruneMergedSubBranches({ branch: "feat/mvp", defaultBranch: "main", head }, { cwd: dir });
    expect(res.kept).toContainEqual({ name: "feat/mvp-b1", reason: "moved" });
    expect(remoteHeads(origin)).toContain("feat/mvp-b1");
  });

  test("never acts for the default branch or without a head", () => {
    const { dir, head } = setup();
    expect(pruneMergedSubBranches({ branch: "main", defaultBranch: "main", head }, { cwd: dir })).toEqual({ deleted: [], kept: [] });
    expect(pruneMergedSubBranches({ branch: "feat/mvp", defaultBranch: "main", head: null }, { cwd: dir })).toEqual({ deleted: [], kept: [] });
  });
});
