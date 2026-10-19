import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { classify, isParked, listParked, listStashes, STALE_DAYS } from "./park-register.js";

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
});
