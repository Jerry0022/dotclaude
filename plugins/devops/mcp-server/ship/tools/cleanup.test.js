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
  gitArgs: vi.fn(() => ""),
  gitTry: vi.fn(),
  isWorktree: vi.fn(() => false),
  getWorktreeBranches: vi.fn(() => new Set()),
}));

vi.mock("../lib/worktree.js", () => ({
  dirtySessionWorktrees: vi.fn(() => []),
}));

vi.mock("../lib/sentinel.js", () => ({
  clearSentinel: vi.fn(),
}));

vi.mock("../lib/lockout-marker.js", () => ({
  clearLockoutMarker: vi.fn(() => false),
}));

// Default to a normal repo the project owns; individual tests override to
// exercise the file-only / foreign-root refusals.
vi.mock("../lib/repo-mode.js", () => ({
  detectRepoMode: vi.fn(() => "git"),
  refusesGitWrites: (mode) => mode === "none" || mode === "git-foreign-root" || mode === "unknown",
  probeTimeoutError: (cwd) => `git did not answer within 10 s (ETIMEDOUT) — the repo mode of ${cwd} could not be determined. Retry the call. Nothing was skipped, committed, pushed or merged.`,
}));

import { handler } from "./cleanup.js";
import { git, gitArgs, gitTry, isWorktree, getWorktreeBranches } from "../lib/git.js";
import { dirtySessionWorktrees } from "../lib/worktree.js";
import { detectRepoMode } from "../lib/repo-mode.js";
import { clearSentinel } from "../lib/sentinel.js";
import { clearLockoutMarker } from "../lib/lockout-marker.js";

const CWD = "/fake/consumer-repo";

beforeEach(() => {
  vi.clearAllMocks();
  detectRepoMode.mockReturnValue("git");
  isWorktree.mockReturnValue(false);
  getWorktreeBranches.mockReturnValue(new Set());
  dirtySessionWorktrees.mockReturnValue([]);
  clearLockoutMarker.mockReturnValue(false);
  // branch/base-interpolating reads use the argv form; route them to the same fake
  gitTry.mockImplementation((args, o) => git(args.join(" "), o));
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
    expect(gitArgs).toHaveBeenCalledWith(["pull", "--ff-only", "origin", "main"], expect.objectContaining({ cwd: CWD }));
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
  test("timed-out probe: fails loudly, keeps the sentinel, deletes nothing (#411)", async () => {
    detectRepoMode.mockReturnValue("unknown");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("git-probe-timeout");
    expect(result.cleaned).toEqual([]);
    expect(result.error).toMatch(/ETIMEDOUT/);
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("file-only mode: refuses every destructive git call, still clears the sentinel", async () => {
    detectRepoMode.mockReturnValue("none");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("file-only-mode");
    expect(result.cleaned).toEqual(["sentinel"]);
    // The pre-fix behaviour was a raw `fatal: not a git repository` from these.
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("foreign repo root: refuses rather than operating on the ancestor's repo", async () => {
    detectRepoMode.mockReturnValue("git-foreign-root");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("foreign-repo-root");
    // This is the destructive case: `checkout <base>` + `pull --ff-only origin
    // <base>` used to run against a repository the user never targeted.
    expect(gitArgs).not.toHaveBeenCalled();
    expect(result.warnings.some((w) => /does not own/i.test(w))).toBe(true);
  });

  test("normal repo is unaffected by the gate", async () => {
    detectRepoMode.mockReturnValue("git");
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.skipped).toBeUndefined();
  });
});

describe("ship_cleanup — branch names never reach a shell (AUD-C014)", () => {
  test("a legal branch with cmd.exe metacharacters is passed as one argv element", async () => {
    const evil = "feat/x&whoami";
    git.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref HEAD")) return "main";
      if (cmd.includes("ls-remote")) return `abc	refs/heads/${evil}`;
      return "";
    });
    const result = await handler({ branch: evil, base: "main", cwd: CWD, keep: false });
    expect(result.success).toBe(true);
    expect(gitArgs).toHaveBeenCalledWith(["branch", "-D", evil], expect.anything());
    expect(gitArgs).toHaveBeenCalledWith(["push", "origin", "--delete", evil], expect.anything());
    expect(gitTry).toHaveBeenCalledWith(["ls-remote", "--heads", "origin", evil], expect.anything());
    // no shell-string git call carries the branch name
    expect(git.mock.calls.filter((c) => !gitTry.mock.calls.some((t) => t[0].join(" ") === c[0]))
      .some((c) => String(c[0]).includes(evil))).toBe(false);
  });
});

describe("lockout marker — cleared on every exit that clears the sentinel", () => {
  // A `.claude/.ship-lockout` left behind makes the next interactive /do-ship
  // take every non-interactive BLOCK branch. ship-blocked exits call
  // ship_cleanup({ keep: true }) and skip Step 5, so the clear lives here.
  test("keep-mode (the ship-blocked exit) clears marker and sentinel", async () => {
    clearLockoutMarker.mockReturnValue(true);
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: true });
    expect(clearSentinel).toHaveBeenCalledWith(CWD);
    expect(clearLockoutMarker).toHaveBeenCalledWith(CWD);
    expect(result.cleaned).toEqual(["sentinel", "lockout-marker"]);
  });

  test("keep-mode without a marker reports only the sentinel", async () => {
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: true });
    expect(clearLockoutMarker).toHaveBeenCalledWith(CWD);
    expect(result.cleaned).toEqual(["sentinel"]);
  });

  test("normal cleanup (success) clears the marker", async () => {
    clearLockoutMarker.mockReturnValue(true);
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.success).toBe(true);
    expect(clearLockoutMarker).toHaveBeenCalledWith(CWD);
    expect(result.cleaned).toContain("lockout-marker");
  });

  test("refused cleanup (still in a worktree) clears the marker too", async () => {
    isWorktree.mockReturnValue(true);
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.success).toBe(false);
    expect(clearLockoutMarker).toHaveBeenCalledWith(CWD);
  });

  test("branch attached to a worktree: refused, marker cleared", async () => {
    getWorktreeBranches.mockReturnValue(new Set(["feat/topic"]));
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.success).toBe(false);
    expect(clearLockoutMarker).toHaveBeenCalledWith(CWD);
  });

  test("file-only mode clears the marker", async () => {
    detectRepoMode.mockReturnValue("none");
    clearLockoutMarker.mockReturnValue(true);
    const result = await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(result.cleaned).toEqual(["sentinel", "lockout-marker"]);
  });

  test("timed-out probe keeps the marker like the sentinel — the ship may still run", async () => {
    detectRepoMode.mockReturnValue("unknown");
    await handler({ branch: "feat/topic", base: "main", cwd: CWD, keep: false });
    expect(clearLockoutMarker).not.toHaveBeenCalled();
    expect(clearSentinel).not.toHaveBeenCalled();
  });
});
