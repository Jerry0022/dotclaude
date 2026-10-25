import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { coveringRef, classify, isParked, isUndecided, listParked, listStashes, STALE_DAYS } from "./park-register.js";

const DAY = 86_400_000;
const dirs = [];
afterEach(() => {
  while (dirs.length) try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* temp */ }
});
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "park-")));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "0\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "c0");
  return dir;
}
function branchAt(dir, name, subject, daysAgo) {
  git(dir, "checkout", "-q", "-b", name, "main");
  fs.writeFileSync(path.join(dir, `${name.replace(/\//g, "_")}.txt`), "x\n");
  git(dir, "add", "-A");
  const when = new Date(Date.now() - daysAgo * DAY).toISOString();
  execFileSync("git", ["commit", "-q", "-m", subject], { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  git(dir, "checkout", "-q", "main");
}

describe("park-register classify", () => {
  test("canonical prefix, legacy aliases and ARCHIVED tip are parked; ordinary branches are not", () => {
    expect(classify("parked/idea")).toMatchObject({ parked: true, legacy: false, topic: "idea" });
    for (const n of ["wip/a", "backup/b", "salvage/c"]) expect(classify(n)).toMatchObject({ parked: true, legacy: true });
    expect(isParked("misc", "ARCHIVED: dead end")).toBe(true);
    expect(isParked("feat/x", "add x")).toBe(false);
    expect(isParked("wipe", "")).toBe(false);
  });
});

describe("park-register listParked / listStashes", () => {
  test("derived from refs, with age, reason and a stale flag after 30 days", () => {
    const dir = repo();
    branchAt(dir, "parked/fresh", "idea one", 2);
    branchAt(dir, "wip/old", "half done", STALE_DAYS + 5);
    branchAt(dir, "feat/normal", "regular work", 1);
    const list = listParked(dir);
    expect(list.map((p) => p.branch)).toEqual(["parked/fresh", "wip/old"]);
    expect(list[0]).toMatchObject({ legacy: false, stale: false, reason: "idea one" });
    expect(list[1]).toMatchObject({ legacy: true, stale: true, ageDays: STALE_DAYS + 5 });
  });

  test("remote-only origin/salvage|parked refs are listed; a local twin is listed once; coveringRef sees remote refs", () => {
    const dir = repo();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "park-bare-"));
    dirs.push(bare);
    git(bare, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", bare);
    branchAt(dir, "feat/a", "work a", 3);
    branchAt(dir, "parked/b", "work b", 3);
    git(dir, "push", "-q", "origin", "feat/a:refs/heads/salvage/a", "parked/b:refs/heads/parked/b", "feat/a:refs/heads/feat/a");
    const list = listParked(dir);
    expect(list.map((p) => p.branch).sort()).toEqual(["origin/salvage/a", "parked/b"]);
    expect(list.find((p) => p.branch === "origin/salvage/a")).toMatchObject({ remote: true, legacy: true });
    const sha = git(dir, "rev-parse", "feat/a");
    expect(coveringRef(dir, sha)).toBe("origin/salvage/a");
    expect(coveringRef(dir, git(dir, "rev-parse", "main"))).not.toBeNull(); // ancestor of the salvage tip
    expect(coveringRef(dir, sha, { exact: true })).toBe("origin/salvage/a");
  });

  test("stashes are listed", () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    git(dir, "stash", "push", "-q", "-m", "park-test");
    expect(listStashes(dir)).toEqual([expect.objectContaining({ ref: "stash@{0}", message: expect.stringContaining("park-test") })]);
  });

  test("a non-repo yields nothing", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "park-none-"));
    dirs.push(d);
    expect(listParked(d)).toEqual([]);
    expect(listStashes(d)).toEqual([]);
  });

  test("rescue/ and salvage-land/ copies count as (legacy) parked", () => {
    expect(classify("rescue/2026-10-19/wt-x")).toMatchObject({ parked: true, legacy: true });
    expect(classify("salvage-land/dev-config")).toMatchObject({ parked: true, legacy: true });
  });

  test("isUndecided: autosave, legacy copies, covered work and stale parks wait for a decision; a fresh deliberate park does not", () => {
    expect(isUndecided({ branch: "parked/autosave/s1" })).toBe(true);
    expect(isUndecided({ branch: "origin/parked/autosave/s1" })).toBe(true);
    expect(isUndecided({ branch: "origin/rescue/x", legacy: true })).toBe(true);
    expect(isUndecided({ branch: "feat/x", coveredBy: "origin/salvage/x" })).toBe(true);
    expect(isUndecided({ branch: "parked/idea", nudge: "behalten, integrieren oder verwerfen" })).toBe(true);
    expect(isUndecided({ branch: "parked/idea", legacy: false })).toBe(false);
    // an ARCHIVED tip is a decision — until it goes stale like any park
    expect(isUndecided({ branch: "feat/old", legacy: true, reason: "chore(branch): ARCHIVED — salvage source only" })).toBe(false);
    expect(isUndecided({ branch: "feat/old", legacy: true, reason: "ARCHIVED", nudge: "behalten, integrieren oder verwerfen" })).toBe(true);
  });
});
