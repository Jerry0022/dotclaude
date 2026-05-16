import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { detectRepoMode, isGitRepo } from "./repo-mode.js";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("detectRepoMode", () => {
  test("returns 'none' when rev-parse throws (not a git repo)", () => {
    execFileSync.mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });
    expect(detectRepoMode("/some/dir")).toBe("none");
  });

  test("returns 'git' when both rev-parse and remote get-url succeed", () => {
    execFileSync.mockReturnValue("");
    expect(detectRepoMode("/repo")).toBe("git");
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  test("returns 'git-no-remote' when rev-parse succeeds but remote get-url throws", () => {
    let callCount = 0;
    execFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return "";
      throw new Error("fatal: No such remote 'origin'");
    });
    expect(detectRepoMode("/local-only")).toBe("git-no-remote");
  });

  test("passes cwd to git commands", () => {
    execFileSync.mockReturnValue("");
    detectRepoMode("/specific/cwd");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      expect.objectContaining({ cwd: "/specific/cwd" }),
    );
  });
});

describe("isGitRepo", () => {
  test("returns true for 'git' mode", () => {
    execFileSync.mockReturnValue("");
    expect(isGitRepo("/repo")).toBe(true);
  });

  test("returns true for 'git-no-remote' mode", () => {
    let callCount = 0;
    execFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return "";
      throw new Error("no remote");
    });
    expect(isGitRepo("/local")).toBe(true);
  });

  test("returns false for 'none' mode", () => {
    execFileSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(isGitRepo("/not-a-repo")).toBe(false);
  });
});
