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

  test("modified and untracked files", () => {
    // Use "M " (staged) for first line — leading space in " M" gets eaten by trim()
    execSync.mockReturnValue("M  src/index.js\n?? new-file.txt\n");
    const state = dirtyState();
    expect(state.dirty).toBe(true);
    expect(state.modified).toEqual(["src/index.js"]);
    expect(state.untracked).toEqual(["new-file.txt"]);
  });

  test("multiple modified files", () => {
    execSync.mockReturnValue("MM a.js\n M b.js\nA  c.js\n");
    const state = dirtyState();
    expect(state.dirty).toBe(true);
    expect(state.modified).toHaveLength(3);
    expect(state.untracked).toHaveLength(0);
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
