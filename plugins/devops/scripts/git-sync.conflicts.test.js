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
 * What git-sync reports when the merge is not clean, and how it walks a
 * branch's parent chain. The reporting shape matters as much as the merge:
 * only a ⚠ carries the resolution procedure to the assistant, while a ✗ is
 * classified as an error and stops there.
 */

afterAll(cleanupWorlds);

describe.concurrent("conflict reporting", () => {
  test("auto-resolves a whitespace-only conflict instead of asking for help", () => {
    const { root, wt, other } = makeWorld();
    // Same line touched on both sides, but the worktree only re-indented it —
    // that is the "one side is whitespace-identical to base" trivial case.
    advanceOrigin(other, "base.txt", "BASE\n", "main rewrites the line");

    write(wt, "base.txt", "  base\n");
    commitAll(wt, "worktree only re-indents the line");

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → feature");
    expect(report).toContain("auto-resolved");
    expect(report).not.toContain("⚠");
    // main's content won, and the merge is committed — no markers left behind.
    expect(read(wt, "base.txt")).toContain("BASE");
    expect(git(wt, ["status", "--porcelain"])).toBe("");
  });

  test("rolls the merge back when the auto-resolved commit cannot be made", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "base.txt", "BASE\n", "main rewrites the line");

    write(wt, "base.txt", "  base\n");
    commitAll(wt, "worktree only re-indents the line");

    // Same whitespace conflict as above, but the commit at the end of the
    // auto-resolve path cannot be made: signing is demanded and the signing
    // program does not exist. Pure git, no mocks, and it fails at exactly the
    // right moment — a conflicting merge creates no commit, so it proceeds and
    // resolves normally, and only `git commit` hits the missing signer.
    // (Withholding the committer identity instead fails the merge itself, too
    // early to exercise this path at all.)
    const report = runSync(wt, path.join(root, "result"), {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "true",
      GIT_CONFIG_KEY_1: "gpg.program",
      GIT_CONFIG_VALUE_1: path.join(root, "no-such-gpg"),
    });

    expect(report).toContain("✗ origin/main → feature");
    expect(report).toContain("the merge was rolled back");
    // The point of the rollback: no MERGE_HEAD survives, so the quiescence
    // gate does not read this worktree as busy and mute every future sync.
    expect(fs.existsSync(git(wt, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]))).toBe(false);
    expect(git(wt, ["status", "--porcelain"])).toBe("");
    expect(read(wt, "base.txt")).toBe("  base\n");
  });

  test("an ambiguous conflict is reported with its file list and aborted cleanly", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "base.txt", "written by main\n", "main rewrites base.txt");

    write(wt, "base.txt", "written by the feature branch\n");
    commitAll(wt, "feature rewrites base.txt");

    const report = runSync(wt, path.join(root, "result"));

    expect(report).toContain("⚠ origin/main → feature: 1 file(s) with ambiguous conflicts");
    expect(report).toContain("base.txt");
    // Aborted cleanly: no merge in progress, no conflict markers left behind.
    expect(git(wt, ["status", "--porcelain"])).toBe("");
    expect(read(wt, "base.txt")).toBe("written by the feature branch\n");
  });

  test("an ambiguous conflict survives unrelated dirt in the worktree", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "base.txt", "written by main\n", "main rewrites base.txt");

    write(wt, "base.txt", "written by the feature branch\n");
    commitAll(wt, "feature rewrites base.txt");
    // Scratch files sitting around are the normal state of a working session.
    write(wt, "scratch.log", "debug output\n");
    write(wt, "untouched.txt", "unrelated work in progress\n");

    const report = runSync(wt, path.join(root, "result"));

    // The ⚠ must NOT be downgraded to ✗: only ⚠ carries the resolution
    // procedure to the assistant, and ✗ is classified as an error instead.
    expect(report).toContain("⚠ origin/main → feature: 1 file(s) with ambiguous conflicts");
    expect(report).not.toContain("✗");
    expect(read(wt, "scratch.log")).toBe("debug output\n");
  });

  test("stays silent when the merge would overwrite an untracked file", () => {
    const { root, wt, other } = makeWorld();
    advanceOrigin(other, "generated.txt", "from main\n", "main adds generated.txt");

    // Same path exists locally, untracked — git refuses the merge without
    // producing a single conflicted file. That is the `files.length === 0`
    // path, and it must not turn into a ✗ repeating every sync window.
    write(wt, "generated.txt", "built locally\n");

    const resultFile = path.join(root, "result");
    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    expect(read(wt, "generated.txt")).toBe("built locally\n");
  });

  test("detects an overlap when main renamed a file the worktree is editing", () => {
    const { root, wt, other } = makeWorld();
    git(other, ["mv", "base.txt", "renamed.txt"]);
    commitAll(other, "main renames base.txt");
    git(other, ["push", "--quiet", "origin", "main"]);

    // Dirty on the OLD path — visible only because the incoming diff is asked
    // for with --no-renames.
    write(wt, "base.txt", "work in progress\n");

    const resultFile = path.join(root, "result");
    expect(runSync(wt, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
    expect(read(wt, "base.txt")).toBe("work in progress\n");
  });
});

