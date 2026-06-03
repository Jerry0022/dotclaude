import { describe, test, expect, vi, beforeEach } from "vitest";

// zod is a runtime dep of the MCP server, not installed in the test env. The
// handler never invokes the schema (only MCP registration does), so a minimal
// chainable stub suffices to load the module.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node } };
});

vi.mock("../lib/git.js", () => ({
  git: vi.fn(() => ""),
  gitStrict: vi.fn(() => ""),
  isWorktree: vi.fn(() => false),
  getWorktreeBranches: vi.fn(() => new Set()),
}));

vi.mock("../lib/worktree.js", () => ({
  dirtySessionWorktrees: vi.fn(() => []),
}));

vi.mock("../lib/sentinel.js", () => ({
  clearSentinel: vi.fn(),
}));

import { handler } from "./cleanup.js";
import { git, isWorktree, getWorktreeBranches } from "../lib/git.js";
import { dirtySessionWorktrees } from "../lib/worktree.js";

const CWD = "/fake/consumer-repo";

beforeEach(() => {
  vi.clearAllMocks();
  isWorktree.mockReturnValue(false);
  getWorktreeBranches.mockReturnValue(new Set());
  dirtySessionWorktrees.mockReturnValue([]);
  // On base branch already, no remote branch left → minimal happy path.
  git.mockImplementation((cmd) => {
    if (cmd.includes("rev-parse --abbrev-ref HEAD")) return "main";
    if (cmd.includes("ls-remote")) return "";
    return "";
  });
});

describe("ship_cleanup — session-worktree final-gate invariant", () => {
  test("clean case: no dirty session worktree → success, no worktree warning", async () => {
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => /session worktree/i.test(w))).toBe(false);
  });

  test("split-state after merge: dirty session worktree → loud WARNING (cleanup still succeeds)", async () => {
    dirtySessionWorktrees.mockReturnValue([
      { path: "/fake/consumer-repo/.claude/worktrees/awesome-haslett", branch: "claude/awesome-haslett", dirty: true, changes: 4 },
    ]);
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });

    // Hard block lives in preflight — cleanup runs post-merge, so it warns only.
    expect(result.success).toBe(true);
    const warning = result.warnings.find((w) => /WARNING/.test(w) && /session worktree/i.test(w));
    expect(warning).toBeTruthy();
    expect(warning).toMatch(/awesome-haslett/);
    expect(warning).toMatch(/4 uncommitted/);
    expect(warning).toMatch(/NOT included/i);
  });

  test("keep-mode: invariant not asserted (early return)", async () => {
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: true });
    expect(result.kept).toBe(true);
    expect(dirtySessionWorktrees).not.toHaveBeenCalled();
  });
});
