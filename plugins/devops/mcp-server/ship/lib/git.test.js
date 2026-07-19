import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execSync, execFileSync } from "node:child_process";
import {
  git,
  gitStrict,
  gitArgs,
  currentBranch,
  dirtyState,
  commitsAhead,
  unpushedCommits,
  headShort,
  isWorktree,
  getWorktreeBranches,
  branchExists,
  worktreePathForBranch,
  syncLocalBranch,
  treeOf,
} from "./git.js";

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// git / gitStrict — base wrappers
// ---------------------------------------------------------------------------

describe("git", () => {
  test("returns trimmed stdout on success", () => {
    execSync.mockReturnValue("  main  \n");
    expect(git("rev-parse --abbrev-ref HEAD")).toBe("main");
  });

  test("returns null on failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(git("bad-command")).toBeNull();
  });
});

describe("gitStrict", () => {
  test("returns trimmed stdout on success", () => {
    execSync.mockReturnValue("abc1234\n");
    expect(gitStrict("rev-parse --short HEAD")).toBe("abc1234");
  });

  test("throws on failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(() => gitStrict("bad-command")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// gitArgs — no-shell array form (F1/F2): metachar-safe, throws on failure
// ---------------------------------------------------------------------------

describe("gitArgs", () => {
  test("returns trimmed stdout on success", () => {
    execFileSync.mockReturnValue("abc1234\n");
    expect(gitArgs(["rev-parse", "--short", "HEAD"])).toBe("abc1234");
  });

  test("passes args verbatim to git via execFileSync (no shell string)", () => {
    execFileSync.mockReturnValue("");
    // A path with a space and a branch with cmd.exe metachars must each stay a
    // SINGLE argument — never word-split or shell-interpreted.
    gitArgs(["add", "--", ":/new file (draft).txt"], { cwd: "/repo" });
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["add", "--", ":/new file (draft).txt"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
    // The command name is exactly "git" — the arguments are NOT concatenated
    // into a single shell string (which is what let metachars break out).
    expect(execFileSync.mock.calls[0][0]).toBe("git");
    expect(Array.isArray(execFileSync.mock.calls[0][1])).toBe(true);
  });

  test("throws on failure (fail-closed, not null-swallowed like git())", () => {
    execFileSync.mockImplementation(() => {
      throw new Error("fatal: pathspec did not match");
    });
    expect(() => gitArgs(["add", "--", ":/missing"])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// treeOf — post-merge tree guard lookup
// ---------------------------------------------------------------------------

describe("treeOf", () => {
  test("returns the tree id of a ref", () => {
    execSync.mockReturnValue("3bcc2a7727a1ef4c53626a7b61f413985a27b0ca\n");
    expect(treeOf("origin/main")).toBe("3bcc2a7727a1ef4c53626a7b61f413985a27b0ca");
  });

  test("REGRESSION: command contains no caret (cmd.exe eats ^ on Windows → guard fired null/false on every ship)", () => {
    execSync.mockReturnValue("tree123\n");
    treeOf("HEAD");
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).not.toContain("^");
    expect(cmd).toContain("--format=%T");
  });

  test("returns null for unknown ref", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal: bad revision");
    });
    expect(treeOf("nope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// currentBranch
// ---------------------------------------------------------------------------

describe("currentBranch", () => {
  test("returns branch name", () => {
    execSync.mockReturnValue("feat/video-filters\n");
    expect(currentBranch()).toBe("feat/video-filters");
  });
});

// ---------------------------------------------------------------------------
// dirtyState — parsing git status --porcelain
// ---------------------------------------------------------------------------

describe("dirtyState", () => {
  test("clean repo", () => {
    execSync.mockReturnValue("");
    const state = dirtyState();
    expect(state.dirty).toBe(false);
    expect(state.untracked).toEqual([]);
    expect(state.modified).toEqual([]);
    expect(state.lines).toEqual([]);
  });

  test("modified and untracked files (-z format)", () => {
    // -z: NUL-terminated, first entry unstaged modification, second untracked.
    execSync.mockReturnValue(" M src/index.js\0?? new-file.txt\0");
    const state = dirtyState();
    expect(state.dirty).toBe(true);
    expect(state.modified).toEqual(["src/index.js"]);
    expect(state.untracked).toEqual(["new-file.txt"]);
  });

  test("first line unstaged dotfile preserves leading dot (regression: v0.48 ship)", () => {
    // Repro for the bug that made ship_release silently drop
    // .claude-plugin/marketplace.json from marketplace-project release
    // commits: the first porcelain line " M .claude-plugin/..." lost its
    // leading space to trim(), and slice(3) then stripped the leading dot
    // — making `git add -- claude-plugin/marketplace.json` fail silently.
    execSync.mockReturnValue(
      " M .claude-plugin/marketplace.json\0 M README.md\0 M plugins/devops/.claude-plugin/plugin.json\0",
    );
    const state = dirtyState();
    expect(state.modified).toEqual([
      ".claude-plugin/marketplace.json",
      "README.md",
      "plugins/devops/.claude-plugin/plugin.json",
    ]);
    expect(state.untracked).toEqual([]);
  });

  test("multiple modified files with mixed index/worktree status", () => {
    execSync.mockReturnValue("MM a.js\0 M b.js\0A  c.js\0");
    const state = dirtyState();
    expect(state.dirty).toBe(true);
    expect(state.modified).toEqual(["a.js", "b.js", "c.js"]);
    expect(state.untracked).toHaveLength(0);
  });

  test("rename entry consumes source-path token", () => {
    // `R  NEW\0OLD\0` — the old path must not leak into modified[].
    execSync.mockReturnValue("R  new.js\0old.js\0 M other.js\0");
    const state = dirtyState();
    expect(state.modified).toEqual(["new.js", "other.js"]);
  });

  test("returns empty on git failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const state = dirtyState();
    expect(state.dirty).toBe(false);
    expect(state.lines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// commitsAhead
// ---------------------------------------------------------------------------

describe("commitsAhead", () => {
  test("parses count", () => {
    execSync.mockReturnValue("5\n");
    expect(commitsAhead("main")).toBe(5);
  });

  test("returns 0 on failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(commitsAhead("main")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// unpushedCommits
// ---------------------------------------------------------------------------

describe("unpushedCommits", () => {
  test("returns count when upstream exists", () => {
    execSync
      .mockReturnValueOnce("origin/main\n") // upstream check
      .mockReturnValueOnce("3\n"); // rev-list count
    expect(unpushedCommits()).toBe(3);
  });

  test("returns null when no upstream configured", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal: no upstream");
    });
    expect(unpushedCommits()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// headShort
// ---------------------------------------------------------------------------

describe("headShort", () => {
  test("returns short hash", () => {
    execSync.mockReturnValue("abc1234\n");
    expect(headShort()).toBe("abc1234");
  });
});

// ---------------------------------------------------------------------------
// isWorktree
// ---------------------------------------------------------------------------

describe("isWorktree", () => {
  test("true when git-common-dir differs from git-dir", () => {
    execSync
      .mockReturnValueOnce("/repo/.git\n") // git-common-dir
      .mockReturnValueOnce("/repo/.git/worktrees/branch\n"); // git-dir
    expect(isWorktree()).toBe(true);
  });

  test("false when same", () => {
    execSync
      .mockReturnValueOnce(".git\n")
      .mockReturnValueOnce(".git\n");
    expect(isWorktree()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWorktreeBranches
// ---------------------------------------------------------------------------

describe("getWorktreeBranches", () => {
  test("parses porcelain output with multiple worktrees", () => {
    execSync.mockReturnValue(
      [
        "worktree /repo",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /repo/.claude/worktrees/priceless-goldwasser",
        "HEAD def5678",
        "branch refs/heads/claude/priceless-goldwasser",
        "",
      ].join("\n"),
    );
    const branches = getWorktreeBranches();
    expect(branches).toEqual(new Set(["main", "claude/priceless-goldwasser"]));
  });

  test("returns empty set on git failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(getWorktreeBranches()).toEqual(new Set());
  });

  test("handles detached HEAD worktree (no branch line)", () => {
    execSync.mockReturnValue(
      [
        "worktree /repo",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /repo/.claude/worktrees/detached",
        "HEAD def5678",
        "detached",
        "",
      ].join("\n"),
    );
    const branches = getWorktreeBranches();
    expect(branches).toEqual(new Set(["main"]));
  });
});

// ---------------------------------------------------------------------------
// branchExists
// ---------------------------------------------------------------------------

describe("branchExists", () => {
  test("returns 'local' when local ref exists", () => {
    execSync.mockReturnValueOnce("abc1234\n"); // local verify succeeds
    expect(branchExists("feat/test")).toBe("local");
  });

  test("returns 'remote' when only remote ref exists", () => {
    execSync
      .mockImplementationOnce(() => {
        throw new Error("fatal");
      }) // local fails
      .mockReturnValueOnce("abc1234\n"); // remote succeeds
    expect(branchExists("feat/test")).toBe("remote");
  });

  test("returns null when branch does not exist", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(branchExists("nonexistent")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// worktreePathForBranch
// ---------------------------------------------------------------------------

describe("worktreePathForBranch", () => {
  const wtList = [
    "worktree /repo",
    "HEAD abc1234",
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/topic",
    "HEAD def5678",
    "branch refs/heads/claude/topic",
    "",
  ].join("\n");

  test("returns the path of the worktree holding the branch", () => {
    execSync.mockReturnValue(wtList);
    expect(worktreePathForBranch("claude/topic")).toBe("/repo/.claude/worktrees/topic");
  });

  test("returns the main worktree path for the base branch", () => {
    execSync.mockReturnValue(wtList);
    expect(worktreePathForBranch("main")).toBe("/repo");
  });

  test("returns null when no worktree has the branch", () => {
    execSync.mockReturnValue(wtList);
    expect(worktreePathForBranch("feat/unrelated")).toBeNull();
  });

  test("returns null on git failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(worktreePathForBranch("main")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// syncLocalBranch — worktree-safe local-ref fast-forward (#206)
// ---------------------------------------------------------------------------

describe("syncLocalBranch", () => {
  const wtListMainHere = [
    "worktree /repo",
    "HEAD aaaaaaa",
    "branch refs/heads/main",
    "",
  ].join("\n");
  const wtListMainElsewhere = [
    "worktree /repo",
    "HEAD aaaaaaa",
    "branch refs/heads/feat/topic",
    "",
    "worktree /repo/main-wt",
    "HEAD bbbbbbb",
    "branch refs/heads/main",
    "",
  ].join("\n");
  const wtListMainAbsent = [
    "worktree /repo",
    "HEAD aaaaaaa",
    "branch refs/heads/feat/topic",
    "",
  ].join("\n");

  test("no-op when local base already equals origin/base", () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --verify refs/remotes/origin/main")) return "aaa\n";
      if (cmd.includes("rev-parse --verify refs/heads/main")) return "aaa\n";
      return "";
    });
    expect(syncLocalBranch("main")).toEqual({ updated: false, method: "already-current" });
  });

  test("warns (no force) when origin/base is missing", () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --verify refs/remotes/origin/main")) throw new Error("bad rev");
      return "";
    });
    const r = syncLocalBranch("main");
    expect(r.updated).toBe(false);
    expect(r.method).toBe("none");
    expect(r.warning).toMatch(/origin\/main not found/);
  });

  test("fast-forwards via merge --ff-only in the worktree that owns the branch", () => {
    const calls = [];
    execSync.mockImplementation((cmd, optsArg) => {
      calls.push({ cmd, cwd: optsArg?.cwd });
      if (cmd.includes("rev-parse --verify refs/remotes/origin/main")) return "bbb\n";
      if (cmd.includes("rev-parse --verify refs/heads/main")) return "aaa\n";
      if (cmd.includes("worktree list --porcelain")) return wtListMainHere;
      return "";
    });
    const r = syncLocalBranch("main");
    expect(r).toEqual({ updated: true, method: "merge-ff", path: "/repo" });
    // The merge runs in the worktree that holds main, never with --force/--hard.
    const merge = calls.find((c) => c.cmd.includes("merge --ff-only origin/main"));
    expect(merge).toBeTruthy();
    expect(merge.cwd).toBe("/repo");
    expect(calls.some((c) => /--force|--hard/.test(c.cmd))).toBe(false);
  });

  test("targets the OTHER worktree when base is checked out away from cwd", () => {
    const calls = [];
    execSync.mockImplementation((cmd, optsArg) => {
      calls.push({ cmd, cwd: optsArg?.cwd });
      if (cmd.includes("rev-parse --verify refs/remotes/origin/main")) return "bbb\n";
      if (cmd.includes("rev-parse --verify refs/heads/main")) return "aaa\n";
      if (cmd.includes("worktree list --porcelain")) return wtListMainElsewhere;
      return "";
    });
    const r = syncLocalBranch("main", { cwd: "/repo" });
    expect(r).toEqual({ updated: true, method: "merge-ff", path: "/repo/main-wt" });
    const merge = calls.find((c) => c.cmd.includes("merge --ff-only origin/main"));
    expect(merge.cwd).toBe("/repo/main-wt");
  });

  test("warns instead of forcing when the checked-out branch cannot fast-forward", () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --verify refs/remotes/origin/main")) return "bbb\n";
      if (cmd.includes("rev-parse --verify refs/heads/main")) return "aaa\n";
      if (cmd.includes("worktree list --porcelain")) return wtListMainHere;
      if (cmd.includes("merge --ff-only origin/main")) throw new Error("Not possible to fast-forward, aborting.");
      return "";
    });
    const r = syncLocalBranch("main");
    expect(r.updated).toBe(false);
    expect(r.method).toBe("merge-ff");
    expect(r.warning).toMatch(/not fast-forwardable/i);
  });

  test("updates the bare ref directly when no worktree owns the branch", () => {
    const calls = [];
    execSync.mockImplementation((cmd) => {
      calls.push(cmd);
      if (cmd.includes("rev-parse --verify refs/remotes/origin/main")) return "bbb\n";
      if (cmd.includes("rev-parse --verify refs/heads/main")) return "aaa\n";
      if (cmd.includes("worktree list --porcelain")) return wtListMainAbsent;
      return "";
    });
    const r = syncLocalBranch("main");
    expect(r).toEqual({ updated: true, method: "fetch-refspec" });
    expect(calls.some((c) => c.includes("fetch origin main:main"))).toBe(true);
  });
});
