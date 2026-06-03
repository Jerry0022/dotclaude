import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import {
  listWorktrees,
  isSessionWorktreePath,
  worktreeDirty,
  sessionWorktrees,
  dirtySessionWorktrees,
} from "./worktree.js";

beforeEach(() => {
  vi.resetAllMocks();
});

// Porcelain `git worktree list --porcelain` output. Paths are forward-slash
// even on Windows (matches real `git worktree list` behavior observed in repo).
const MAIN = "C:/repo";
const WT_DIRTY = "C:/repo/.claude/worktrees/awesome-haslett";
const WT_CLEAN = "C:/repo/.claude/worktrees/clean-session";

function porcelain(entries) {
  // entries: [{ path, branch?, detached? }]
  return entries
    .map((e) => {
      const lines = [`worktree ${e.path}`, "HEAD abc1234"];
      if (e.detached) lines.push("detached");
      else if (e.branch) lines.push(`branch refs/heads/${e.branch}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Route execSync by the git subcommand embedded in the command string so a
 * single mock can serve both the `worktree list` call and the per-path
 * `status` calls (git.js builds `git ${cmd}` and passes cwd via options).
 */
function routeGit(map) {
  execSync.mockImplementation((cmd, opts) => {
    if (cmd.includes("worktree list")) {
      if (map.worktreeList === undefined) throw new Error("no worktrees");
      return map.worktreeList;
    }
    if (cmd.includes("status --porcelain")) {
      const cwd = (opts && opts.cwd) || "";
      if (Object.prototype.hasOwnProperty.call(map.status || {}, cwd)) {
        const v = map.status[cwd];
        if (v === null) throw new Error("git failure");
        return v;
      }
      return ""; // unknown path → clean
    }
    throw new Error(`unexpected git command: ${cmd}`);
  });
}

// ---------------------------------------------------------------------------
// listWorktrees — porcelain parsing
// ---------------------------------------------------------------------------

describe("listWorktrees", () => {
  test("parses path + branch for each record", () => {
    execSync.mockReturnValue(
      porcelain([
        { path: MAIN, branch: "main" },
        { path: WT_DIRTY, branch: "claude/awesome-haslett" },
      ]),
    );
    expect(listWorktrees()).toEqual([
      { path: MAIN, branch: "main", detached: false },
      { path: WT_DIRTY, branch: "claude/awesome-haslett", detached: false },
    ]);
  });

  test("marks detached worktree with null branch", () => {
    execSync.mockReturnValue(
      porcelain([
        { path: MAIN, branch: "main" },
        { path: WT_DIRTY, detached: true },
      ]),
    );
    const wts = listWorktrees();
    expect(wts[1]).toEqual({ path: WT_DIRTY, branch: null, detached: true });
  });

  test("returns empty array on git failure", () => {
    execSync.mockImplementation(() => {
      throw new Error("fatal");
    });
    expect(listWorktrees()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isSessionWorktreePath
// ---------------------------------------------------------------------------

describe("isSessionWorktreePath", () => {
  test("true for .claude/worktrees path (forward slash)", () => {
    expect(isSessionWorktreePath(WT_DIRTY)).toBe(true);
  });

  test("true for backslash path (Windows normalization)", () => {
    expect(isSessionWorktreePath("C:\\repo\\.claude\\worktrees\\x")).toBe(true);
  });

  test("false for main repo path", () => {
    expect(isSessionWorktreePath(MAIN)).toBe(false);
  });

  test("false for empty", () => {
    expect(isSessionWorktreePath("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// worktreeDirty
// ---------------------------------------------------------------------------

describe("worktreeDirty", () => {
  test("dirty when status non-empty (counts lines)", () => {
    execSync.mockReturnValue(" M a.js\n?? b.txt");
    const r = worktreeDirty(WT_DIRTY);
    expect(r).toEqual({ path: WT_DIRTY, dirty: true, changes: 2 });
  });

  test("clean when status empty", () => {
    execSync.mockReturnValue("");
    expect(worktreeDirty(WT_CLEAN)).toEqual({ path: WT_CLEAN, dirty: false, changes: 0 });
  });

  test("git failure reports not-dirty (no false positive)", () => {
    execSync.mockImplementation(() => {
      throw new Error("path gone");
    });
    expect(worktreeDirty(WT_DIRTY)).toEqual({ path: WT_DIRTY, dirty: false, changes: 0 });
  });
});

// ---------------------------------------------------------------------------
// sessionWorktrees — filters to .claude/worktrees siblings, excludes cwd
// ---------------------------------------------------------------------------

describe("sessionWorktrees", () => {
  test("reports sibling session worktrees with dirty state, excludes main", () => {
    routeGit({
      worktreeList: porcelain([
        { path: MAIN, branch: "main" },
        { path: WT_DIRTY, branch: "claude/awesome-haslett" },
        { path: WT_CLEAN, branch: "claude/clean-session" },
      ]),
      status: { [WT_DIRTY]: " M x.js", [WT_CLEAN]: "" },
    });
    const result = sessionWorktrees({ cwd: MAIN });
    expect(result).toEqual([
      { path: WT_DIRTY, branch: "claude/awesome-haslett", dirty: true, changes: 1 },
      { path: WT_CLEAN, branch: "claude/clean-session", dirty: false, changes: 0 },
    ]);
  });

  test("excludes the cwd worktree itself (in-worktree ship does not self-flag)", () => {
    routeGit({
      worktreeList: porcelain([
        { path: MAIN, branch: "main" },
        { path: WT_DIRTY, branch: "claude/awesome-haslett" },
      ]),
      status: { [WT_DIRTY]: " M x.js" },
    });
    // cwd IS the dirty worktree → it must be excluded from the sibling list.
    expect(sessionWorktrees({ cwd: WT_DIRTY })).toEqual([]);
  });

  test("cwd exclusion is case-insensitive on drive letter", () => {
    routeGit({
      worktreeList: porcelain([{ path: WT_DIRTY, branch: "claude/x" }]),
      status: { [WT_DIRTY]: " M x.js" },
    });
    // Same path but lower-case drive letter in cwd — still excluded.
    expect(sessionWorktrees({ cwd: "c:/repo/.claude/worktrees/awesome-haslett" })).toEqual([]);
  });

  test("returns empty when no worktrees", () => {
    routeGit({ status: {} });
    expect(sessionWorktrees({ cwd: MAIN })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dirtySessionWorktrees — invariant check
// ---------------------------------------------------------------------------

describe("dirtySessionWorktrees", () => {
  test("returns only dirty siblings (split-state detected)", () => {
    routeGit({
      worktreeList: porcelain([
        { path: MAIN, branch: "main" },
        { path: WT_DIRTY, branch: "claude/awesome-haslett" },
        { path: WT_CLEAN, branch: "claude/clean-session" },
      ]),
      status: { [WT_DIRTY]: " M x.js\n?? y.txt", [WT_CLEAN]: "" },
    });
    expect(dirtySessionWorktrees({ cwd: MAIN })).toEqual([
      { path: WT_DIRTY, branch: "claude/awesome-haslett", dirty: true, changes: 2 },
    ]);
  });

  test("empty when all session worktrees are clean (no false positive)", () => {
    routeGit({
      worktreeList: porcelain([
        { path: MAIN, branch: "main" },
        { path: WT_CLEAN, branch: "claude/clean-session" },
      ]),
      status: { [WT_CLEAN]: "" },
    });
    expect(dirtySessionWorktrees({ cwd: MAIN })).toEqual([]);
  });
});
