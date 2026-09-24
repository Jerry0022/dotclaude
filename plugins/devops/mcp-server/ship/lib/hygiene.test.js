import { describe, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseWorktrees, scanRepo, planAutoClean, executeAutoClean, runHygiene, cardLines, landedVia,
} from "./hygiene.js";

// Real git repos in temp dirs; each spawn costs ~30 ms on Windows.
vi.setConfig({ testTimeout: 60_000 });

const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const SETTINGS = Object.freeze({
  autoClean: true, autoCleanGateDays: 30, autoCleanMinAgeDays: 7,
  nudge: true, nudgeThreshold: 50, nudgeCooldownDays: 7,
});

const tmp = [];
function mkTmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
afterEach(() => {
  while (tmp.length) {
    const d = tmp.pop();
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows file lock — temp dir, harmless */ }
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

/** Branch `name` off `base` with one own commit. */
function branchWithCommit(cwd, name, base, file, content, when) {
  git(cwd, "checkout", "-q", "-b", name, base);
  const sha = commitAt(cwd, file, content, when);
  git(cwd, "checkout", "-q", "main");
  return sha;
}

/**
 * main: c0 (60 d) → c1 (40 d) → c2 (10 d, adds t.txt) → c3 (3 d);
 * origin/main = c3, origin/HEAD → origin/main (no network involved).
 * Built once; every test gets a plain file copy — the full suite runs on a
 * loaded machine, and ~14 git spawns per test were pure overhead.
 */
let BASE = null;
beforeAll(() => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hygiene-base-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  const c0 = commitAt(dir, "a.txt", "0\n", daysAgo(60));
  const c1 = commitAt(dir, "a.txt", "1\n", daysAgo(40));
  const c2 = commitAt(dir, "t.txt", "T\n", daysAgo(10));
  const c3 = commitAt(dir, "a.txt", "3\n", daysAgo(3));
  git(dir, "update-ref", "refs/remotes/origin/main", c3);
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  BASE = { dir, c0, c1, c2, c3 };
});
afterAll(() => {
  try { fs.rmSync(BASE.dir, { recursive: true, force: true }); } catch { /* temp dir */ }
});

function makeRepo() {
  const dir = mkTmp("hygiene-");
  fs.cpSync(BASE.dir, dir, { recursive: true });
  return { ...BASE, dir };
}

const branches = (cwd) => git(cwd, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n").filter(Boolean).sort();
const offline = () => null;

/** A session worktree whose admin files look `ageDays` old. */
function sessionWorktree(dir, name, base, ageDays) {
  const wt = path.join(dir, ".claude", "worktrees", name);
  git(dir, "worktree", "add", "-q", "-b", name, wt, base);
  const admin = path.join(dir, ".git", "worktrees", name);
  const t = new Date(NOW - ageDays * DAY);
  for (const f of ["index", "HEAD", path.join("logs", "HEAD")]) {
    try { fs.utimesSync(path.join(admin, f), t, t); } catch { /* optional */ }
  }
  return wt;
}

describe("parseWorktrees", () => {
  test("reads head, branch, detached, locked and prunable", () => {
    const out = [
      "worktree C:/r", "HEAD aaa", "branch refs/heads/main", "",
      "worktree C:/r/.claude/worktrees/x", "HEAD bbb", "detached", "locked reason", "",
      "worktree C:/gone", "HEAD ccc", "branch refs/heads/g", "prunable gitdir file points to non-existent location",
    ].join("\n");
    expect(parseWorktrees(out)).toEqual([
      { path: "C:/r", head: "aaa", branch: "main", detached: false, locked: false, prunable: false },
      { path: "C:/r/.claude/worktrees/x", head: "bbb", branch: null, detached: true, locked: true, prunable: false },
      { path: "C:/gone", head: "ccc", branch: "g", detached: false, locked: false, prunable: true },
    ]);
  });
});

describe("scanRepo — what counts as a leftover", () => {
  test("branches without a worktree and linked worktrees; never the default or the current checkout", () => {
    const { dir, c1, c2 } = makeRepo();
    git(dir, "branch", "old", c1);
    git(dir, "branch", "mid", c2);
    sessionWorktree(dir, "wt1", c1, 1);
    const scan = scanRepo(dir, NOW);
    const keys = scan.units.map((u) => u.key).sort();
    expect(keys).toEqual(["branch:mid", "branch:old", expect.stringMatching(/^worktree:.*\/\.claude\/worktrees\/wt1$/)]);
    expect(scan.defaultBranch).toBe("main");
    const old = scan.units.find((u) => u.key === "branch:old");
    expect(Math.round(old.ageDays)).toBe(40);
  });
});

describe("auto-clean — the age gate", () => {
  test("nothing older than the gate → no network call, nothing removed", () => {
    const { dir, c2, c3 } = makeRepo();
    git(dir, "branch", "b10", c2);
    git(dir, "branch", "b3", c3);
    let called = 0;
    const plan = planAutoClean(scanRepo(dir, NOW), SETTINGS, { cwd: dir, fetchMerged: () => { called++; return null; } });
    expect(plan.gateOpen).toBe(false);
    expect(called).toBe(0);
  });

  test("an old leftover that did NOT land keeps the gate closed", () => {
    const { dir, c1 } = makeRepo();
    branchWithCommit(dir, "unshipped", c1, "b.txt", "mine\n", daysAgo(35));
    const plan = planAutoClean(scanRepo(dir, NOW), SETTINGS, { cwd: dir, fetchMerged: offline });
    expect(plan.gateOpen).toBe(false);
    expect(plan.keep.map((u) => [u.branch, u.reason])).toEqual([["unshipped", "not-landed"]]);
  });

  test("gate open → every landed leftover older than 7 days goes, younger and unshipped ones stay", () => {
    const { dir, c1, c2, c3 } = makeRepo();
    git(dir, "branch", "old-landed", c1);
    git(dir, "branch", "mid-landed", c2);
    git(dir, "branch", "young-landed", c3);
    branchWithCommit(dir, "unshipped", c1, "b.txt", "mine\n", daysAgo(35));
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.autoClean.ran).toBe(true);
    expect(res.autoClean.removed.map((r) => r.name).sort()).toEqual(["mid-landed", "old-landed"]);
    expect(res.autoClean.removed.every((r) => /^[0-9a-f]{40}$/.test(r.sha))).toBe(true);
    expect(branches(dir)).toEqual(["main", "unshipped", "young-landed"]);
    expect(res.leftover).toBe(2);
    expect(res.card.tests).toEqual({ method: "Aufräumen (auto)", result: "2 Branches entfernt" });
  });
});

describe("auto-clean — how 'landed' is proven", () => {
  test("squash merge: the tip is the head of a merged PR", () => {
    const { dir, c1 } = makeRepo();
    const tip = branchWithCommit(dir, "squashed", c1, "s.txt", "S\n", daysAgo(35));
    const ctx = { cwd: dir, baseRef: "refs/remotes/origin/main" };
    expect(landedVia(tip, "squashed", { ...ctx, merged: null })).toBeNull();
    expect(landedVia(tip, "squashed", { ...ctx, merged: { bySha: new Set([tip]), byName: new Map() } })).toBe("pr");
  });

  test("local tip behind the merged PR head still counts", () => {
    const { dir, c1 } = makeRepo();
    const behind = branchWithCommit(dir, "pushed-elsewhere", c1, "p.txt", "1\n", daysAgo(36));
    git(dir, "checkout", "-q", "pushed-elsewhere");
    const head = commitAt(dir, "p.txt", "2\n", daysAgo(35));
    git(dir, "checkout", "-q", "main");
    git(dir, "update-ref", "refs/heads/pushed-elsewhere", behind);
    const merged = { bySha: new Set([head]), byName: new Map([["pushed-elsewhere", [head]]]) };
    expect(landedVia(behind, "pushed-elsewhere", { cwd: dir, baseRef: "refs/remotes/origin/main", merged })).toBe("pr");
  });

  test("every touched file identical in main (a cherry-picked change) counts offline", () => {
    const { dir, c1 } = makeRepo();
    const tip = branchWithCommit(dir, "cherry", c1, "t.txt", "T\n", daysAgo(35));
    expect(landedVia(tip, "cherry", { cwd: dir, baseRef: "refs/remotes/origin/main", merged: null })).toBe("tree");
  });
});

describe("auto-clean — worktrees", () => {
  test("a clean, idle, landed session worktree goes with its branch; dirty and foreign ones stay", () => {
    const { dir, c1 } = makeRepo();
    sessionWorktree(dir, "wt-old", c1, 40);
    const dirty = sessionWorktree(dir, "wt-dirty", c1, 40);
    fs.writeFileSync(path.join(dirty, "unsaved.txt"), "work\n");
    const foreign = path.join(mkTmp("hy-foreign-"), "wt-manual");
    git(dir, "worktree", "add", "-q", "-b", "wt-manual", foreign, c1);

    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.autoClean.ran).toBe(true);
    const removed = res.autoClean.removed.map((r) => `${r.kind}:${r.name || path.basename(r.path)}`).sort();
    expect(removed).toEqual(["branch:wt-old", "worktree:wt-old"]);
    expect(fs.existsSync(path.join(dir, ".claude", "worktrees", "wt-old"))).toBe(false);
    expect(fs.existsSync(path.join(dirty, "unsaved.txt"))).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
    expect(branches(dir)).toEqual(["main", "wt-dirty", "wt-manual"]);
  });

  test("a recently used worktree on an old commit is not old", () => {
    const { dir, c1 } = makeRepo();
    sessionWorktree(dir, "wt-busy", c1, 0);
    const unit = scanRepo(dir, NOW).units.find((u) => u.kind === "worktree");
    expect(unit.ageDays).toBeLessThan(1);
  });
});

