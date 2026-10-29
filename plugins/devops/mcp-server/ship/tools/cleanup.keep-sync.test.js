import { describe, test, expect, vi, beforeEach } from "vitest";

// Keep-mode after a merged squash ship (#942): the kept branch moves to the
// merged base when its tree equals it, and stays put in every other case.

vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node } };
});

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "") }));

vi.mock("../lib/git.js", () => ({
  git: vi.fn(() => ""),
  NETWORK_TIMEOUT: 60_000,
  gitArgs: vi.fn(() => ""),
  gitTry: vi.fn(),
  isWorktree: vi.fn(() => true),
  detectDefaultBranch: vi.fn(() => "main"),
  getWorktreeBranches: vi.fn(() => new Set()),
}));
vi.mock("../lib/worktree.js", () => ({ dirtySessionWorktrees: vi.fn(() => []) }));
vi.mock("../lib/sentinel.js", () => ({ clearSentinel: vi.fn() }));
vi.mock("../lib/lockout-marker.js", () => ({ clearLockoutMarker: vi.fn(() => false) }));
vi.mock("../lib/landing-lock.js", () => ({ releaseLandingLockFor: vi.fn(() => false) }));
vi.mock("../lib/repo-mode.js", () => ({
  detectRepoMode: vi.fn(() => "git"),
  refusesGitWrites: () => false,
  probeTimeoutError: () => "",
}));

import { handler, syncKeptBranch } from "./cleanup.js";
import { gitArgs, gitTry } from "../lib/git.js";
import { execFileSync } from "node:child_process";

const CWD = "/fake/repo";
const BRANCH = "claude/dev-start-ef1ee6";
const HEAD = "aaaa111";
const BASE = "bbbb222";

// A merged squash ship as #942 saw it: upstream configured but gone, HEAD's
// tree equal to origin/main's.
function repo(over = {}) {
  const s = {
    current: BRANCH, remote: "origin", upstream: `refs/heads/${BRANCH}`,
    // tracking ref before the prune (last pushed tip) and after it
    pushed: HEAD, remoteBranch: null,
    head: HEAD, base: BASE, headTree: "t1", baseTree: "t1", ...over,
  };
  let fetched = false;
  gitTry.mockImplementation((args) => {
    const a = args.join(" ");
    if (a === "rev-parse --abbrev-ref HEAD") return s.current;
    if (a === `config --get branch.${BRANCH}.remote`) return s.remote;
    if (a === `config --get branch.${BRANCH}.merge`) return s.upstream;
    if (a.startsWith("fetch")) { fetched = true; return ""; }
    if (a === `rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`) return fetched ? s.remoteBranch : s.pushed;
    if (a === "rev-parse HEAD") return s.head;
    if (a === "rev-parse --verify --quiet refs/remotes/origin/main") return s.base;
    if (a === `rev-parse ${s.head}^{tree}`) return s.headTree;
    if (a === `rev-parse ${s.base}^{tree}`) return s.baseTree;
    return "";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  execFileSync.mockReturnValue("");
  repo();
});

describe("syncKeptBranch (#942)", () => {
  test("merged, same tree, upstream gone → branch moved to origin/<base> with an old-value guard", () => {
    const r = syncKeptBranch(CWD, BRANCH, "main");
    expect(r).toEqual({ synced: true, from: HEAD, to: BASE });
    expect(gitArgs).toHaveBeenCalledWith(["update-ref", `refs/heads/${BRANCH}`, BASE, HEAD], { cwd: CWD });
    expect(gitTry).toHaveBeenCalledWith(["branch", "--unset-upstream", BRANCH], { cwd: CWD });
  });

  test("tree differs → untouched (work that did not land)", () => {
    repo({ baseTree: "t2" });
    expect(syncKeptBranch(CWD, BRANCH, "main")).toEqual({ synced: false, reason: "tree-differs" });
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("remote branch still there (blocked before the merge) → untouched", () => {
    repo({ remoteBranch: "cccc333" });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("upstream-present");
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("never pushed → untouched", () => {
    repo({ upstream: null });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("no-upstream");
  });

  test("upstream is not origin/<branch> → untouched", () => {
    repo({ upstream: "refs/heads/other" });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("no-upstream");
    repo({ remote: "fork" });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("no-upstream");
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("local commits on top of the last pushed tip (even with an equal tree) → untouched", () => {
    repo({ pushed: "eeee555" });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("unpushed-commits");
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("tracking ref already pruned before cleanup → falls back to the tree check", () => {
    repo({ pushed: null });
    expect(syncKeptBranch(CWD, BRANCH, "main").synced).toBe(true);
  });

  test("dirty tree or another branch checked out → untouched", () => {
    execFileSync.mockReturnValue(" M a.js\n");
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("dirty-tree");
    execFileSync.mockReturnValue("");
    repo({ current: "other" });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("not-on-branch");
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("already on the base commit → nothing to move", () => {
    repo({ head: BASE, pushed: BASE });
    expect(syncKeptBranch(CWD, BRANCH, "main").reason).toBe("already-on-base");
  });
});

describe("ship_cleanup keep-mode runs the sync (#942)", () => {
  test("final ship: reports the move in cleaned + branchSync", async () => {
    const r = await handler({ branch: BRANCH, base: "main", cwd: CWD, keep: true });
    expect(r.kept).toBe(true);
    expect(r.branchSync.synced).toBe(true);
    expect(r.cleaned).toContain("branch-synced:main");
  });

  test("intermediate ship: no sync", async () => {
    const r = await handler({ branch: BRANCH, base: "feat/parent", cwd: CWD, keep: true });
    expect(r.branchSync).toEqual({ synced: false, reason: "intermediate" });
    expect(gitArgs).not.toHaveBeenCalled();
  });

  test("tree differs: a warning says why the branch stayed", async () => {
    repo({ baseTree: "t2" });
    const r = await handler({ branch: BRANCH, base: "main", cwd: CWD, keep: true });
    expect(r.warnings.some((w) => /tree differs/.test(w))).toBe(true);
  });
});
