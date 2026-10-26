import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { landingState, runHygiene as runHygieneAsync } from "./hygiene.js";
const runHygiene = (p) => runHygieneAsync({ sync: true, ...p });

const tmp = [];
afterEach(() => {
  while (tmp.length) {
    try { fs.rmSync(tmp.pop(), { recursive: true, force: true }); } catch { /* temp dir */ }
  }
});
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

/** main with a.txt; origin/main = main; no network. */
function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hy-landing-")));
  tmp.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "0\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "c0");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return dir;
}
function write(dir, files, msg) {
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
  return git(dir, "rev-parse", "HEAD");
}
/** A branch with `files` committed; back on main. */
function feature(dir, name, files) {
  git(dir, "checkout", "-q", "-b", name, "main");
  const sha = write(dir, files, name);
  git(dir, "checkout", "-q", "main");
  return sha;
}
/** main advances (origin/main follows), as a squash merge would. */
function advance(dir, files) {
  write(dir, files, "main moves");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
}
const ctxOf = (dir) => ({ cwd: dir, baseRef: "refs/remotes/origin/main", merged: null, viaMerged: new Set() });

describe("landingState", () => {
  test("ancestor of main → landed", () => {
    const dir = repo();
    expect(landingState(git(dir, "rev-parse", "HEAD"), null, ctxOf(dir))).toMatchObject({ state: "landed", via: "ancestor" });
  });

  test("squash copy of every file → landed via tree", () => {
    const dir = repo();
    const sha = feature(dir, "feat", { "f1.txt": "one\n", "f2.txt": "two\n" });
    advance(dir, { "f1.txt": "one\n", "f2.txt": "two\n" });
    expect(landingState(sha, "feat", ctxOf(dir))).toMatchObject({ state: "landed", via: "tree" });
  });

  test("a landed change edited again later in main is still landed", () => {
    const dir = repo();
    const lines = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);
    advance(dir, { "m.txt": lines.join("\n") + "\n" });
    const edited = [...lines];
    edited[1] = "L2";
    const sha = feature(dir, "feat", { "m.txt": edited.join("\n") + "\n" });
    advance(dir, { "m.txt": edited.join("\n") + "\n" });
    edited[11] = "L12";
    advance(dir, { "m.txt": edited.join("\n") + "\n" });
    expect(landingState(sha, "feat", ctxOf(dir)).state).toBe("landed");
  });

  test("some files in, some not → partial with counts", () => {
    const dir = repo();
    const sha = feature(dir, "feat", { "f1.txt": "one\n", "f2.txt": "two\n" });
    advance(dir, { "f1.txt": "one\n" });
    expect(landingState(sha, "feat", ctxOf(dir))).toMatchObject({ state: "partial", filesIn: 1, filesTotal: 2 });
  });

  test("nothing in main → unlanded", () => {
    const dir = repo();
    const sha = feature(dir, "feat", { "f9.txt": "nine\n" });
    expect(landingState(sha, "feat", ctxOf(dir))).toMatchObject({ state: "unlanded", filesIn: 0, filesTotal: 1 });
  });

  test("a partial branch survives even a wide-open auto-clean and is reported", () => {
    const dir = repo();
    feature(dir, "feat", { "f1.txt": "one\n", "f2.txt": "two\n" });
    advance(dir, { "f1.txt": "one\n" });
    const res = runHygiene({
      cwd: dir, trigger: "ship",
      settings: { autoClean: true, autoCleanGateDays: 0, autoCleanMinAgeDays: 0, nudge: false, nudgeThreshold: 50, nudgeCooldownDays: 7 },
      statePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hy-st-")), "s.json"), now: Date.now() + 100 * 86_400_000, projectsDir: null,
      fetchMerged: () => ({ bySha: new Set(), byName: new Map() }),
    });
    expect(git(dir, "branch", "--list", "feat")).toContain("feat");
    expect(res.atRisk).toEqual([expect.objectContaining({ branch: "feat", state: "partial", filesIn: 1, filesTotal: 2 })]);
    expect(res.card.risk.text).toContain("1/2 Dateien gelandet");
  });
});
