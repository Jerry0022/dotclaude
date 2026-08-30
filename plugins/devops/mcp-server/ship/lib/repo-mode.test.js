import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { detectRepoMode, isGitRepo, refusesGitWrites } from "./repo-mode.js";

beforeEach(() => {
  vi.resetAllMocks();
});

/**
 * Drive the probe sequence by git args:
 *   1. rev-parse --is-inside-work-tree
 *   2. rev-parse --show-toplevel
 *   3. remote get-url origin
 * `undefined` in the spec means "this probe throws".
 */
function mockGit(spec = {}) {
  // `in` checks, not default parameters: an explicitly passed `undefined` must
  // mean "this probe throws", which a default value would silently override.
  const answers = {
    "rev-parse --is-inside-work-tree": "insideWorkTree" in spec ? spec.insideWorkTree : "true",
    "rev-parse --show-toplevel": "toplevel" in spec ? spec.toplevel : "/repo",
    "remote get-url origin": "origin" in spec ? spec.origin : "git@example.com:x/y.git",
  };
  execFileSync.mockImplementation((_bin, args) => {
    const key = args.join(" ");
    const answer = answers[key];
    if (answer === undefined) throw new Error(`fatal: ${key}`);
    return answer;
  });
}

describe("detectRepoMode", () => {
  test("returns 'none' when rev-parse throws (not a git repo)", () => {
    mockGit({ insideWorkTree: undefined });
    expect(detectRepoMode("/some/dir")).toBe("none");
  });

  test("returns 'none' when rev-parse PRINTS false (inside .git / bare repo)", () => {
    // Exits 0 but prints "false" — an exit-code-only check misread this as a
    // normal work tree.
    mockGit({ insideWorkTree: "false" });
    expect(detectRepoMode("/repo/.git")).toBe("none");
  });

  test("returns 'git' when cwd is the repo root and origin exists", () => {
    mockGit({ toplevel: "/repo" });
    expect(detectRepoMode("/repo")).toBe("git");
  });

  test("returns 'git-no-remote' when cwd is the repo root but origin is missing", () => {
    mockGit({ toplevel: "/local-only", origin: undefined });
    expect(detectRepoMode("/local-only")).toBe("git-no-remote");
  });

  test("returns 'git-foreign-root' for a directory nested under someone else's repo", () => {
    // The ancestor-awareness bug: /outer is a repo, /outer/sub/notgit is not a
    // project of its own, and cleanup used to write into /outer.
    mockGit({ toplevel: "/outer" });
    expect(detectRepoMode("/outer/sub/notgit")).toBe("git-foreign-root");
  });

  test("foreign-root wins over the remote probe (origin never consulted)", () => {
    mockGit({ toplevel: "/outer", origin: undefined });
    expect(detectRepoMode("/outer/sub/notgit")).toBe("git-foreign-root");
    const probed = execFileSync.mock.calls.map((c) => c[1].join(" "));
    expect(probed).not.toContain("remote get-url origin");
  });

  test("tolerates a trailing separator on the repo root", () => {
    mockGit({ toplevel: "/repo/" });
    expect(detectRepoMode("/repo")).toBe("git");
  });

  test("passes cwd to git commands", () => {
    mockGit({ toplevel: "/specific/cwd" });
    detectRepoMode("/specific/cwd");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "/specific/cwd" }),
    );
  });

  test("bounds every probe with a timeout", () => {
    mockGit({ toplevel: "/repo" });
    detectRepoMode("/repo");
    for (const call of execFileSync.mock.calls) {
      expect(call[2].timeout).toBeGreaterThan(0);
    }
  });
});

describe("isGitRepo", () => {
  test("returns true for 'git' mode", () => {
    mockGit({ toplevel: "/repo" });
    expect(isGitRepo("/repo")).toBe(true);
  });

  test("returns true for 'git-no-remote' mode", () => {
    mockGit({ toplevel: "/local", origin: undefined });
    expect(isGitRepo("/local")).toBe(true);
  });

  test("returns true for 'git-foreign-root' — it is still a work tree", () => {
    mockGit({ toplevel: "/outer" });
    expect(isGitRepo("/outer/sub")).toBe(true);
  });

  test("returns false for 'none' mode", () => {
    mockGit({ insideWorkTree: undefined });
    expect(isGitRepo("/not-a-repo")).toBe(false);
  });
});

describe("refusesGitWrites", () => {
  test("refuses when there is no repo or the repo root is foreign", () => {
    expect(refusesGitWrites("none")).toBe(true);
    expect(refusesGitWrites("git-foreign-root")).toBe(true);
  });

  test("allows the two modes that own their repo root", () => {
    expect(refusesGitWrites("git")).toBe(false);
    expect(refusesGitWrites("git-no-remote")).toBe(false);
  });
});
