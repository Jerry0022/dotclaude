import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const { findRepos, scanOne, cleanLanded, parseArgs } = createRequire(import.meta.url)("./orphan-scan.js");

const DAY = 86_400_000;
const dirs = [];
afterEach(() => {
  while (dirs.length) try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* temp */ }
});
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const mkRoot = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "orphan-")));
  dirs.push(d);
  return d;
};

function repoIn(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  fs.writeFileSync(path.join(dir, "a.txt"), "0\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "c0");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return dir;
}
function commitOn(dir, branch, file, content, subject = "work", fromMain = true) {
  git(dir, "checkout", "-q", "-b", branch, ...(fromMain ? ["main"] : []));
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", subject);
  git(dir, "checkout", "-q", "main");
}
/** main gains a commit (origin/main follows), so `main~1` is a distinct landed commit. */
function advanceMain(dir) {
  fs.writeFileSync(path.join(dir, "a.txt"), "advanced\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "advance");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
}
const offlineMerged = () => ({ bySha: new Set(), byName: new Map() });
const opts = { fetch: false, projectsDir: null, fetchMerged: offlineMerged, fetchOpen: () => null };

describe("orphan-scan", () => {
  test("findRepos dedupes linked worktrees onto their main checkout and skips non-repos", () => {
    const root = mkRoot();
    const a = repoIn(root, "a");
    repoIn(root, "b");
    fs.mkdirSync(path.join(root, "plain"));
    const wt = path.join(root, "a-wt");
    git(a, "worktree", "add", "-q", "-b", "side", wt);
    const found = findRepos(root).map((p) => path.basename(p)).sort();
    expect(found).toEqual(["a", "b"]);
  });

  test("report entry: at-risk branch, parked (with stale nudge), stash count, landed leftovers", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    commitOn(r, "feat/unpushed", "u.txt", "u\n");
    commitOn(r, "wip/old", "w.txt", "w\n", "half done");
    git(r, "branch", "landed-one", "main");
    // age the parked tip beyond 30 days
    const old = new Date(Date.now() - 45 * DAY).toISOString();
    git(r, "checkout", "-q", "wip/old");
    execFileSync("git", ["commit", "-q", "--amend", "--no-edit", "--date", old], { cwd: r, env: { ...process.env, GIT_COMMITTER_DATE: old }, stdio: "ignore" });
    git(r, "checkout", "-q", "main");
    fs.writeFileSync(path.join(r, "a.txt"), "dirty\n");
    git(r, "stash", "push", "-q", "-m", "s1");

    const { entry } = await scanOne(r, opts);
    expect(entry.atRisk).toEqual([expect.objectContaining({ branch: "feat/unpushed", state: "unlanded", pushed: false })]);
    expect(entry.parked).toEqual([expect.objectContaining({ branch: "wip/old", legacy: true, nudge: "behalten, integrieren oder verwerfen" })]);
    expect(entry.stashes).toBe(1);
    expect(entry.landedLeftovers).toBe(1);
  });

  test("a landed branch is never listed as parked", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    git(r, "branch", "parked/shipped", "main");
    const { entry } = await scanOne(r, opts);
    expect(entry.parked).toEqual([]);
    expect(entry.landedLeftovers).toBe(1);
  });

  test("--clean-landed is a dry run by default and removes only landed units with --apply", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    git(r, "branch", "landed-one", "main");
    commitOn(r, "feat/unlanded", "u.txt", "u\n");
    const dry = await cleanLanded(r, { apply: false, ...opts });
    expect(dry.would).toEqual([{ kind: "branch", name: "landed-one" }]);
    expect(git(r, "branch", "--list", "landed-one")).toContain("landed-one");

    const done = await cleanLanded(r, { apply: true, ...opts });
    expect(done.removed).toEqual([expect.objectContaining({ kind: "branch", name: "landed-one" })]);
    const left = git(r, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n").sort();
    expect(left).toEqual(["feat/unlanded", "main"]);
  });

  test("--clean-landed spares long-lived and upstream-backed branches at main", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    advanceMain(r);
    for (const n of ["develop", "staging", "production", "stable", "release/1.0", "has-upstream"]) {
      git(r, "branch", n, "main");
    }
    git(r, "branch", "plain-landed", "main~1");
    git(r, "update-ref", "refs/remotes/origin/has-upstream", "main");
    const done = await cleanLanded(r, { apply: true, ...opts });
    expect(done.removed.map((x) => x.name)).toEqual(["plain-landed"]);
    const left = git(r, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n");
    expect(left).toEqual(expect.arrayContaining(["develop", "staging", "production", "stable", "release/1.0", "has-upstream"]));
  });

  test("--clean-landed removes LANDED parked, autosave, wip, backup and salvage refs", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    advanceMain(r);
    const safety = ["parked/idea", "parked/autosave/s1", "wip/x", "backup/y", "salvage/z"];
    for (const n of safety) git(r, "branch", n, "main~1");
    commitOn(r, "parked/unlanded", "u.txt", "u\n", "real parked work");
    const done = await cleanLanded(r, { apply: true, ...opts });
    expect(done.removed.map((x) => x.name).sort()).toEqual([...safety].sort());
    const left = git(r, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n");
    expect(left).toContain("parked/unlanded");
  });

  test("--clean-landed keeps a fresh clean worktree at main and removes one idle for days", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    // the repo's commits are "now"; the scan runs 5 days later
    const later = Date.now() + 5 * DAY;
    const mk = (name, ageDays) => {
      const wt = path.join(r, ".claude", "worktrees", name);
      git(r, "worktree", "add", "-q", "-b", name, wt, "main");
      const t = new Date(later - ageDays * DAY);
      for (const f of ["index", "HEAD", path.join("logs", "HEAD")]) {
        try { fs.utimesSync(path.join(r, ".git", "worktrees", name, f), t, t); } catch { /* optional */ }
      }
      // the commit itself is at main (old); only the admin files carry the activity
      return wt;
    };
    const fresh = mk("fresh-one", 0);
    const stale = mk("stale-one", 5);
    const done = await cleanLanded(r, { apply: true, now: later, ...opts });
    expect(done.removed.filter((x) => x.kind === "worktree").map((x) => path.basename(x.path))).toEqual(["stale-one"]);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });

  test("--clean-landed dry-run keeps an old-branch worktree with recent index or file activity", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    const later = Date.now() + 5 * DAY;
    const old = new Date(later - 5 * DAY);
    const mk = (name) => {
      const wt = path.join(r, ".claude", "worktrees", name);
      git(r, "worktree", "add", "-q", "-b", name, wt, "main");
      for (const f of ["index", "HEAD", path.join("logs", "HEAD")]) {
        try { fs.utimesSync(path.join(r, ".git", "worktrees", name, f), old, old); } catch { /* optional */ }
      }
      for (const n of fs.readdirSync(wt)) if (n !== ".git") fs.utimesSync(path.join(wt, n), old, old);
      return wt;
    };
    mk("idle-one");
    mk("index-touched");
    const edited = mk("file-edited");
    const recent = new Date(later - 10 * 60_000);
    fs.utimesSync(path.join(r, ".git", "worktrees", "index-touched", "index"), recent, recent);
    fs.utimesSync(path.join(edited, "a.txt"), recent, recent);
    const dry = await cleanLanded(r, { apply: false, now: later, ...opts });
    expect(dry.would.filter((x) => x.kind === "worktree").map((x) => path.basename(x.path))).toEqual(["idle-one"]);
  });

  test("parked/autosave/* is listed under parked in the report, not at risk", async () => {
    const root = mkRoot();
    const r = repoIn(root, "app");
    commitOn(r, "parked/autosave/sess1", "s.txt", "s\n", "autosave");
    const { entry } = await scanOne(r, opts);
    expect(entry.parked).toEqual([expect.objectContaining({ branch: "parked/autosave/sess1", legacy: false })]);
    expect(entry.atRisk).toEqual([]);
  });

  describe("salvage copies on the remote", () => {
    /** repo with a bare origin; `feat/x` carries one commit, pushed as origin/salvage/x. */
    function withSalvage(root) {
      const r = repoIn(root, "app");
      const bare = path.join(root, "remote.git");
      git(root, "init", "-q", "--bare", bare);
      git(r, "remote", "add", "origin", bare);
      commitOn(r, "feat/x", "x.txt", "x\n");
      git(r, "push", "-q", "origin", "feat/x:refs/heads/salvage/x");
      return r;
    }

    test("a local branch whose tip equals origin/salvage/* is parked, not at risk; the remote ref is listed", async () => {
      const r = withSalvage(mkRoot());
      const { entry } = await scanOne(r, opts);
      expect(entry.atRisk).toEqual([]);
      expect(entry.parked).toEqual(expect.arrayContaining([
        expect.objectContaining({ branch: "origin/salvage/x", remote: true }),
        expect.objectContaining({ branch: "feat/x", coveredBy: "origin/salvage/x" }),
      ]));
    });

    test("a tip that is only an ancestor of the salvage ref is covered too", async () => {
      const r = withSalvage(mkRoot());
      git(r, "checkout", "-q", "-b", "tmp", "feat/x");
      fs.writeFileSync(path.join(r, "more.txt"), "m\n");
      git(r, "add", "-A");
      git(r, "commit", "-q", "-m", "more");
      git(r, "push", "-q", "-f", "origin", "tmp:refs/heads/salvage/x");
      git(r, "checkout", "-q", "main");
      git(r, "branch", "-D", "tmp");
      const { entry } = await scanOne(r, opts);
      expect(entry.atRisk).toEqual([]);
      expect(entry.parked.find((p) => p.branch === "feat/x")).toMatchObject({ coveredBy: "origin/salvage/x" });
    });

    test("an unrelated unlanded branch stays at risk", async () => {
      const r = withSalvage(mkRoot());
      commitOn(r, "feat/other", "o.txt", "o\n");
      const { entry } = await scanOne(r, opts);
      expect(entry.atRisk.map((a) => a.branch)).toEqual(["feat/other"]);
    });

    test("uncommitted work in a worktree on a covered branch stays at risk", async () => {
      const r = withSalvage(mkRoot());
      const wt = path.join(r, ".claude", "worktrees", "sess");
      git(r, "worktree", "add", "-q", wt, "feat/x");
      fs.writeFileSync(path.join(wt, "unsaved.txt"), "u\n");
      const { entry } = await scanOne(r, opts);
      expect(entry.atRisk).toEqual([expect.objectContaining({ kind: "worktree", dirty: 1 })]);
    });

    test("--clean-landed removes a landed branch even when a salvage ref holds the same commit", async () => {
      const root = mkRoot();
      const r = withSalvage(root);
      advanceMain(r);
      git(r, "branch", "landed-pin", "main");
      git(r, "push", "-q", "origin", "landed-pin:refs/heads/salvage/pin");
      git(r, "branch", "landed-free", "main~1");
      const done = await cleanLanded(r, { apply: true, ...opts });
      expect(done.removed.map((x) => x.name).sort()).toEqual(["landed-free", "landed-pin"]);
    });
  });

  test("parseArgs", () => {
    expect(parseArgs(["--clean-landed", "--repo", "x", "--apply", "--no-fetch"])).toMatchObject({ cleanLanded: true, apply: true, repo: "x", fetch: false });
  });
});
