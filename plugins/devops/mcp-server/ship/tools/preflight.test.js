import { describe, test, expect, vi, beforeEach } from "vitest";

// zod is a runtime dependency of the MCP server (installed where the server
// runs) but is not a devDependency of this repo, so the test environment can't
// resolve it. The handler never invokes the schema — only the MCP registration
// does — so a minimal chainable stub is enough to load the module.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node } };
});

// Mock every lib the handler touches so we can drive a deterministic "ready"
// pipeline and isolate the session-worktree-clean gate. cwd is a synthetic
// path that is NOT the plugin source repo, so docSyncChecks() no-ops.
vi.mock("../lib/git.js", () => ({
  git: vi.fn(() => ""),
  currentBranch: vi.fn(() => "feat/topic"),
  dirtyState: vi.fn(() => ({ dirty: false, untracked: [], modified: [], lines: [] })),
  commitsAhead: vi.fn(() => 1),
  unpushedCommits: vi.fn(() => 0),
  isWorktree: vi.fn(() => false),
  detectParentBranch: vi.fn(() => null),
  detectDefaultBranch: vi.fn(() => "main"),
  branchExists: vi.fn(() => "remote"),
  fileOverlap: vi.fn(() => ({ mergeBase: "abc", branchFiles: [], baseFiles: [], overlap: [] })),
  getConfig: vi.fn(() => "diff3"),
}));

vi.mock("../lib/version.js", () => ({
  readVersion: vi.fn(() => ({ version: "1.0.0", type: "npm" })),
  verifyVersionFiles: vi.fn(() => ({ consistent: true, mismatches: [] })),
}));

vi.mock("../lib/sentinel.js", () => ({
  writeSentinel: vi.fn(),
}));

vi.mock("../lib/repo-mode.js", () => ({
  detectRepoMode: vi.fn(() => "git"),
}));

vi.mock("../lib/worktree.js", () => ({
  dirtySessionWorktrees: vi.fn(() => []),
}));

import { handler } from "./preflight.js";
import { isWorktree } from "../lib/git.js";
import { dirtySessionWorktrees } from "../lib/worktree.js";

const CWD = "/fake/consumer-repo";

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply defaults cleared by clearAllMocks.
  isWorktree.mockReturnValue(false);
  dirtySessionWorktrees.mockReturnValue([]);
});

function checkByName(result, name) {
  return result.checks.find((c) => c.name === name);
}

describe("ship_preflight — session-worktree-clean gate", () => {
  test("clean case: shipping from main with no dirty session worktree → ok, ready", async () => {
    const result = await handler({ cwd: CWD });
    const check = checkByName(result, "session-worktree-clean");
    expect(check).toEqual({ name: "session-worktree-clean", ok: true });
    expect(result.errors.some((e) => /session worktree/i.test(e))).toBe(false);
    expect(result.ready).toBe(true);
  });

  test("split-state: main-repo ship + dirty session worktree → blocked", async () => {
    dirtySessionWorktrees.mockReturnValue([
      { path: "/fake/consumer-repo/.claude/worktrees/awesome-haslett", branch: "claude/awesome-haslett", dirty: true, changes: 3 },
    ]);
    const result = await handler({ cwd: CWD });

    const check = checkByName(result, "session-worktree-clean");
    expect(check).toMatchObject({
      name: "session-worktree-clean",
      ok: false,
      worktree: "/fake/consumer-repo/.claude/worktrees/awesome-haslett",
      branch: "claude/awesome-haslett",
      changes: 3,
    });
    // Blocking: an error was pushed and the pipeline is not ready.
    expect(result.errors.some((e) => /session worktree/i.test(e) && /uncommitted/i.test(e))).toBe(true);
    expect(result.ready).toBe(false);
  });

  test("multiple dirty session worktrees → one error + check each", async () => {
    dirtySessionWorktrees.mockReturnValue([
      { path: "/r/.claude/worktrees/a", branch: "claude/a", dirty: true, changes: 1 },
      { path: "/r/.claude/worktrees/b", branch: "claude/b", dirty: true, changes: 2 },
    ]);
    const result = await handler({ cwd: CWD });
    const checks = result.checks.filter((c) => c.name === "session-worktree-clean");
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.ok === false)).toBe(true);
    expect(result.ready).toBe(false);
  });

  test("in-worktree ship (normal case): gate self-excludes → ok, helper not consulted", async () => {
    isWorktree.mockReturnValue(true);
    const result = await handler({ cwd: CWD });
    const check = checkByName(result, "session-worktree-clean");
    expect(check).toEqual({ name: "session-worktree-clean", ok: true });
    // When in-worktree we must NOT scan siblings (clean-tree already covers cwd).
    expect(dirtySessionWorktrees).not.toHaveBeenCalled();
    expect(result.ready).toBe(true);
  });
});
