import { describe, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseWorktrees, scanRepo, planAutoClean, executeAutoClean, runHygiene, cardLines, landedVia,
  isRegenerable, isToolingState, hasLiveSession, LIVE_SESSION_MS, REMOVE_TIMEOUT, normPath,
  minIdleDays, reachableFromMerged,
} from "./hygiene.js";

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

describe("auto-clean — how long a leftover waits (#571)", () => {
  test("no leftover at all → no network call, nothing removed", () => {
    const { dir } = makeRepo();
    let called = 0;
    const plan = planAutoClean(scanRepo(dir, NOW), SETTINGS, { cwd: dir, fetchMerged: () => { called++; return null; } });
    expect(plan.gateOpen).toBe(false);
    expect(called).toBe(0);
  });

  test("a leftover that did NOT land stays, however old", () => {
    const { dir, c1 } = makeRepo();
    branchWithCommit(dir, "unshipped", c1, "b.txt", "mine\n", daysAgo(35));
    const plan = planAutoClean(scanRepo(dir, NOW), SETTINGS, { cwd: dir, fetchMerged: offline });
    expect(plan.gateOpen).toBe(false);
    expect(plan.keep.map((u) => [u.branch, u.reason])).toEqual([["unshipped", "not-landed"]]);
  });

  test("every landed branch goes at once, however young; unshipped ones stay", () => {
    const { dir, c1, c2, c3 } = makeRepo();
    git(dir, "branch", "old-landed", c1);
    git(dir, "branch", "mid-landed", c2);
    git(dir, "branch", "young-landed", c3);
    branchWithCommit(dir, "unshipped", c1, "b.txt", "mine\n", daysAgo(35));
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.autoClean.ran).toBe(true);
    expect(res.autoClean.removed.map((r) => r.name).sort()).toEqual(["mid-landed", "old-landed", "young-landed"]);
    expect(res.autoClean.removed.every((r) => /^[0-9a-f]{40}$/.test(r.sha))).toBe(true);
    expect(branches(dir)).toEqual(["main", "unshipped"]);
    expect(res.leftover).toBe(1);
    expect(res.card.tests).toEqual({ method: "Aufräumen (auto)", result: "3 Branches entfernt" });
  });

  test("a Desktop session worktree waits autoCleanMinAgeDays idle; a sub-agent worktree only LIVE_SESSION_MS", () => {
    const { dir, c1 } = makeRepo();
    const session = sessionWorktree(dir, "wt-session", c1, 1);
    const agent = sessionWorktree(dir, "agent-a0123456789abcdef", c1, 1);
    const fresh = sessionWorktree(dir, "agent-afedcba9876543210", c1, 0);
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline, projectsDir: null });
    expect(fs.existsSync(agent)).toBe(false);
    expect(fs.existsSync(session), "a day idle is no reason to close a Desktop session's worktree").toBe(true);
    expect(fs.existsSync(fresh), "an agent may still be working in it").toBe(true);
    expect(minIdleDays({ kind: "branch" }, SETTINGS)).toBe(0);
    expect(minIdleDays({ kind: "worktree", agent: false }, SETTINGS)).toBe(7);
  });

  test("the session trigger cleans like a ship; promote never does", () => {
    const { dir, c1 } = makeRepo();
    git(dir, "branch", "old-landed", c1);
    const res = runHygiene({ cwd: dir, trigger: "session", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.autoClean.ran).toBe(true);
    expect(branches(dir)).toEqual(["main"]);
  });
});

