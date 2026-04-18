import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import {
  git,
  gitStrict,
  currentBranch,
  dirtyState,
  commitsAhead,
  unpushedCommits,
  headShort,
  isWorktree,
  getWorktreeBranches,
  branchExists,
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
