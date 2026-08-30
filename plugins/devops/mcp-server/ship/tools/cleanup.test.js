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
  NETWORK_TIMEOUT: 60_000,
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

// Default to a normal repo the project owns; individual tests override to
// exercise the file-only / foreign-root refusals.
vi.mock("../lib/repo-mode.js", () => ({
  detectRepoMode: vi.fn(() => "git"),
  refusesGitWrites: (mode) => mode === "none" || mode === "git-foreign-root",
}));

import { handler } from "./cleanup.js";
import { git, gitStrict, isWorktree, getWorktreeBranches } from "../lib/git.js";
import { dirtySessionWorktrees } from "../lib/worktree.js";
import { detectRepoMode } from "../lib/repo-mode.js";

const CWD = "/fake/consumer-repo";

beforeEach(() => {
  vi.clearAllMocks();
  detectRepoMode.mockReturnValue("git");
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

  test("local main sync: fast-forwards local base even when already on base", async () => {
    // current === base ("main"), so the legacy checkout path is skipped — the
    // unconditional sync must still fast-forward local main to origin/main.
    await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(gitStrict).toHaveBeenCalledWith("pull --ff-only origin main", expect.objectContaining({ cwd: CWD }));
  });

  test("local main sync: warns when local base stays behind origin after sync", async () => {
    git.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref HEAD")) return "main";
      if (cmd.includes("rev-parse origin/main")) return "bbbbbbbbbbbb";
      if (cmd.includes("rev-parse main")) return "aaaaaaaaaaaa";
      if (cmd.includes("ls-remote")) return "";
      return "";
    });
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.warnings.some((w) => /not fully landed locally/i.test(w))).toBe(true);
  });
});

describe("repo-mode gate", () => {
  test("file-only mode: refuses every destructive git call, still clears the sentinel", async () => {
    detectRepoMode.mockReturnValue("none");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("file-only-mode");
    expect(result.cleaned).toEqual(["sentinel"]);
    // The pre-fix behaviour was a raw `fatal: not a git repository` from these.
    expect(gitStrict).not.toHaveBeenCalled();
  });

  test("foreign repo root: refuses rather than operating on the ancestor's repo", async () => {
    detectRepoMode.mockReturnValue("git-foreign-root");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("foreign-repo-root");
    // This is the destructive case: `checkout <base>` + `pull --ff-only origin
    // <base>` used to run against a repository the user never targeted.
    expect(gitStrict).not.toHaveBeenCalled();
    expect(result.warnings.some((w) => /does not own/i.test(w))).toBe(true);
  });

  test("normal repo is unaffected by the gate", async () => {
    detectRepoMode.mockReturnValue("git");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.skipped).toBeUndefined();
  });
});
