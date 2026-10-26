import { describe, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  scanRepo, planAutoClean, executeAutoClean, runHygiene, cardLines, landedVia, landingState,
  reachableFromMerged, classifyUnits, findStalePrs, startOrphanScan, BACKUP_EXPIRY_DAYS, BACKUP_PATTERNS,
} from "./hygiene.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();
const SETTINGS = Object.freeze({
  autoClean: true, autoCleanGateDays: 3, autoCleanMinAgeDays: 3, autoCleanKeepNewest: 5,
  nudge: false, nudgeThreshold: 50, nudgeCooldownDays: 7,
});

const tmp = [];
function mkTmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
afterEach(() => {
  while (tmp.length) {
    try { fs.rmSync(tmp.pop(), { recursive: true, force: true }); } catch { /* temp dir */ }
  }
});

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

function commitAt(cwd, file, content, when) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", `edit ${file}`], {
    cwd, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  return git(cwd, "rev-parse", "HEAD");
}

let BASE = null;
beforeAll(() => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hylife-base-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  const c0 = commitAt(dir, "a.txt", "0\n", daysAgo(60));
  const c1 = commitAt(dir, "a.txt", "1\n", daysAgo(40));
  git(dir, "update-ref", "refs/remotes/origin/main", c1);
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  BASE = { dir, c0, c1 };
});
afterAll(() => {
  try { fs.rmSync(BASE.dir, { recursive: true, force: true }); } catch { /* temp dir */ }
});
function makeRepo() {
  const dir = mkTmp("hylife-");
  fs.cpSync(BASE.dir, dir, { recursive: true });
  return { ...BASE, dir };
}

describe("landed proof via PR chain (integration branch)", () => {
  /** agent branch merged into `integ`, PR head = integ tip, squash on main, main edits k.txt later. */
  function integrationCase() {
    const { dir, c1 } = makeRepo();
    git(dir, "checkout", "-q", "-b", "agent", c1);
    const agent = commitAt(dir, "k.txt", "agent\n", daysAgo(20));
    git(dir, "checkout", "-q", "-b", "integ", c1);
    execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge agent", "agent"], { cwd: dir, stdio: "ignore" });
    const prHead = commitAt(dir, "p.txt", "p\n", daysAgo(19));
    git(dir, "checkout", "-q", "-b", "squash", c1);
    fs.writeFileSync(path.join(dir, "k.txt"), "agent\n");
    commitAt(dir, "p.txt", "p\n", daysAgo(18));
    commitAt(dir, "k.txt", "agent plus later main edit\n", daysAgo(5));
    git(dir, "update-ref", "refs/remotes/origin/main", git(dir, "rev-parse", "HEAD"));
    git(dir, "checkout", "-q", "main");
    git(dir, "branch", "-q", "-D", "squash");
    const merged = { bySha: new Set([prHead]), byName: new Map([["ship/audit-fixes", [prHead]]]) };
    const baseRef = "refs/remotes/origin/main";
    return { dir, agent, prHead, merged, baseRef, ctx: { cwd: dir, baseRef, merged, viaMerged: reachableFromMerged(dir, merged, baseRef) } };
  }

  test("agent branch and integration tip are landed although main changed the files afterwards", () => {
    const c = integrationCase();
    expect(landedVia(c.agent, "agent", c.ctx)).toBe("chain");
    expect(landingState(c.prHead, "integ", c.ctx)).toMatchObject({ state: "landed" });
  });

  test("guard: a commit on the integration branch after its PR merged keeps it unlanded", () => {
    const c = integrationCase();
    git(c.dir, "checkout", "-q", "integ");
    const later = commitAt(c.dir, "after.txt", "after merge\n", daysAgo(1));
    git(c.dir, "checkout", "-q", "main");
    const ctx = { ...c.ctx, viaMerged: reachableFromMerged(c.dir, c.merged, c.baseRef) };
    expect(landingState(later, "integ", ctx).state).not.toBe("landed");
  });

  test("offline (no merged list) the old behaviour stays: partial, not landed", () => {
    const c = integrationCase();
    const ctx = { cwd: c.dir, baseRef: c.baseRef, merged: null, viaMerged: new Set() };
    expect(landedVia(c.agent, "agent", ctx)).toBeNull();
    expect(landingState(c.agent, "agent", ctx).state).not.toBe("landed");
  });
});