describe.concurrent("branch hierarchy", () => {
  test("merges the whole parent chain from remote-tracking refs", () => {
    const { root, primary, other, originPath } = makeWorld();

    // origin gets a `feat` branch, and a worktree sits on feat/auth.
    //
    // The worktree is cut from origin/feat, NOT from a local `feat` branch, and
    // that is not a test convenience: git cannot hold refs/heads/feat and
    // refs/heads/feat/auth at the same time ("cannot lock ref ... 'feat'
    // exists"). v0.3.x created exactly that local ref via `fetch origin
    // feat:feat` — so the hierarchy feature could not work even with a healthy
    // main.
    //
    // Note the shape this test pins down, because it is the ONLY one git
    // allows: the parent is pushed, the child is local-only. Pushing feat/auth
    // while origin has feat is rejected at the remote with the same D/F error,
    // so a stacked pair cannot coexist upstream at all. The parent chain is
    // therefore usable up to the moment the child branch is pushed — a
    // pre-existing limit of the naming scheme, not of the sync.
    git(other, ["checkout", "--quiet", "-b", "feat"]);
    write(other, "feat.txt", "feat\n");
    commitAll(other, "feat base");
    git(other, ["push", "--quiet", "origin", "feat"]);
    git(other, ["checkout", "--quiet", "main"]);

    const sub = path.join(root, "sub");
    git(primary, ["fetch", "--quiet", "origin", "feat"]);
    git(primary, ["worktree", "add", "--quiet", "-b", "feat/auth", sub, "origin/feat"]);

    // Both parents move on afterwards. advanceOrigin needs `other` on main.
    advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    git(other, ["checkout", "--quiet", "feat"]);
    write(other, "from-feat.txt", "feat\n");
    commitAll(other, "feat moves");
    git(other, ["push", "--quiet", "origin", "feat"]);
    git(other, ["checkout", "--quiet", "main"]);
    void originPath;

    const report = runSync(sub, path.join(root, "result"));

    expect(report).toContain("origin/main → feat/auth");
    expect(report).toContain("origin/feat → feat/auth");
    expect(fs.existsSync(path.join(sub, "from-main.txt"))).toBe(true);
    expect(fs.existsSync(path.join(sub, "from-feat.txt"))).toBe(true);
    expect(report).not.toContain("⚠");
    expect(report).not.toContain("✗");
  });

  test("ignores a parent segment that does not exist upstream", () => {
    const { root, primary, other } = makeWorld();

    // `claude/x` — the everyday layout here. There is no `claude` branch.
    const sub = path.join(root, "claude-wt");
    git(primary, ["worktree", "add", "--quiet", "-b", "claude/x", sub, "main"]);
    advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    const report = runSync(sub, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → claude/x: 1 commit(s)");
    expect(report).not.toContain("claude →");
    expect(report).not.toContain("✗");
  });
});
