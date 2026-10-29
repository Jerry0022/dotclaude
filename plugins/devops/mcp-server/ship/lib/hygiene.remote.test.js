import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runHygiene as runHygieneAsync, planAutoClean, executeAutoClean, scanRepo, REMOTE_STALE_DAYS } from "./hygiene.js";

/**
 * #954: remote branches of merged PRs are deleted (lease-guarded); remote-only
 * branches without any PR that went quiet are only listed.
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

const tmp = [];
const mk = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); tmp.push(d); return d; };
afterEach(() => { while (tmp.length) try { fs.rmSync(tmp.pop(), { recursive: true, force: true }); } catch { /* temp */ } });

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
function commit(cwd, file, content, date) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", "c"], { cwd, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return git(cwd, "rev-parse", "HEAD");
}

/** A clone with origin; each `{name, ageDays}` is pushed and its local branch deleted (remote-only). */
function setup(remoteBranches) {
  const dir = mk("hy-rem-");
  const bare = mk("hy-rem-origin-");
  git(bare, "init", "-q", "--bare");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  commit(dir, "a.txt", "a\n", when(60));
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");
  const tips = {};
  for (const { name, ageDays } of remoteBranches) {
    git(dir, "checkout", "-q", "-b", name, "main");
    tips[name] = commit(dir, `${name.replace(/\W/g, "_")}.txt`, `${name}\n`, when(ageDays));
    git(dir, "push", "-q", "origin", name);
    git(dir, "checkout", "-q", "main");
    git(dir, "branch", "-q", "-D", name);
  }
  git(dir, "fetch", "-q", "origin");
  git(dir, "remote", "set-head", "origin", "main");
  return { dir, bare, tips };
}
const remoteHeads = (bare) => git(bare, "for-each-ref", "refs/heads", "--format=%(refname:short)").split("\n").sort();
const mergedOf = (tips, names, any = names) => () => ({
  bySha: new Set(names.map((n) => tips[n])),
  byName: new Map(names.map((n) => [n, [tips[n]]])),
  anyNames: new Set(any),
});
const run = (dir, extra = {}) => runHygiene({
  cwd: dir, trigger: "ship", settings: SETTINGS, statePath: path.join(mk("hy-state-"), "s.json"), now: NOW,
  fetchOpen: noPr, projectsDir: null, ...extra,
});

describe("remote branches of merged PRs", () => {
  test("deleted when the tip is a merged PR's head; the default branch and an unrelated branch stay", () => {
    const { dir, bare, tips } = setup([{ name: "pr-done", ageDays: 5 }, { name: "pr-other", ageDays: 5 }]);
    const res = run(dir, { fetchMerged: mergedOf(tips, ["pr-done"], ["pr-done", "pr-other"]) });
    expect(remoteHeads(bare)).toEqual(["main", "pr-other"]);
    const r = res.autoClean.removed.find((x) => x.kind === "remote");
    expect(r).toMatchObject({ name: "pr-done", sha: tips["pr-done"], trigger: "merged-pr" });
    expect(res.card.tests.result).toContain("1 Remote-Branch");
  });

  test("an open PR on the branch keeps it", () => {
    const { dir, bare, tips } = setup([{ name: "pr-open", ageDays: 5 }]);
    run(dir, { fetchMerged: mergedOf(tips, ["pr-open"]), fetchOpen: () => ({ names: new Set(["pr-open"]), shas: new Set() }) });
    expect(remoteHeads(bare)).toContain("pr-open");
  });

  test("gh offline (merged === null) or an unknown open-PR list: nothing is deleted", () => {
    const { dir, bare, tips } = setup([{ name: "pr-done", ageDays: 5 }]);
    run(dir, { fetchMerged: () => null });
    run(dir, { fetchMerged: mergedOf(tips, ["pr-done"]), fetchOpen: () => null });
    expect(remoteHeads(bare)).toContain("pr-done");
  });

  test("a branch pushed past the merged head stays", () => {
    const { dir, bare, tips } = setup([{ name: "pr-more", ageDays: 5 }]);
    const merged = () => ({ bySha: new Set(["0".repeat(40)]), byName: new Map([["pr-more", ["0".repeat(40)]]]), anyNames: new Set(["pr-more"]) });
    run(dir, { fetchMerged: merged });
    expect(remoteHeads(bare)).toContain("pr-more");
    expect(tips["pr-more"]).toBeTruthy();
  });

  test("trigger promote never deletes", () => {
    const { dir, bare, tips } = setup([{ name: "pr-done", ageDays: 5 }]);
    run(dir, { trigger: "promote", fetchMerged: mergedOf(tips, ["pr-done"]) });
    expect(remoteHeads(bare)).toContain("pr-done");
  });

  test("the lease fails the delete when someone pushed meanwhile", () => {
    const { dir, bare, tips } = setup([{ name: "pr-race", ageDays: 5 }]);
    const scan = scanRepo(dir, NOW);
    const plan = planAutoClean(scan, SETTINGS, { cwd: dir, fetchMerged: mergedOf(tips, ["pr-race"]), fetchOpen: noPr, projectsDir: null, now: NOW });
    expect(plan.remoteMerged.map((r) => r.name)).toEqual(["pr-race"]);
    const other = mk("hy-rem-other-");
    git(other, "clone", "-q", bare, ".");
    git(other, "config", "user.email", "t@example.com");
    git(other, "config", "user.name", "t");
    git(other, "checkout", "-q", "pr-race");
    commit(other, "late.txt", "late\n", when(0));
    git(other, "push", "-q", "origin", "pr-race");
    const done = executeAutoClean(plan, scan, { cwd: dir, remotes: true, projectsDir: null });
    expect(done.skipped).toEqual([{ kind: "remote", name: "pr-race", reason: "remote-delete-failed" }]);
    expect(remoteHeads(bare)).toContain("pr-race");
  });
});

describe("stale remote-only branches", () => {
  test("listed on the card, never deleted; young ones and ones with a PR are not listed", () => {
    const { dir, bare, tips } = setup([
      { name: "old-rethink", ageDays: REMOTE_STALE_DAYS + 6 },
      { name: "young-one", ageDays: 3 },
      { name: "old-with-pr", ageDays: 40 },
    ]);
    const res = run(dir, { fetchMerged: mergedOf(tips, [], ["old-with-pr"]) });
    expect(res.remoteStale.map((x) => x.name)).toEqual(["old-rethink"]);
    expect(remoteHeads(bare)).toEqual(["main", "old-rethink", "old-with-pr", "young-one"]);
    expect(res.card.openItems.some((i) => i.text.includes("old-rethink"))).toBe(true);
  });

  test("a local branch of the same name or an unknown PR list keeps it off the list", () => {
    const { dir, tips } = setup([{ name: "old-one", ageDays: 30 }]);
    const unknownList = () => ({ bySha: new Set(), byName: new Map(), anyNames: null });
    expect(run(dir, { fetchMerged: unknownList }).remoteStale).toEqual([]);
    git(dir, "branch", "-q", "old-one", tips["old-one"]);
    expect(run(dir, { fetchMerged: mergedOf(tips, []) }).remoteStale).toEqual([]);
  });

  test("the threshold is the remoteStaleDays setting", () => {
    const { dir, tips } = setup([{ name: "mid", ageDays: 10 }]);
    const res = run(dir, { fetchMerged: mergedOf(tips, []), settings: { ...SETTINGS, remoteStaleDays: 7 } });
    expect(res.remoteStale.map((x) => x.name)).toEqual(["mid"]);
  });
});
