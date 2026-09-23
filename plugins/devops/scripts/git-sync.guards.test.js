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

// Sequential on purpose (#424): every test here spends 10-15 s in two real
// clones + the sync. Under describe.concurrent
// vitest starts every test's 60 s timer at once, so the LAST test of a group
// was charged the whole group's wall clock (65-75 s measured) and timed out on
// a loaded machine although each test alone takes a sixth of that.
describe("refuses to run unless the repo is quiescent", () => {
  test("does nothing on a detached HEAD", async () => {
    const { root, wt, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    // The state every worktree here sits in between tasks.
    await git(wt, ["checkout", "--quiet", "--detach", "HEAD"]);
    const head = await git(wt, ["rev-parse", "HEAD"]);

    const resultFile = path.join(root, "result");
    expect(await runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // No commit written that nothing points at, no working tree rewritten.
    expect(await git(wt, ["rev-parse", "HEAD"])).toBe(head);
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(false);
  });

  test("does nothing while a merge is unfinished", async () => {
    const { root, wt, other } = await makeWorld();

    // Park the worktree in a conflicted merge, the way a /ship rebase would.
    await git(wt, ["checkout", "--quiet", "-b", "side"]);
    write(wt, "base.txt", "side\n");
    await commitAll(wt, "side edits base.txt");
    await git(wt, ["checkout", "--quiet", "feature"]);
    write(wt, "base.txt", "feature\n");
    await commitAll(wt, "feature edits base.txt");
    try {
      await git(wt, ["merge", "side", "--no-edit"]);
    } catch { /* conflict is the point */ }
    expect(await git(wt, ["rev-parse", "--verify", "MERGE_HEAD"])).toBeTruthy();

    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const before = await git(wt, ["rev-parse", "HEAD"]);

    const resultFile = path.join(root, "result");
    expect(await runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // The user's conflict is left exactly as it was — not resolved, not committed.
    expect(await git(wt, ["rev-parse", "HEAD"])).toBe(before);
    expect(await git(wt, ["rev-parse", "--verify", "MERGE_HEAD"])).toBeTruthy();
    expect(read(wt, "base.txt")).toContain("<<<<<<<");
  });
});

describe("repo hooks and unmarked conflicts", () => {
  test("a rejecting commit-msg hook does not turn every sync into a failure", async () => {
    const { root, wt, other } = await makeWorld();
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
    await git(wt, ["config", "core.hooksPath", hookDir]);
    await advanceOrigin(other, "a.txt", "a\n", "one");
    await advanceOrigin(other, "b.txt", "b\n", "two");
    // Two diverging commits so the merge needs a real merge commit, not a
    // fast-forward — a fast-forward writes no message and would prove nothing.
    write(wt, "own.txt", "own\n");
    await commitAll(wt, "feat: own work");

    const report = await runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → feature: 2 commit(s)");
    expect(report).not.toContain("✗");
    expect(await git(wt, ["rev-list", "--count", "HEAD..origin/main"])).toBe("0");
  });

  test("does nothing while a conflicted stash pop is unresolved", async () => {
    const { root, wt, other } = await makeWorld();
    // A conflicted `git stash pop` leaves unmerged index entries but NO
    // MERGE_HEAD — invisible to a marker-file check, which is why the gate
    // asks the index directly.
    write(wt, "base.txt", "stashed edit\n");
    await git(wt, ["stash", "push", "--quiet"]);
    write(wt, "base.txt", "committed edit\n");
    await commitAll(wt, "feature edits base.txt");
    try {
      await git(wt, ["stash", "pop"]);
    } catch { /* the conflict is the point */ }
    expect(await git(wt, ["ls-files", "--unmerged"])).not.toBe("");
    // No marker file anywhere — a linked worktree keeps its git dir elsewhere,
    // so ask git for the path rather than guessing at <wt>/.git.
    expect(fs.existsSync(await git(wt, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]))).toBe(false);

    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const before = await git(wt, ["rev-parse", "HEAD"]);

    const resultFile = path.join(root, "result");
    expect(await runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    // Nothing committed, and the user's half-resolved state left alone.
    expect(await git(wt, ["rev-parse", "HEAD"])).toBe(before);
    expect(await git(wt, ["ls-files", "--unmerged"])).not.toBe("");
  });

  test("resumes as soon as the blocking state is cleared", async () => {
    const { root, wt, other } = await makeWorld();
    write(wt, "base.txt", "stashed edit\n");
    await git(wt, ["stash", "push", "--quiet"]);
    write(wt, "base.txt", "committed edit\n");
    await commitAll(wt, "feature edits base.txt");
    try {
      await git(wt, ["stash", "pop"]);
    } catch { /* the conflict is the point */ }
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    // Positive control: the silence above must come from the gate, not from
    // the world being unable to produce a sync at all.
    expect(await runSync(wt, path.join(root, "result"))).toBe("");

    await git(wt, ["checkout", "--theirs", "--", "base.txt"]);
    await git(wt, ["add", "--", "base.txt"]);
    await git(wt, ["stash", "drop", "--quiet"]);
    await commitAll(wt, "resolve the stash pop");

    const report = await runSync(wt, path.join(root, "result2"));
    expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
  });
});

describe("default branch", () => {
  test("syncs a repo whose default branch is master", async () => {
    // Built by hand rather than via makeWorld — the point is the branch name.
    const root = makeRoot();
    const originPath = path.join(root, "origin.git");
    await git(root, ["init", "--bare", "--initial-branch=master", originPath]);

    const primary = path.join(root, "primary");
    await git(root, ["clone", "--quiet", originPath, primary]);
    write(primary, "base.txt", "base\n");
    await commitAll(primary, "base");
    await git(primary, ["push", "--quiet", "origin", "master"]);

    const wt = path.join(root, "wt");
    await git(primary, ["worktree", "add", "--quiet", "-b", "feature", wt, "master"]);

    const other = path.join(root, "other");
    await git(root, ["clone", "--quiet", originPath, other]);
    write(other, "from-master.txt", "master\n");
    await commitAll(other, "master moves");
    await git(other, ["push", "--quiet", "origin", "master"]);

    const report = await runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/master → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "from-master.txt"))).toBe(true);
  });

  test("survives an origin/HEAD pointing at a branch that no longer exists", async () => {
    const { root, wt, other } = await makeWorld();
    // A clone-time symlink left behind by a renamed default branch.
    await git(wt, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    const report = await runSync(wt, path.join(root, "result"));

    // Falls through to the real default branch instead of syncing nothing.
    expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(true);
  });
});
