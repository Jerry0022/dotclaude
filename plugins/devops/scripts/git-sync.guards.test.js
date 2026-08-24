import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  git,
  runSync,
  write,
  read,
  commitAll,
  makeRoot,
  makeWorld,
  advanceOrigin,
  cleanupWorlds,
} from "./__fixtures__/git-sync-world.js";

/**
 * The preconditions git-sync refuses to run without. Every one of these became
 * load-bearing the moment the sync stopped being a silent no-op: a merge that
 * actually happens can damage a repo that is mid-operation, on a detached
 * HEAD, or governed by commit hooks a detached child cannot answer.
 */

afterAll(cleanupWorlds);

describe.concurrent("refuses to run unless the repo is quiescent", () => {
  test("does nothing on a detached HEAD", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    // The state every worktree here sits in between tasks.
    git(wt, ["checkout", "--quiet", "--detach", "HEAD"]);
    const head = git(wt, ["rev-parse", "HEAD"]);

    const resultFile = path.join(root, "result");
    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // No commit written that nothing points at, no working tree rewritten.
    expect(git(wt, ["rev-parse", "HEAD"])).toBe(head);
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(false);
  });

  test("does nothing while a merge is unfinished", () => {
    const { root, wt, other } = makeWorld();

    // Park the worktree in a conflicted merge, the way a /ship rebase would.
    git(wt, ["checkout", "--quiet", "-b", "side"]);
    write(wt, "base.txt", "side\n");
    commitAll(wt, "side edits base.txt");
    git(wt, ["checkout", "--quiet", "feature"]);
    write(wt, "base.txt", "feature\n");
    commitAll(wt, "feature edits base.txt");
    try {
      git(wt, ["merge", "side", "--no-edit"]);
    } catch { /* conflict is the point */ }
    expect(git(wt, ["rev-parse", "--verify", "MERGE_HEAD"])).toBeTruthy();

    advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const before = git(wt, ["rev-parse", "HEAD"]);

    const resultFile = path.join(root, "result");
    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // The user's conflict is left exactly as it was — not resolved, not committed.
    expect(git(wt, ["rev-parse", "HEAD"])).toBe(before);
    expect(git(wt, ["rev-parse", "--verify", "MERGE_HEAD"])).toBeTruthy();
    expect(read(wt, "base.txt")).toContain("<<<<<<<");
  });
});

describe.concurrent("repo hooks and unmarked conflicts", () => {
  test("a rejecting commit-msg hook does not turn every sync into a failure", () => {
    const { root, wt, other } = makeWorld();
    // A commitlint-style gate: git's own "Merge remote-tracking branch …"
    // subject does not match a conventional-commit pattern, so without
    // --no-verify this hook rejects every single background merge.
    const hookDir = path.join(wt, ".git-hooks");
    fs.mkdirSync(hookDir);
    fs.writeFileSync(
      path.join(hookDir, "commit-msg"),
      "#!/bin/sh\ngrep -qE '^(feat|fix|chore)' \"$1\" || { echo 'commit-msg: rejected'; exit 1; }\n",
      { mode: 0o755 }
    );
    git(wt, ["config", "core.hooksPath", hookDir]);
    advanceOrigin(other, "a.txt", "a\n", "one");
    advanceOrigin(other, "b.txt", "b\n", "two");
    // Two diverging commits so the merge needs a real merge commit, not a
    // fast-forward — a fast-forward writes no message and would prove nothing.
    write(wt, "own.txt", "own\n");
    commitAll(wt, "feat: own work");

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → feature: 2 commit(s)");
    expect(report).not.toContain("✗");
    expect(git(wt, ["rev-list", "--count", "HEAD..origin/main"])).toBe("0");
  });

  test("does nothing while a conflicted stash pop is unresolved", () => {
    const { root, wt, other } = makeWorld();
    // A conflicted `git stash pop` leaves unmerged index entries but NO
    // MERGE_HEAD — invisible to a marker-file check, which is why the gate
    // asks the index directly.
    write(wt, "base.txt", "stashed edit\n");
    git(wt, ["stash", "push", "--quiet"]);
    write(wt, "base.txt", "committed edit\n");
    commitAll(wt, "feature edits base.txt");
    try {
      git(wt, ["stash", "pop"]);
    } catch { /* the conflict is the point */ }
    expect(git(wt, ["ls-files", "--unmerged"])).not.toBe("");
    // No marker file anywhere — a linked worktree keeps its git dir elsewhere,
    // so ask git for the path rather than guessing at <wt>/.git.
    expect(fs.existsSync(git(wt, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]))).toBe(false);

    advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const before = git(wt, ["rev-parse", "HEAD"]);

    const resultFile = path.join(root, "result");
    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // Nothing committed, and the user's half-resolved state left alone.
    expect(git(wt, ["rev-parse", "HEAD"])).toBe(before);
    expect(git(wt, ["ls-files", "--unmerged"])).not.toBe("");
  });

  test("resumes as soon as the blocking state is cleared", () => {
    const { root, wt, other } = makeWorld();
    write(wt, "base.txt", "stashed edit\n");
    git(wt, ["stash", "push", "--quiet"]);
    write(wt, "base.txt", "committed edit\n");
    commitAll(wt, "feature edits base.txt");
    try {
      git(wt, ["stash", "pop"]);
    } catch { /* the conflict is the point */ }
    advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    // Positive control: the silence above must come from the gate, not from
    // the world being unable to produce a sync at all.
    expect(runSync(wt, path.join(root, "result"))).toBe("");

    git(wt, ["checkout", "--theirs", "--", "base.txt"]);
    git(wt, ["add", "--", "base.txt"]);
    git(wt, ["stash", "drop", "--quiet"]);
    commitAll(wt, "resolve the stash pop");

    const report = runSync(wt, path.join(root, "result2"));
    expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
  });
});

describe.concurrent("default branch", () => {
  test("syncs a repo whose default branch is master", () => {
    // Built by hand rather than via makeWorld — the point is the branch name.
    const root = makeRoot();
    const originPath = path.join(root, "origin.git");
    git(root, ["init", "--bare", "--initial-branch=master", originPath]);

    const primary = path.join(root, "primary");
    git(root, ["clone", "--quiet", originPath, primary]);
    write(primary, "base.txt", "base\n");
    commitAll(primary, "base");
    git(primary, ["push", "--quiet", "origin", "master"]);

    const wt = path.join(root, "wt");
    git(primary, ["worktree", "add", "--quiet", "-b", "feature", wt, "master"]);

    const other = path.join(root, "other");
    git(root, ["clone", "--quiet", originPath, other]);
    write(other, "from-master.txt", "master\n");
    commitAll(other, "master moves");
    git(other, ["push", "--quiet", "origin", "master"]);

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/master → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "from-master.txt"))).toBe(true);
  });

  test("survives an origin/HEAD pointing at a branch that no longer exists", () => {
    const { root, wt, other } = makeWorld();
    // A clone-time symlink left behind by a renamed default branch.
    git(wt, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    const report = runSync(wt, path.join(root, "result"));

    // Falls through to the real default branch instead of syncing nothing.
    expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(true);
  });
});