describe("backup expiry on origin", () => {
  function withOrigin() {
    const { dir, c1 } = makeRepo();
    const origin = mkTmp("hylife-origin-");
    git(origin, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", origin);
    git(dir, "push", "-q", "origin", "main");
    git(dir, "branch", "-q", "backup/old", c1);
    git(dir, "branch", "-q", "rescue/fresh", c1);
    git(dir, "push", "-q", "origin", "backup/old", "rescue/fresh");
    git(dir, "fetch", "-q", "origin");
    git(dir, "update-ref", "refs/remotes/origin/main", c1);
    git(dir, "branch", "-q", "-D", "backup/old", "rescue/fresh");
    return { dir, origin, c1 };
  }
  const stub = () => ({ bySha: new Set(), byName: new Map() });

  test("landed backup refs older than 14 days are deleted with trigger backup-expiry; younger stay", () => {
    const { dir, origin, c1 } = withOrigin();
    // c1 is 40 days old: both refs are old and landed (ancestor of main)...
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: stub, projectsDir: null, now: NOW });
    expect(plan.remoteExpire.map((r) => r.name).sort()).toEqual(["backup/old", "rescue/fresh"]);
    expect(plan.gateOpen).toBe(true);
    // ...so age it by tip date: pretend "now" is 41 days earlier → the younger one is inside the window
    const early = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: stub, projectsDir: null, now: NOW - 30 * DAY });
    expect(early.remoteExpire).toEqual([]);
    expect(BACKUP_EXPIRY_DAYS).toBe(14);
    const done = executeAutoClean(plan, scan, { cwd: dir, remotes: true, projectsDir: null });
    expect(done.removed.filter((r) => r.trigger === "backup-expiry").map((r) => r.name).sort()).toEqual(["backup/old", "rescue/fresh"]);
    expect(git(origin, "for-each-ref", "refs/heads", "--format=%(refname:short)")).toBe("main");
    expect(c1).toBeTruthy();
  });

  test("salvage, salvage-land, parked and wip copies on origin expire like backup refs", () => {
    const { dir, origin, c1 } = withOrigin();
    const names = ["salvage/x", "salvage-land/y", "parked/autosave/s1", "wip/z"];
    for (const n of names) git(dir, "push", "-q", "origin", `${c1}:refs/heads/${n}`);
    git(dir, "fetch", "-q", "origin");
    expect(BACKUP_PATTERNS).toEqual(expect.arrayContaining(["refs/remotes/origin/salvage", "refs/remotes/origin/parked"]));
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: stub, projectsDir: null, now: NOW });
    expect(plan.remoteExpire.map((r) => r.name).sort()).toEqual(["backup/old", "parked/autosave/s1", "rescue/fresh", "salvage-land/y", "salvage/x", "wip/z"]);
    executeAutoClean(plan, scan, { cwd: dir, remotes: true, projectsDir: null });
    expect(git(origin, "for-each-ref", "refs/heads", "--format=%(refname:short)")).toBe("main");
  });

  test("offline: nothing expires", () => {
    const { dir } = withOrigin();
    const plan = planAutoClean(scanRepo(dir, NOW), SETTINGS, { cwd: dir, fetchMerged: () => null, projectsDir: null, now: NOW });
    expect(plan.remoteExpire).toEqual([]);
  });

  test("a ref that moved on origin since the plan is skipped", () => {
    const { dir, origin } = withOrigin();
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: stub, projectsDir: null, now: NOW });
    git(dir, "checkout", "-q", "-b", "tmp", "refs/remotes/origin/backup/old");
    const moved = commitAt(dir, "m.txt", "m\n", daysAgo(1));
    git(dir, "checkout", "-q", "main");
    git(dir, "push", "-q", "origin", `${moved}:refs/heads/backup/old`);
    git(dir, "fetch", "-q", "origin");
    const done = executeAutoClean(plan, scan, { cwd: dir, remotes: true, projectsDir: null });
    expect(done.skipped.some((s) => s.name === "backup/old" && s.reason === "remote-moved")).toBe(true);
    expect(git(origin, "for-each-ref", "refs/heads", "--format=%(refname:short)")).toContain("backup/old");
  });
});

