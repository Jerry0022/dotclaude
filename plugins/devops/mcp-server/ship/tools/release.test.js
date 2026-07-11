import { describe, test, expect, vi, beforeEach } from "vitest";

// zod is a runtime dependency of the MCP server (installed where the server
// runs) but is not a devDependency of this repo, so the test environment can't
// resolve it. The handler never invokes the schema — only the MCP registration
// does — so a minimal chainable stub is enough to load the module.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node, enum: () => node, number: () => node } };
});

// Mock node:child_process so the optional commit path (execFileSync) never
// shells out to a real git during tests. The mocked git.js / github.js below
// cover every other process call.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => ""),
  execSync: vi.fn(() => ""),
}));

vi.mock("../lib/repo-mode.js", () => ({
  detectRepoMode: vi.fn(() => "git"),
}));

vi.mock("../lib/git.js", () => ({
  git: vi.fn(() => ""),
  gitStrict: vi.fn(() => ""),
  currentBranch: vi.fn(() => "feature-x"),
  headShort: vi.fn(() => "abc1234"),
  dirtyState: vi.fn(() => ({ dirty: false, modified: [], untracked: [], lines: [] })),
  isWorktree: vi.fn(() => false),
  isRebasedOnto: vi.fn(() => true),
  fileOverlap: vi.fn(() => ({ mergeBase: "base", branchFiles: [], baseFiles: [], overlap: [] })),
  syncLocalBranch: vi.fn(() => ({ updated: true, method: "fetch-refspec" })),
  treeOf: vi.fn((ref) => (ref === "HEAD" ? "T1" : "T1")),
}));

vi.mock("../lib/github.js", () => ({
  createPR: vi.fn(() => ({ number: 42, url: "https://example.com/pull/42" })),
  mergePR: vi.fn(() => "merge12"),
  createRelease: vi.fn(() => undefined),
  findExistingPR: vi.fn(() => null),
  watchPRChecks: vi.fn(() => ({ status: "passed", checks: [] })),
}));

import { handler } from "./release.js";
import * as gitLib from "../lib/git.js";
import * as ghLib from "../lib/github.js";

function params(overrides = {}) {
  return {
    base: "main",
    title: "feat: thing",
    body: "## Summary\nCloses #1",
    tag: "v1.0.0",
    releaseNotes: "notes",
    prerelease: false,
    commitMessage: null,
    mergeStrategy: "squash",
    skipChecks: false,
    checksTimeoutSec: 600,
    cwd: "/repo",
    ...overrides,
  };
}

// All `gitStrict` invocations that fetch the base branch, with their global
// invocation order — used to prove the pre-merge re-check fetches a FRESH
// origin/base before re-checking (the load-bearing #207 ordering invariant).
function fetchBaseCalls() {
  return gitLib.gitStrict.mock.calls
    .map((c, i) => ({ cmd: c[0], order: gitLib.gitStrict.mock.invocationCallOrder[i] }))
    .filter((x) => typeof x.cmd === "string" && /^fetch origin main\b/.test(x.cmd));
}

