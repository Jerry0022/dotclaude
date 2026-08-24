import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  git,
  runSync,
  write,
  read,
  commitAll,
  makeWorld,
  advanceOrigin,
  cleanupWorlds,
} from "./__fixtures__/git-sync-world.js";

/**
 * The core contract: git-sync must actually move commits from the default
 * branch into the current one, in the worktree layout where v0.3.x could not
 * — and never at the cost of uncommitted work.
 */

afterAll(cleanupWorlds);

describe.concurrent("merge source — the regression that made the sync a silent no-op", () => {
  test("merges origin/main even though main is checked out in the primary worktree", () => {
    const { root, primary, wt, other } = makeWorld();
    advanceOrigin(other, "feature-of-main.txt", "from main\n", "main moves on");

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "feature-of-main.txt"))).toBe(true);

    // The precondition that used to defeat the sync is still in force: the
    // local main ref could NOT be advanced, because primary has it checked out.
    expect(git(primary, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(git(wt, ["rev-parse", "main"])).not.toBe(git(wt, ["rev-parse", "origin/main"]));
  });

  test("the local main ref being stale does not suppress the merge", () => {
    const { root, wt, other } = makeWorld();
    const staleMain = git(wt, ["rev-parse", "main"]);
    advanceOrigin(other, "a.txt", "a\n", "one");
    advanceOrigin(other, "b.txt", "b\n", "two");

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → feature: 2 commit(s)");
    expect(git(wt, ["rev-parse", "main"])).toBe(staleMain);
    expect(git(wt, ["rev-list", "--count", "HEAD..origin/main"])).toBe("0");
  });

  test("stays silent and writes no result file when already up to date", () => {
    const { root, wt } = makeWorld();
    const resultFile = path.join(root, "result");

    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
  });

  test("does nothing on main itself", () => {
    const { root, primary, wt, other } = makeWorld();
    advanceOrigin(other, "x.txt", "x\n", "main moves on");
    void wt;

    const resultFile = path.join(root, "result");
    expect(runSync(primary, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
  });
});

describe.concurrent("uncommitted work", () => {
  test("skips silently while a dirty file overlaps the incoming change", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "base.txt", "base, edited on main\n", "main edits base.txt");

    write(wt, "base.txt", "base, edited in the worktree\n");
    const resultFile = path.join(root, "result");

    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // The user's work in progress is untouched and still uncommitted.
    expect(read(wt, "base.txt")).toBe("base, edited in the worktree\n");
    expect(git(wt, ["status", "--porcelain"])).toContain("base.txt");
  });

  test("merges anyway when the dirty file is not part of the incoming change", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "elsewhere.txt", "elsewhere\n", "main touches another file");

    write(wt, "untouched.txt", "work in progress\n");

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "elsewhere.txt"))).toBe(true);
    expect(read(wt, "untouched.txt")).toBe("work in progress\n");
  });

  test("picks the commits up on the next run once the work is committed", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "base.txt", "base, edited on main\n", "main edits base.txt");

    write(wt, "base.txt", "base, edited in the worktree\n");
    expect(runSync(wt, path.join(root, "result"))).toBe("");

    commitAll(wt, "worktree edits base.txt");

    // Now genuinely conflicting: both sides changed the same line.
    const report = runSync(wt, path.join(root, "result2"));
    expect(report).toContain("⚠ origin/main → feature");
    expect(report).toContain("base.txt");
    expect(report).not.toContain("0 file(s)");
  });
});