describe("temp worktrees", () => {
  function tempWorktree(dir, tmpDir, name, c, ageMs, lockReason) {
    const wt = path.join(tmpDir, name);
    git(dir, "worktree", "add", "-q", "--detach", wt, c);
    if (lockReason) git(dir, "worktree", "lock", "--reason", lockReason, wt);
    const admin = path.join(dir, ".git", "worktrees", name);
    const t = new Date(NOW - ageMs);
    for (const f of ["index", "HEAD", path.join("logs", "HEAD")]) {
      try { fs.utimesSync(path.join(admin, f), t, t); } catch { /* optional */ }
    }
    return wt;
  }
  const run = (dir, tmpDir) => {
    const scan = scanRepo(dir, NOW, { tmpDir });
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: () => null, projectsDir: null, now: NOW });
    return { scan, plan };
  };

  test("old unlocked, dead-pid and initializing temp worktrees go; recent and live-pid ones stay", () => {
    const { dir, c1 } = makeRepo();
    const tmpDir = mkTmp("hylife-tmpwt-");
    const old = tempWorktree(dir, tmpDir, "ab-variant-old", c1, 3 * HOUR);
    const dead = tempWorktree(dir, tmpDir, "devops-parity-dead", c1, 3 * HOUR, "claude (pid 999999999)");
    const init = tempWorktree(dir, tmpDir, "devops-parity-init", c1, 2 * HOUR, "initializing");
    const live = tempWorktree(dir, tmpDir, "ab-variant-live", c1, 3 * HOUR, `claude (pid ${process.pid})`);
    const fresh = tempWorktree(dir, tmpDir, "ab-variant-fresh", c1, 5 * 60_000);
    const { scan, plan } = run(dir, tmpDir);
    const picked = plan.remove.filter((u) => u.trigger === "temp").map((u) => path.basename(u.path)).sort();
    expect(picked).toEqual(["ab-variant-old", "devops-parity-dead", "devops-parity-init"]);
    const done = executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(done.removed.filter((r) => r.kind === "worktree").length).toBe(3);
    expect(fs.existsSync(old) || fs.existsSync(dead) || fs.existsSync(init)).toBe(false);
    expect(fs.existsSync(live) && fs.existsSync(fresh)).toBe(true);
  });

  test("a repo that itself lives in the temp dir has no temp worktrees", () => {
    const { dir, c1 } = makeRepo();
    tempWorktree(dir, path.dirname(dir), `hylife-wt-${process.pid}`, c1, 3 * HOUR);
    tmp.push(path.join(path.dirname(dir), `hylife-wt-${process.pid}`));
    const scan = scanRepo(dir, NOW, { tmpDir: os.tmpdir() });
    expect(scan.units.some((u) => u.temp)).toBe(false);
  });
});

describe("stale own PRs", () => {
  function prCase() {
    const { dir, c1 } = makeRepo();
    git(dir, "checkout", "-q", "-b", "pr717", c1);
    const head = commitAt(dir, "f.txt", "pr version\n", daysAgo(9));
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "other", c1);
    commitAt(dir, "f.txt", "main version\n", daysAgo(2));
    git(dir, "update-ref", "refs/remotes/origin/main", git(dir, "rev-parse", "HEAD"));
    git(dir, "checkout", "-q", "main");
    git(dir, "branch", "-q", "-D", "other");
    const pr = (over = {}) => ({
      number: 717, title: "the file", headRefName: "pr717", headRefOid: head, createdAt: daysAgo(9), updatedAt: daysAgo(9),
      files: [{ path: "f.txt" }], commits: [{ committedDate: daysAgo(9) }], ...over,
    });
    return { dir, head, pr, base: { cwd: dir, baseRef: "refs/remotes/origin/main", now: NOW, worktrees: [] } };
  }

  test("main changed every file after the PR's last commit -> superseded", () => {
    const c = prCase();
    expect(findStalePrs([c.pr()], c.base)).toEqual([{ number: 717, title: "the file", reason: "superseded", days: 9 }]);
  });

  test("identical file on main -> superseded even for a fresh PR", () => {
    const c = prCase();
    git(c.dir, "update-ref", "refs/remotes/origin/main", c.head);
    const fresh = c.pr({ commits: [{ committedDate: daysAgo(0.1) }], updatedAt: daysAgo(0.1) });
    expect(findStalePrs([fresh], c.base)[0]).toMatchObject({ reason: "superseded" });
  });

  test("old PR without worktree is stale, with a worktree on its head it is not", () => {
    const c = prCase();
    // main untouched since the PR: not superseded
    git(c.dir, "update-ref", "refs/remotes/origin/main", BASE.c1);
    const files = [{ path: "f.txt" }];
    expect(findStalePrs([c.pr({ files })], c.base)[0]).toMatchObject({ reason: "old" });
    expect(findStalePrs([c.pr({ files })], { ...c.base, worktrees: [{ branch: "pr717", head: c.head }] })).toEqual([]);
    expect(findStalePrs([c.pr({ files, commits: [{ committedDate: daysAgo(1) }], updatedAt: daysAgo(1) })], c.base)).toEqual([]);
  });

  test("runHygiene: open item with the exact reply; offline (null) and no PRs give none; nothing is closed", () => {
    const c = prCase();
    const statePath = path.join(mkTmp("hylife-state-"), "s.json");
    const base = { cwd: c.dir, trigger: "ship", settings: { ...SETTINGS, autoClean: false }, statePath, now: NOW, fetchMerged: () => null };
    const res = runHygiene({ ...base, fetchOwnPrs: () => [c.pr()] });
    expect(res.card.openItems).toEqual([{
      text: expect.stringContaining("PR #717"), reply: "PR #717 schließen — überholt durch main.",
    }]);
    expect(runHygiene({ ...base, fetchOwnPrs: () => null }).card.openItems).toBeUndefined();
    expect(cardLines({ autoClean: { ran: false }, stalePrs: [] }).openItems).toBeUndefined();
  });
});