function pushCall() {
  return gitLib.gitStrict.mock.calls.find(
    (c) => typeof c[0] === "string" && c[0].startsWith("push "),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore the default happy-path implementations (detectRepoMode lives on the
  // repo-mode mock and keeps its factory default through clearAllMocks).
  gitLib.currentBranch.mockReturnValue("feature-x");
  gitLib.headShort.mockReturnValue("abc1234");
  gitLib.dirtyState.mockReturnValue({ dirty: false, modified: [], untracked: [], lines: [] });
  gitLib.isWorktree.mockReturnValue(false);
  gitLib.isRebasedOnto.mockReturnValue(true);
  gitLib.fileOverlap.mockReturnValue({ mergeBase: "base", branchFiles: [], baseFiles: [], overlap: [] });
  gitLib.syncLocalBranch.mockReturnValue({ updated: true, method: "fetch-refspec" });
  // Distinct-but-equal trees keyed by ref → postMergeTreeMatch is true ONLY when
  // the code looks up the two correct refs (HEAD and origin/main), not by accident.
  gitLib.treeOf.mockImplementation((ref) => (ref === "HEAD" ? "T1" : "T1"));
  // ls-remote --tags returns the alpha channel tag → tag already exists, skip creation path.
  gitLib.git.mockImplementation((cmd) =>
    cmd.includes("ls-remote --tags") ? "abc\trefs/tags/alpha/v1.0.0" : "remoteSha",
  );
  gitLib.gitStrict.mockReturnValue("");
  ghLib.findExistingPR.mockReturnValue(null);
  ghLib.createPR.mockReturnValue({ number: 42, url: "https://example.com/pull/42" });
  ghLib.mergePR.mockReturnValue("merge12");
  ghLib.watchPRChecks.mockReturnValue({ status: "passed", checks: [] });
});

describe("ship_release — #207 parallel-change data-loss guards", () => {
  test("REGRESSION: base advancing during the CI-checks wait blocks the merge", async () => {
    // Phase-1 entry gate passes; Phase-2 pre-merge re-check fails — simulates a
    // parallel ship landing on main while we waited for CI checks.
    gitLib.isRebasedOnto.mockReturnValueOnce(true).mockReturnValueOnce(false);
    gitLib.fileOverlap.mockReturnValue({
      mergeBase: "base",
      branchFiles: ["a.js"],
      baseFiles: ["b.js"],
      overlap: [],
    });

    const res = await handler(params());

    expect(res.success).toBe(false);
    expect(res.rebaseRequired).toBe(true);
    expect(res.baseAdvancedDuringChecks).toBe(true);
    // The merge MUST NOT have happened — that is the whole point of #207.
    expect(ghLib.mergePR).not.toHaveBeenCalled();
    expect(res.error).toMatch(/no longer up to date|advanced/i);

    // The re-check must observe FRESH data: a second `fetch origin main` must
    // precede the second isRebasedOnto. Without this, a refactor could drop the
    // re-check's fetch and silently re-introduce the stale-ref overwrite vector.
    const fetches = fetchBaseCalls();
    expect(fetches.length).toBe(2);
    expect(fetches[1].order).toBeLessThan(gitLib.isRebasedOnto.mock.invocationCallOrder[1]);
  });

  test("REGRESSION: re-check survives the skipChecks bypass (hot-fix path)", async () => {
    // Hot-fix bypass skips the CI wait — but is exactly when a human is rushing
    // and a parallel ship is most likely to have landed. The Phase-2 re-check
    // MUST still fire. Guards against a refactor folding it into the checks block.
    gitLib.isRebasedOnto.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const res = await handler(params({ skipChecks: true }));

    expect(res.checks.status).toBe("skipped");
    expect(res.success).toBe(false);
    expect(res.baseAdvancedDuringChecks).toBe(true);
    expect(ghLib.mergePR).not.toHaveBeenCalled();
    expect(fetchBaseCalls().length).toBe(2);
  });

  test("REGRESSION: Phase-1 entry gate blocks a non-rebased branch before any push/PR/merge", async () => {
    // Both gates would fail — but Phase 1 must catch it FIRST, before push.
    // baseAdvancedDuringChecks stays undefined (the discriminator between the
    // two gates), and nothing reaches the network-mutating steps.
    gitLib.isRebasedOnto.mockReturnValue(false);

    const res = await handler(params());

    expect(res.success).toBe(false);
    expect(res.rebaseRequired).toBe(true);
    expect(res.baseAdvancedDuringChecks).toBeUndefined();
    expect(res.pushed).toBeUndefined();
    expect(pushCall()).toBeUndefined();
    expect(ghLib.createPR).not.toHaveBeenCalled();
    expect(ghLib.mergePR).not.toHaveBeenCalled();
    // Only the entry-gate fetch ran — the re-check is never reached.
    expect(fetchBaseCalls().length).toBe(1);
  });

  test("checks gate failure blocks the merge (fail-closed)", async () => {
    ghLib.watchPRChecks.mockReturnValue({
      status: "failed",
      checks: [],
      failed: [{ name: "build", link: "https://example.com/run/1" }],
      pending: [],
      error: "1 check(s) failed: build",
    });

    const res = await handler(params());

    expect(res.success).toBe(false);
    expect(res.checksBlocked).toBe(true);
    expect(ghLib.mergePR).not.toHaveBeenCalled();
    // Blocked before the re-check — only the entry-gate fetch ran.
    expect(fetchBaseCalls().length).toBe(1);
  });

  test("probe-error on checks is fail-closed (treated as block-worthy)", async () => {
    ghLib.watchPRChecks.mockReturnValue({ status: "probe-error", error: "gh auth failed" });

    const res = await handler(params());

    expect(res.success).toBe(false);
    expect(res.checksBlocked).toBe(true);
    expect(ghLib.mergePR).not.toHaveBeenCalled();
  });

  test("existing CONFLICTING PR is refused before merge", async () => {
    ghLib.findExistingPR.mockReturnValue({ number: 7, url: "https://example.com/pull/7", mergeable: "CONFLICTING" });

    const res = await handler(params());

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/CONFLICTING/);
    expect(ghLib.createPR).not.toHaveBeenCalled();
    expect(ghLib.mergePR).not.toHaveBeenCalled();
  });

  test("happy path: rebased at both gates → merge proceeds, tree matches the two correct refs", async () => {
    const res = await handler(params());

    expect(res.success).toBe(true);
    expect(res.merged).toBe("main");
    expect(ghLib.mergePR).toHaveBeenCalledTimes(1);
    // Both gates ran: entry + re-check.
    expect(gitLib.isRebasedOnto).toHaveBeenCalledTimes(2);
    expect(fetchBaseCalls().length).toBe(2);
    // The post-merge guard compares the two CORRECT, distinct refs (not HEAD↔HEAD).
    expect(gitLib.treeOf).toHaveBeenCalledWith("HEAD", expect.anything());
    expect(gitLib.treeOf).toHaveBeenCalledWith("origin/main", expect.anything());
    expect(res.postMergeTreeMatch).toBe(true);
    expect(res.postMergeWarning).toBeUndefined();
  });

  test("post-merge tree mismatch surfaces a non-fatal warning (parallel non-overlap merge)", async () => {
    // HEAD tree differs from origin/main tree after merge → a concurrent ship was
    // three-way merged in. The ship still succeeded (changes preserved), but the
    // skill is told to verify consistency.
    gitLib.treeOf.mockImplementation((ref) => (ref === "HEAD" ? "tree-head" : "tree-base"));

    const res = await handler(params());

    expect(res.success).toBe(true);
    expect(res.postMergeTreeMatch).toBe(false);
    expect(res.postMergeWarning).toMatch(/does not match|consistent/i);
  });

  test("a null tree (rev-parse failure) yields a non-fatal mismatch warning, not a false match", async () => {
    gitLib.treeOf.mockReturnValue(null);

    const res = await handler(params());

    expect(res.success).toBe(true);
    expect(res.postMergeTreeMatch).toBe(false);
    expect(res.postMergeWarning).toBeTruthy();
  });

  test("push uses an explicit lease pinned to the remote sha (not a bare lease)", async () => {
    await handler(params());

    const push = pushCall();
    expect(push).toBeDefined();
    expect(push[0]).toContain("--force-with-lease=feature-x:remoteSha");
  });

  test("brand-new branch (no remote-tracking ref) falls back to a bare lease", async () => {
    gitLib.git.mockImplementation((cmd) => {
      if (cmd.includes("ls-remote --tags")) return "abc\trefs/tags/v1.0.0";
      if (cmd.includes("rev-parse --verify --quiet")) return null; // no remote branch yet
      return "";
    });

    await handler(params());

    const push = pushCall();
    expect(push[0]).toContain("--force-with-lease");
    expect(push[0]).not.toContain("--force-with-lease=");
  });
});

