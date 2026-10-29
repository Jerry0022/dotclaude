import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runHygiene as runHygieneAsync, residualOf, RESIDUAL_REMOVABLE, cardLines, landingState } from "./hygiene.js";

/**
 * #953: a `partial` branch (squash merge plus later edits) whose added lines
 * are >= 95 % in main is archived (tag) and removed; below that it is never
 * deleted but classified by content and offered as a decision item.
 */
const runHygiene = (p) => runHygieneAsync({ sync: true, ...p });
const DAY = 86_400_000;
const NOW = Date.now();
const when = (n) => new Date(NOW - n * DAY).toISOString();
const SETTINGS = Object.freeze({
  autoClean: true, autoCleanGateDays: 30, autoCleanMinAgeDays: 7, autoCleanKeepNewest: 0,
  nudge: false, nudgeThreshold: 50, nudgeCooldownDays: 7,
});
const noPr = () => ({ names: new Set(), shas: new Set() });
const merged = () => ({ bySha: new Set(), byName: new Map() });

const tmp = [];
const mk = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); tmp.push(d); return d; };
afterEach(() => { while (tmp.length) try { fs.rmSync(tmp.pop(), { recursive: true, force: true }); } catch { /* temp */ } });

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
function commit(cwd, files, date) {
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(cwd, f), c);
  git(cwd, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", "c"], { cwd, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return git(cwd, "rev-parse", "HEAD");
}
const lines = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} content ${i}`).join("\n") + "\n";

/**
 * main: base → "squash" (m.txt as the branch had it, + `mainExtra`);
 * branch `feat` (40 d old) adds m.txt (40 lines) and n.txt (`nLines` lines).
 */
function setup({ nLines, mainExtra = {} }) {
  const dir = mk("hy-partial-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  const base = commit(dir, { "a.txt": "alpha content line\n" }, when(60));
  git(dir, "checkout", "-q", "-b", "feat");
  const tip = commit(dir, { "m.txt": lines("m", 40), "n.txt": lines("n", nLines) }, when(40));
  git(dir, "checkout", "-q", "main");
  const squash = commit(dir, { "m.txt": lines("m", 40), ...mainExtra }, when(39));
  git(dir, "update-ref", "refs/remotes/origin/main", squash);
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return { dir, base, tip, squash };
}
const heads = (cwd) => git(cwd, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n").filter(Boolean);
const run = (dir, extra = {}) => runHygiene({
  cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mk("hy-state-"), "s.json"), now: NOW,
  fetchMerged: merged, fetchOpen: noPr, projectsDir: null, ...extra,
});

describe("residualOf", () => {
  test("measures the share of added lines present in main and classifies the rest", () => {
    const { dir, tip } = setup({ nLines: 1 });
    const ctx = { cwd: dir, baseRef: "refs/remotes/origin/main" };
    const r = residualOf(tip, ctx);
    expect(r.added).toBe(41);
    expect(r.present).toBe(40);
    expect(r.ratio).toBeGreaterThanOrEqual(RESIDUAL_REMOVABLE);
    expect(r.kind).toBe("new");
  });

  test("outdated: main changed the file the residual edits since the fork point", () => {
    const { dir, tip } = setup({ nLines: 20, mainExtra: { "n.txt": lines("other", 5) } });
    const r = residualOf(tip, { cwd: dir, baseRef: "refs/remotes/origin/main" });
    expect(r.ratio).toBeLessThan(RESIDUAL_REMOVABLE);
    expect(r.kind).toBe("outdated");
    expect(r.outdatedFiles).toEqual(["n.txt"]);
  });
});

describe("residualOf — hardening", () => {
  const baseRef = "refs/remotes/origin/main";

  test("added lines that start with ++ count (only the hunks are parsed)", () => {
    const dir = mk("hy-pp-");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    commit(dir, { "a.txt": "a\n" }, when(60));
    git(dir, "checkout", "-q", "-b", "feat");
    const tip = commit(dir, { "c.txt": "++counter total\n++counter other\n" }, when(40));
    git(dir, "checkout", "-q", "main");
    git(dir, "update-ref", baseRef, git(dir, "rev-parse", "main"));
    const r = residualOf(tip, { cwd: dir, baseRef });
    expect(r.added).toBe(2);
    expect(r.present).toBe(0);
  });

  test("trivial lines are ignored; a branch of only trivial lines is not 100 %", () => {
    const { dir, base } = setup({ nLines: 1 });
    git(dir, "checkout", "-q", "-b", "trivial", base);
    const tip = commit(dir, { "t.txt": "}\n});\nreturn;\nelse {\n" }, when(40));
    git(dir, "checkout", "-q", "main");
    const r = residualOf(tip, { cwd: dir, baseRef });
    expect(r.added).toBe(0);
    expect(r.ratio).toBe(0);
  });

  test("deleting what main still has vetoes the auto-delete even at 100 % of the added lines", () => {
    const dir = mk("hy-veto-");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    const keep = lines("keep", 30);
    const base = commit(dir, { "k.txt": keep, "big.txt": lines("big", 50) }, when(60));
    git(dir, "checkout", "-q", "-b", "feat");
    fs.rmSync(path.join(dir, "big.txt"));
    const tip = commit(dir, { "k.txt": keep + "brand new line\n" }, when(40));
    git(dir, "checkout", "-q", "main");
    commit(dir, { "k.txt": keep + "brand new line\n" }, when(39));
    git(dir, "update-ref", baseRef, git(dir, "rev-parse", "main"));
    expect(base).toBeTruthy();
    const r = residualOf(tip, { cwd: dir, baseRef });
    expect(r.ratio).toBe(1);
    expect(r.vetoed).toBe(true);
    const unit = { head: tip, branch: "feat" };
    const ctx = { cwd: dir, baseRef, merged: null, open: { names: new Set(), shas: new Set() } };
    expect(landingState(tip, "feat", ctx).state).toBe("partial");
    expect(residualOf(unit.head, ctx).vetoed).toBe(true);
  });
});

describe("partial branches in the auto-clean", () => {
  test("a veto keeps a 100 % branch and lists it", () => {
    const { dir } = setup({ nLines: 1 });
    // the branch also deleted a.txt, which main still has
    git(dir, "checkout", "-q", "feat");
    fs.rmSync(path.join(dir, "a.txt"));
    git(dir, "add", "-A");
    execFileSync("git", ["commit", "-q", "-m", "rm"], { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: when(40), GIT_COMMITTER_DATE: when(40) } });
    git(dir, "checkout", "-q", "main");
    run(dir);
    expect(heads(dir)).toContain("feat");
  });

  test("a tag that does not hold the tip keeps the branch", () => {
    const { dir, base } = setup({ nLines: 1 });
    const day = new Date(NOW).toISOString().slice(0, 10);
    // a pre-existing tag of the same name on another commit is suffixed, so force a mismatch via the suffixed name
    git(dir, "tag", `archive/${day}/feat`, base);
    const tip = git(dir, "rev-parse", "feat");
    git(dir, "tag", `archive/${day}/feat-${tip.slice(0, 7)}`, base);
    const res = run(dir);
    expect(heads(dir)).toContain("feat");
    expect(res.autoClean.skipped.map((s) => s.reason)).toContain("archive-tag-failed");
  });

  test(">= 95 % in main: tagged archive/<date>/<branch> at the tip, then deleted", () => {
    const { dir, tip } = setup({ nLines: 1 });
    const res = run(dir);
    expect(heads(dir)).toEqual(["main"]);
    const day = new Date(NOW).toISOString().slice(0, 10);
    expect(git(dir, "rev-parse", `refs/tags/archive/${day}/feat`)).toBe(tip);
    expect(res.autoClean.removed.find((r) => r.kind === "branch").archived).toBe(`archive/${day}/feat`);
    expect(res.card.tests.result).toContain("archive/");
  });

  test("a pushed branch gets its archive tag pushed too", () => {
    const { dir, tip } = setup({ nLines: 1 });
    const bare = mk("hy-origin-");
    git(bare, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-q", "origin", "feat");
    git(dir, "fetch", "-q", "origin");
    run(dir);
    const day = new Date(NOW).toISOString().slice(0, 10);
    expect(git(bare, "rev-parse", `refs/tags/archive/${day}/feat`)).toBe(tip);
    expect(heads(dir)).toEqual(["main"]);
  });

  test("a failing tag keeps the branch", () => {
    const { dir } = setup({ nLines: 1 });
    // a tag file in the way of archive/<date>/ makes `git tag` fail
    const day = new Date(NOW).toISOString().slice(0, 10);
    git(dir, "tag", `archive/${day}`);
    const res = run(dir);
    expect(heads(dir)).toContain("feat");
    expect(res.autoClean.skipped.map((s) => s.reason)).toContain("archive-tag-failed");
  });

  test("with an open PR it stays", () => {
    const { dir } = setup({ nLines: 1 });
    run(dir, { fetchOpen: () => ({ names: new Set(["feat"]), shas: new Set() }) });
    expect(heads(dir)).toContain("feat");
  });

  test("gh unknown (open PRs null): it stays", () => {
    const { dir } = setup({ nLines: 1 });
    run(dir, { fetchOpen: () => null });
    expect(heads(dir)).toContain("feat");
  });

  test("below 95 %, unique work: never deleted, listed as a decision item", () => {
    const { dir } = setup({ nLines: 20 });
    const res = run(dir);
    expect(heads(dir)).toContain("feat");
    const item = res.atRisk.find((x) => x.branch === "feat");
    expect(item.residual.kind).toBe("new");
    expect(res.card.openItems.some((i) => i.text.includes("feat") && i.text.includes("eigenständige neue Arbeit"))).toBe(true);
  });

  test("below 95 %, main moved on: classified outdated, still never deleted", () => {
    const { dir } = setup({ nLines: 20, mainExtra: { "n.txt": lines("other", 5) } });
    const res = run(dir);
    expect(heads(dir)).toContain("feat");
    expect(res.atRisk.find((x) => x.branch === "feat").residual.kind).toBe("outdated");
    const en = cardLines(res, "en");
    expect(en.openItems[0].text).toContain("outdated");
    expect(en.openItems[0].reply).toContain("only after my confirmation");
  });
});