describe("auto-clean — sub-agent branches of a squash-merged PR (#572)", () => {
  test("a branch merged into the PR's branch before the squash counts as landed", () => {
    const { dir, c1 } = makeRepo();
    const child = branchWithCommit(dir, "worktree-agent-a1", c1, "k.txt", "child\n", daysAgo(2));
    git(dir, "checkout", "-q", "-b", "parent", c1);
    execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge child", "worktree-agent-a1"], { cwd: dir, stdio: "ignore" });
    const prHead = commitAt(dir, "p.txt", "parent\n", daysAgo(1));
    git(dir, "checkout", "-q", "main");
    const merged = { bySha: new Set([prHead]), byName: new Map([["parent", [prHead]]]) };
    const baseRef = "refs/remotes/origin/main";
    const viaMerged = reachableFromMerged(dir, merged, baseRef);
    expect(viaMerged.has(child)).toBe(true);
    expect(landedVia(child, "worktree-agent-a1", { cwd: dir, baseRef, merged, viaMerged })).toBe("pr");
    expect(landedVia(child, "worktree-agent-a1", { cwd: dir, baseRef, merged: null })).toBeNull();
  });

  test("a PR head missing locally is skipped, not fatal", () => {
    const { dir } = makeRepo();
    const merged = { bySha: new Set(["0123456789abcdef0123456789abcdef01234567"]), byName: new Map() };
    expect(reachableFromMerged(dir, merged, "refs/remotes/origin/main").size).toBe(0);
  });

  test("a removed branch's same-commit twin on origin goes too; a moved one stays", () => {
    const { dir, c1, c3 } = makeRepo();
    const bare = mkTmp("hy-origin-");
    git(bare, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-q", "origin", `${c3}:refs/heads/main`);
    const tip = branchWithCommit(dir, "worktree-agent-a2", c1, "q.txt", "Q\n", daysAgo(2));
    git(dir, "push", "-q", "origin", "worktree-agent-a2");
    git(dir, "branch", "moved-there", c1);
    git(dir, "push", "-q", "origin", `${c3}:refs/heads/moved-there`);
    git(dir, "fetch", "-q", "origin");
    const merged = { bySha: new Set([tip]), byName: new Map() };
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: () => merged });
    const kinds = res.autoClean.removed.map((r) => `${r.kind}:${r.name}`).sort();
    expect(kinds).toEqual(["branch:moved-there", "branch:worktree-agent-a2", "remote:worktree-agent-a2"]);
    expect(git(bare, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").sort()).toEqual(["main", "moved-there"]);
    expect(res.card.tests.result).toBe("2 Branches · 1 Remote-Branch entfernt · 1 übersprungen");
  });
});

describe("unlanded work at risk (#573)", () => {
  /** A branch whose upstream was deleted after its PR merged, with one commit on top. */
  function goneBranchWithExtra(dir, c1) {
    const prHead = branchWithCommit(dir, "shipped-then-more", c1, "r.txt", "in the PR\n", daysAgo(3));
    git(dir, "checkout", "-q", "shipped-then-more");
    commitAt(dir, "r.txt", "after the merge\n", daysAgo(2));
    git(dir, "checkout", "-q", "main");
    // git reports `[gone]` only for a configured remote whose ref is missing
    git(dir, "remote", "add", "origin", mkTmp("hy-no-origin-"));
    git(dir, "config", "branch.shipped-then-more.remote", "origin");
    git(dir, "config", "branch.shipped-then-more.merge", "refs/heads/shipped-then-more");
    return prHead;
  }

  test("a [gone] branch with commits beyond its merged PR is kept and flagged on the card", () => {
    const { dir, c1 } = makeRepo();
    const prHead = goneBranchWithExtra(dir, c1);
    const merged = { bySha: new Set([prHead]), byName: new Map([["shipped-then-more", [prHead]]]) };
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: () => merged });
    expect(branches(dir)).toContain("shipped-then-more");
    expect(res.atRisk).toEqual([expect.objectContaining({ kind: "branch", branch: "shipped-then-more", commits: 1 })]);
    expect(res.card.risk.text).toBe("⚠ Nicht gelandete Arbeit ohne PR: shipped-then-more (1 Commit) — pushen und mergen oder bewusst verwerfen");
    expect(cardLines(res, "en").risk.text).toMatch(/^⚠ Unlanded work without a PR: shipped-then-more \(1 commit\)/);
  });

  test("offline nothing is flagged — a squash-merged branch would look the same", () => {
    const { dir, c1 } = makeRepo();
    goneBranchWithExtra(dir, c1);
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
    expect(res.atRisk).toEqual([]);
    expect(res.card.risk).toBeUndefined();
  });

  test("an unlanded branch that still has its upstream is not flagged", () => {
    const { dir, c1 } = makeRepo();
    branchWithCommit(dir, "in-progress", c1, "w.txt", "wip\n", daysAgo(2));
    const res = runHygiene({ cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: () => ({ bySha: new Set(), byName: new Map() }) });
    expect(res.atRisk).toEqual([]);
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

describe("auto-clean — what a worktree removal would destroy (AUD-C001/C009/C010)", () => {
  const run = (dir, extra = {}) => runHygiene({
    cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mkTmp("hy-state-"), "s.json"),
    now: NOW, fetchMerged: offline, projectsDir: null, ...extra,
  });
  const skippedWt = (res, name) => res.autoClean.skipped.find((s) => s.kind === "worktree" && path.basename(s.path) === name);

  test("isRegenerable: build output only", () => {
    for (const e of ["node_modules/", "pkg/a/node_modules/", "dist/", "src/__pycache__/", "x/y.pyc", "target/debug/", ".next/"]) {
      expect(isRegenerable(e), e).toBe(true);
    }
    // A file listed on its own under a build-named folder: that folder is not
    // ignored as a whole, so the file is no build output (a secret, a keystore).
    for (const e of [".env", "BURN-SALVAGE-1.patch", ".claude/audit/", ".claude/batch.md", "concepts/", "dist", "notes/dist.txt",
      "build/.env", "target/release.keystore", "out/cert.p12", "target/debug/app"]) {
      expect(isRegenerable(e), e).toBe(false);
    }
  });

  test("an ignored .env keeps the worktree; node_modules alone does not (hyg1)", () => {
    const { dir, c1 } = makeRepo();
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), ".env\nnode_modules/\n*.patch\n");
    const secret = sessionWorktree(dir, "wt-secret", c1, 40);
    fs.writeFileSync(path.join(secret, ".env"), "API_KEY=only-copy\n");
    fs.writeFileSync(path.join(secret, "BURN-SALVAGE-1.patch"), "diff\n");
    const build = sessionWorktree(dir, "wt-build", c1, 40);
    fs.mkdirSync(path.join(build, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(build, "node_modules", "x", "i.js"), "1\n");

    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(fs.readFileSync(path.join(secret, ".env"), "utf8")).toBe("API_KEY=only-copy\n");
    const why = plan.keep.find((u) => u.branch === "wt-secret").reason;
    expect(why).toMatch(/^holds ignored files: /);
    expect(why).toContain(".env");
    expect(why).toContain("BURN-SALVAGE-1.patch");
    expect(fs.existsSync(build)).toBe(false);
  });

  test("isToolingState: run bookkeeping and pure runtime state only", () => {
    for (const e of [".claude/.ship-watcher/", ".claude/.ship-watcher/state.json", ".claude/project-map.md", ".claude/run-contract.json",
      ".claude/batch-mode.json", "AUTONOMOUS-LOG.md", "AUTONOMOUS-REPORT.html", "BACKLOG-DONE.flag", "BURN-STATE.json",
      "BURN-STATE.json.lock", "graphify-out/"]) {
      expect(isToolingState(e), e).toBe(true);
    }
    for (const e of [".claude/", ".claude/batch.md", ".claude/batch-assets/", ".claude/concepts/", ".claude/audit/",
      ".claude/audit/2026-x/findings.md", "BURN-SALVAGE-1.patch", ".env", "notes/AUTONOMOUS-LOG.md", "BURN-1.md"]) {
      expect(isToolingState(e), e).toBe(false);
    }
  });

  test(".claude/ content goes only as runtime state or a byte-identical copy of the main checkout's", () => {
    const { dir, c1 } = makeRepo();
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "AUTONOMOUS-*\n");
    const put = (root, rel, text) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    const seeded = sessionWorktree(dir, "wt-seeded", c1, 40);
    put(seeded, ".claude/.ship-watcher/state.json", "{}\n");
    put(seeded, "AUTONOMOUS-LOG.md", "# log\n");
    put(dir, ".claude/audit/2026-09-01-main/findings.md", "same\n");
    put(seeded, ".claude/audit/2026-09-01-main/findings.md", "same\n");
    const audited = sessionWorktree(dir, "wt-audited", c1, 40);
    put(audited, ".claude/audit/2026-09-26-own/findings.md", "only copy\n");
    const extended = sessionWorktree(dir, "wt-extended", c1, 40);
    put(extended, ".claude/audit/2026-09-01-main/findings.md", "same\n");
    put(extended, ".claude/audit/2026-09-01-main/more.md", "added in the session\n");
    const notes = sessionWorktree(dir, "wt-notes", c1, 40);
    put(notes, ".claude/batch.md", "- a note never fired\n");

    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    const why = (b) => plan.keep.find((u) => u.branch === b).reason;
    expect(fs.existsSync(seeded), "runtime state, a run journal and a seed copy are no reason to stay").toBe(false);
    expect(why("wt-audited")).toBe("holds ignored files: .claude/audit/2026-09-26-own/findings.md");
    expect(why("wt-extended"), "same dossier name, new content").toBe("holds ignored files: .claude/audit/2026-09-01-main/more.md");
    expect(why("wt-notes")).toBe("holds ignored files: .claude/batch.md");
    expect(fs.readFileSync(path.join(notes, ".claude", "batch.md"), "utf8")).toBe("- a note never fired\n");
  });

  test("a worktree holding another checkout stays", () => {
    const { dir, c1 } = makeRepo();
    const outer = sessionWorktree(dir, "wt-outer", c1, 40);
    const inner = path.join(outer, ".claude", "worktrees", "wt-inner");
    git(dir, "worktree", "add", "-q", "-b", "wt-inner", inner, c1);
    fs.writeFileSync(path.join(inner, "draft.txt"), "uncommitted\n");
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(plan.keep.find((u) => u.branch === "wt-outer").reason).toMatch(/^holds another checkout: .*wt-inner$/);
    expect(fs.readFileSync(path.join(inner, "draft.txt"), "utf8")).toBe("uncommitted\n");
  });

  test("an ignored link (a junctioned node_modules) keeps the worktree and its target", () => {
    const { dir, c1 } = makeRepo();
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "node_modules\n");
    const shared = mkTmp("hy-shared-");
    fs.writeFileSync(path.join(shared, "pkg.js"), "module.exports = 1;\n");
    const wt = sessionWorktree(dir, "wt-linked", c1, 40);
    fs.symlinkSync(shared, path.join(wt, "node_modules"), "junction");
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(plan.keep.find((u) => u.branch === "wt-linked").reason).toMatch(/^(holds a link: node_modules\/?|uncommitted-changes)$/);
    expect(fs.existsSync(path.join(shared, "pkg.js"))).toBe(true);
  });

  test("a junction inside .claude/ keeps the worktree and its target survives", () => {
    const { dir, c1 } = makeRepo();
    const shared = mkTmp("hy-shared-");
    fs.writeFileSync(path.join(shared, "secret.txt"), "only copy\n");
    const wt = sessionWorktree(dir, "wt-claude-link", c1, 40);
    fs.mkdirSync(path.join(wt, ".claude"), { recursive: true });
    fs.symlinkSync(shared, path.join(wt, ".claude", "external"), "junction");
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(fs.existsSync(wt)).toBe(true);
    expect(plan.keep.find((u) => u.branch === "wt-claude-link")).toBeTruthy();
    expect(fs.readFileSync(path.join(shared, "secret.txt"), "utf8")).toBe("only copy\n");
  });

  test("a damaged removal stays on the card until its folder is gone", () => {
    const { dir, c1 } = makeRepo();
    const slow = sessionWorktree(dir, "wt-slow", c1, 40);
    const statePath = path.join(mkTmp("hy-state-"), "s.json");
    const base = { cwd: dir, trigger: "ship", statePath, now: NOW, fetchMerged: offline, projectsDir: null };
    const same = (list) => list.map((p) => path.resolve(p));
    const first = runHygiene({ ...base, settings: SETTINGS, removeTimeout: 1 });
    expect(same(first.damaged)).toEqual([path.resolve(slow)]);
    const later = runHygiene({ ...base, settings: { ...SETTINGS, autoClean: false } });
    expect(same(later.damaged), "still reported on a run that removes nothing").toEqual([path.resolve(slow)]);
    expect(later.card.tests.result).toContain("wt-slow");
    fs.rmSync(slow, { recursive: true, force: true });
    const cleared = runHygiene({ ...base, settings: { ...SETTINGS, autoClean: false } });
    expect(cleared.damaged).toEqual([]);
  });

  test("an untracked file counts under status.showUntrackedFiles=no (hyg3)", () => {
    const { dir, c1 } = makeRepo();
    git(dir, "config", "status.showUntrackedFiles", "no");
    const wt = sessionWorktree(dir, "wt-untracked", c1, 40);
    fs.writeFileSync(path.join(wt, "new-work.txt"), "only copy\n");
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(fs.existsSync(path.join(wt, "new-work.txt"))).toBe(true);
    expect(plan.keep.find((u) => u.branch === "wt-untracked").reason).toBe("uncommitted-changes");
  });

  test("a worktree with a fresh Claude transcript is live and stays; a stale one does not count", () => {
    const { dir, c1 } = makeRepo();
    const live = sessionWorktree(dir, "wt-live", c1, 40);
    const idle = sessionWorktree(dir, "wt-idle", c1, 40);
    const projects = mkTmp("hy-projects-");
    const liveDir = path.join(projects, path.resolve(live).replace(/[\\/:.]/g, "-"));
    fs.mkdirSync(liveDir);
    fs.writeFileSync(path.join(liveDir, "s.jsonl"), "{}\n");
    const idleDir = path.join(projects, path.resolve(idle).replace(/[\\/:.]/g, "-"));
    fs.mkdirSync(idleDir);
    fs.writeFileSync(path.join(idleDir, "s.jsonl"), "{}\n");
    const old = new Date(Date.now() - LIVE_SESSION_MS - 60_000);
    fs.utimesSync(path.join(idleDir, "s.jsonl"), old, old);

    const res = run(dir, { projectsDir: projects });
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(idle)).toBe(false);
    expect(res.autoClean.removed.map((r) => r.name || path.basename(r.path)).sort()).toEqual(["wt-idle", "wt-idle"]);
    expect(hasLiveSession(live, projects)).toBe(true);
  });

  test("a removal that fails is reported as damaged and the closing prune is skipped", () => {
    const { dir, c1 } = makeRepo();
    sessionWorktree(dir, "wt-slow", c1, 40);
    // a stale registration the final prune would otherwise drop
    const gone = sessionWorktree(dir, "wt-gone", c1, 0);
    fs.rmSync(gone, { recursive: true, force: true });
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    expect(plan.remove.some((u) => u.branch === "wt-slow")).toBe(true);
    const done = executeAutoClean(plan, scan, { cwd: dir, removeTimeout: 1, projectsDir: null });
    const s = done.skipped.find((x) => x.kind === "worktree");
    expect(s.reason).toMatch(/damaged — manual check$/);
    expect(s.orphan).toBe(s.path);
    expect(done.pruned).toBe(false);
    expect(git(dir, "worktree", "list", "--porcelain")).toContain("wt-gone");
    expect(skippedWt({ autoClean: done }, "wt-slow")).toBeTruthy();
  });

  test("holdPrune keeps a stale registration listed until the damaged folder is gone, then prunes it", () => {
    const { dir, c1 } = makeRepo();
    const slow = sessionWorktree(dir, "wt-slow", c1, 40);
    const statePath = path.join(mkTmp("hy-state-"), "s.json");
    const base = { cwd: dir, trigger: "ship", statePath, now: NOW, fetchMerged: offline, projectsDir: null, removeTimeout: 1 };

    // run 1: wt-slow times out on removal → recorded as damaged.
    const first = runHygiene({ ...base, settings: SETTINGS });
    expect(first.damaged.map((p) => path.resolve(p))).toEqual([path.resolve(slow)]);

    // run 2: gate opens again (a fresh old landed branch) and a stale
    // registration (folder already deleted) is present — prune must be held
    // because the damaged folder from run 1 is still around.
    git(dir, "branch", "old-landed2", c1);
    const gone = sessionWorktree(dir, "wt-gone", c1, 0);
    fs.rmSync(gone, { recursive: true, force: true });
    const second = runHygiene({ ...base, settings: SETTINGS });
    expect(second.autoClean.ran).toBe(true);
    expect(git(dir, "worktree", "list", "--porcelain")).toContain("wt-gone");
    expect(second.damaged.map((p) => path.resolve(p))).toEqual([path.resolve(slow)]);

    // run 3: the damaged folder is gone (now prunable itself), and another
    // old landed branch keeps the gate open → the closing prune finally
    // runs, dropping the stale registration.
    fs.rmSync(slow, { recursive: true, force: true });
    git(dir, "branch", "old-landed3", c1);
    const third = runHygiene({ ...base, settings: SETTINGS });
    expect(third.damaged).toEqual([]);
    expect(git(dir, "worktree", "list", "--porcelain")).not.toContain("wt-gone");
  });

  test("the same damaged path recorded under a different slash style is not duplicated", () => {
    const { dir, c1 } = makeRepo();
    const slow = sessionWorktree(dir, "wt-slow", c1, 40);
    const statePath = path.join(mkTmp("hy-state-"), "s.json");
    // Seed the state file as if an earlier version had recorded the same
    // damaged folder with backslashes — normPath must still recognize it as
    // the same path as the forward-slash one git reports.
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const key = normPath(dir);
    fs.writeFileSync(statePath, JSON.stringify({
      repos: { [key]: { damaged: [{ path: path.resolve(slow).replace(/\//g, "\\"), at: new Date(NOW).toISOString() }] } },
    }));
    const base = { cwd: dir, trigger: "ship", statePath, now: NOW, fetchMerged: offline, projectsDir: null };
    const res = runHygiene({ ...base, settings: SETTINGS, removeTimeout: 1 });
    expect(res.damaged).toHaveLength(1);
  });

  test("the per-removal ceiling is not the 120 s one git-hygiene.md forbids", () => {
    expect(REMOVE_TIMEOUT).toBeGreaterThanOrEqual(15 * 60_000);
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

  test("a worktree that got dirty after planning is skipped, folder and branch intact", () => {
    const { dir, c1 } = makeRepo();
    const wt = sessionWorktree(dir, "wt-turned-dirty", c1, 40);
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    expect(plan.remove.map((u) => u.branch)).toEqual(["wt-turned-dirty"]);
    fs.writeFileSync(path.join(wt, "late-write.txt"), "snuck in after planning\n");
    const done = executeAutoClean(plan, scan, { cwd: dir, projectsDir: null });
    expect(done.removed).toEqual([]);
    expect(done.skipped).toHaveLength(1);
    expect(done.skipped[0]).toMatchObject({ kind: "worktree", branch: "wt-turned-dirty", reason: "uncommitted-changes" });
    expect(normPath(done.skipped[0].path)).toBe(normPath(wt));
    expect(fs.existsSync(wt)).toBe(true);
    expect(branches(dir)).toContain("wt-turned-dirty");
  });

  test("a worktree that got a live Claude transcript after planning is skipped, folder and branch intact", () => {
    const { dir, c1 } = makeRepo();
    const wt = sessionWorktree(dir, "wt-turned-live", c1, 40);
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: offline, projectsDir: null });
    expect(plan.remove.map((u) => u.branch)).toEqual(["wt-turned-live"]);
    const projects = mkTmp("hy-projects-");
    const liveDir = path.join(projects, path.resolve(wt).replace(/[\\/:.]/g, "-"));
    fs.mkdirSync(liveDir);
    fs.writeFileSync(path.join(liveDir, "s.jsonl"), "{}\n");
    const done = executeAutoClean(plan, scan, { cwd: dir, projectsDir: projects });
    expect(done.removed).toEqual([]);
    expect(done.skipped).toHaveLength(1);
    expect(done.skipped[0]).toMatchObject({ kind: "worktree", branch: "wt-turned-live", reason: "live-session" });
    expect(normPath(done.skipped[0].path)).toBe(normPath(wt));
    expect(fs.existsSync(wt)).toBe(true);
    expect(branches(dir)).toContain("wt-turned-live");
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
    const res = runHygiene({ cwd: dir, trigger: "promote", settings: { ...SETTINGS, nudgeThreshold: 1 }, statePath: path.join(mkTmp("hy-state-"), "s.json"), now: NOW, fetchMerged: offline });
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

describe("cardLines — a damaged removal names its path (AUD-C010)", () => {
  test("the orphan path is on the card", () => {
    const out = cardLines({ autoClean: { ran: true, removed: [], skipped: [{ kind: "worktree", path: "/r/.claude/worktrees/x", reason: "remove-timeout: damaged — manual check", orphan: "/r/.claude/worktrees/x" }] } }, "en");
    expect(out.tests.result).toContain("damaged — manual check: /r/.claude/worktrees/x");
  });
});