describe("ship_release — alpha channel tagging (ring model)", () => {
  test("creates annotated alpha/<tag> on origin/base, pushes, defers the GitHub Release", async () => {
    // First ls-remote (existence check) → empty; post-push verify → tag present.
    let lsCalls = 0;
    gitLib.git.mockImplementation((cmd) => {
      if (cmd.includes("ls-remote --tags")) {
        lsCalls += 1;
        return lsCalls === 1 ? "" : "abc\trefs/tags/alpha/v1.0.0";
      }
      return "remoteSha";
    });

    const res = await handler(params());

    expect(res.success).toBe(true);
    expect(res.tag).toBe("alpha/v1.0.0");
    expect(res.channel).toBe("alpha");
    expect(res.tagVerified).toBe(true);
    // Annotated tag with channel payload, created on the merge commit.
    const { execFileSync } = await import("node:child_process");
    const tagCall = execFileSync.mock.calls.find((c) => c[0] === "git" && c[1][0] === "tag");
    expect(tagCall).toBeDefined();
    expect(tagCall[1]).toEqual([
      "tag", "-a", "alpha/v1.0.0", "origin/main", "-m",
      expect.stringContaining('"channel":"alpha"'),
    ]);
    // No Release at ship time — promotion owns Releases (spec §3.1).
    expect(ghLib.createRelease).not.toHaveBeenCalled();
    expect(res.releaseDeferred).toBe(true);
  });

  test("existing alpha tag on remote → skip creation, still verified", async () => {
    const res = await handler(params());
    expect(res.tagVerified).toBe(true);
    expect(res.tagWarning).toMatch(/alpha\/v1\.0\.0 already exists/);
    const { execFileSync } = await import("node:child_process");
    expect(execFileSync.mock.calls.find((c) => c[0] === "git" && c[1]?.[0] === "tag")).toBeUndefined();
  });

  test("intermediate merge still skips tagging entirely", async () => {
    const res = await handler(params({ base: "feat/parent" }));
    expect(res.tag).toBeNull();
    expect(res.tagSkipped).toMatch(/intermediate/);
    expect(ghLib.createRelease).not.toHaveBeenCalled();
  });
});