describe("auto-clean — re-check right before each removal", () => {
  test("a branch whose tip moved after planning is skipped, not deleted", () => {
    const { dir, c0, c1 } = makeRepo();
    git(dir, "branch", "old-landed", c1);
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline });
    expect(plan.remove.map((u) => u.branch)).toEqual(["old-landed"]);
    git(dir, "update-ref", "refs/heads/old-landed", c0);
    const done = executeAutoClean(plan, scan, { cwd: dir });
    expect(done.removed).toEqual([]);
    expect(done.skipped).toEqual([{ kind: "branch", name: "old-landed", reason: "moved" }]);
    expect(branches(dir)).toContain("old-landed");
  });
});

describe("runHygiene — trigger, switches and the nudge", () => {
  test("promote never removes anything", () => {
    const { dir, c1 } = makeRepo();
    git(dir, "branch", "old-landed", c1);
    const res = runHygiene({ cwd: dir, trigger: "promote", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.autoClean.ran).toBe(false);
    expect(branches(dir)).toContain("old-landed");
  });

  test("autoClean off → nothing removed", () => {
    const { dir, c1 } = makeRepo();
    git(dir, "branch", "old-landed", c1);
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: { ...SETTINGS, autoClean: false }, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.autoClean.reason).toMatch(/disabled/);
    expect(branches(dir)).toContain("old-landed");
  });

  test("above the threshold the card gets an open item — then the cooldown holds it back", () => {
    const { dir, c3 } = makeRepo();
    for (const n of ["x1", "x2", "x3"]) git(dir, "branch", n, c3);
    const statePath = path.join(mkTmp("hy-state-"), "s.json");
    const settings = { ...SETTINGS, nudgeThreshold: 2 };
    const first = runHygiene({ cwd: dir, trigger: "promote", settings, statePath, now: NOW, stateKey: dir });
    expect(first.nudge).toBe(true);
    expect(first.card.open).toEqual({
      text: "3 Branches/Worktrees liegen herum (Schwelle 2) — »branches aufräumen« öffnet die Aufräum-Seite",
      reply: "Ja, branches aufräumen.",
    });
    const soon = runHygiene({ cwd: dir, trigger: "promote", settings, statePath, now: NOW + DAY, stateKey: dir });
    expect(soon.nudge).toBe(false);
    expect(soon.nudgeSuppressed).toMatch(/cooldown/);
    expect(soon.card.open).toBeUndefined();
    const later = runHygiene({ cwd: dir, trigger: "promote", settings, statePath, now: NOW + 8 * DAY, stateKey: dir });
    expect(later.nudge).toBe(true);
  });

  test("at or below the threshold there is no nudge", () => {
    const { dir, c3 } = makeRepo();
    git(dir, "branch", "x1", c3);
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: { ...SETTINGS, nudgeThreshold: 1 }, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.leftover).toBe(1);
    expect(res.nudge).toBe(false);
    expect(res.card).toEqual({});
  });
});

describe("cardLines", () => {
  test("German and English wording", () => {
    const r = {
      autoClean: { ran: true, removed: [{ kind: "branch" }, { kind: "worktree" }, { kind: "branch" }], skipped: [{}] },
      nudge: true, leftover: 61, threshold: 50,
    };
    expect(cardLines(r, "de")).toEqual({
      tests: { method: "Aufräumen (auto)", result: "2 Branches · 1 Worktree entfernt · 1 übersprungen" },
      open: {
        text: "61 Branches/Worktrees liegen herum (Schwelle 50) — »branches aufräumen« öffnet die Aufräum-Seite",
        reply: "Ja, branches aufräumen.",
      },
    });
    expect(cardLines(r, "en").tests.result).toBe("2 branches · 1 worktree removed · 1 skipped");
    expect(cardLines(r, "en").open.text).toMatch(/say "branch cleanup"/);
    expect(cardLines(r, "en").open.reply).toBe("Yes, branch cleanup.");
  });
});