describe("startOrphanScan", () => {
  test("spawns detached, hidden, unref'd and never throws", () => {
    const calls = [];
    const fake = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { pid: undefined, on() {}, unref() { calls.push("unref"); } };
    };
    expect(startOrphanScan("scan.js", fake)).toBe(true);
    expect(calls[0].opts).toMatchObject({ detached: true, windowsHide: true, stdio: "ignore" });
    expect(calls[0].args).toEqual(["scan.js"]);
    expect(calls).toContain("unref");
    expect(startOrphanScan("scan.js", () => { throw new Error("no spawn"); })).toBe(false);
  });
});

describe("main checkout on a landed local-only branch (#879) and landed worktrees outside .claude/worktrees (#875)", () => {
  const stub = () => ({ bySha: new Set(), byName: new Map() });
  const classify = (dir, scan) => classifyUnits(scan, { cwd: dir, fetchMerged: stub, projectsDir: null, now: NOW });

  test("a landed, upstream-less branch checked out in the main checkout is reported, never removable", () => {
    const { dir } = makeRepo();
    git(dir, "checkout", "-q", "-b", "feat/linux");
    const scan = scanRepo(dir, NOW);
    const unit = scan.units.find((u) => u.kind === "main-checkout");
    expect(unit).toMatchObject({ branch: "feat/linux" });
    const cls = classify(dir, scan);
    expect(cls.mainOnLanded.map((u) => u.branch)).toEqual(["feat/linux"]);
    expect(cls.removable).toEqual([]);
    expect(cls.atRisk).toEqual([]);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: stub, projectsDir: null, now: NOW });
    expect(plan.remove).toEqual([]);
  });

  test("the main checkout on the default branch, or on an unlanded branch, is not reported as landed", () => {
    const { dir } = makeRepo();
    expect(scanRepo(dir, NOW).units.some((u) => u.kind === "main-checkout")).toBe(false);
    git(dir, "checkout", "-q", "-b", "feat/open");
    commitAt(dir, "b.txt", "x
", daysAgo(1));
    const cls = classify(dir, scanRepo(dir, NOW));
    expect(cls.mainOnLanded).toEqual([]);
    expect(cls.atRisk).toEqual([]);
  });

  test("a branch with an upstream is no main-checkout unit", () => {
    const { dir, c1 } = makeRepo();
    git(dir, "checkout", "-q", "-b", "feat/up");
    git(dir, "update-ref", "refs/remotes/origin/feat/up", c1);
    git(dir, "config", "branch.feat/up.remote", "origin");
    git(dir, "config", "branch.feat/up.merge", "refs/heads/feat/up");
    expect(scanRepo(dir, NOW).units.some((u) => u.kind === "main-checkout")).toBe(false);
  });

  test("a clean landed sibling worktree lands in landedOutside, not in removable", () => {
    const { dir, c1 } = makeRepo();
    const wt = path.join(mkTmp("hylife-sib-"), "wt");
    git(dir, "worktree", "add", "-q", wt, "-b", "feat/sib", c1);
    const cls = classify(dir, scanRepo(dir, NOW));
    expect(cls.landedOutside.map((u) => u.branch)).toEqual(["feat/sib"]);
    expect(cls.removable).toEqual([]);
    expect(cls.keep).toEqual([]);
  });

  test("a sibling worktree with uncommitted changes or unlanded work stays out of landedOutside", () => {
    const { dir, c1 } = makeRepo();
    const wt = path.join(mkTmp("hylife-sib-"), "wt");
    git(dir, "worktree", "add", "-q", wt, "-b", "feat/dirty", c1);
    fs.writeFileSync(path.join(wt, "new.txt"), "x
");
    const wt2 = path.join(mkTmp("hylife-sib-"), "wt");
    git(dir, "worktree", "add", "-q", wt2, "-b", "feat/ahead", c1);
    commitAt(wt2, "c.txt", "y
", daysAgo(1));
    const cls = classify(dir, scanRepo(dir, NOW));
    expect(cls.landedOutside).toEqual([]);
    expect(cls.removable).toEqual([]);
  });
});
