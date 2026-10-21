import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const CLI = path.join(__dirname, "integration-check.js");
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (cwd, extra) => JSON.parse(execFileSync("node", [CLI, "--cwd", cwd, "--integration", "main", "--sub", "feat-core", "--remove", ...extra], { encoding: "utf8" }));

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ic-cli-test-"));
  const repo = path.join(root, "repo");
  const wt = path.join(root, "wt");
  fs.mkdirSync(repo);
  git(["init", "-q", "-b", "main"], repo);
  git(["config", "user.email", "t@example.com"], repo);
  git(["config", "user.name", "t"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", "init"], repo);
  git(["worktree", "add", "-q", "-b", "feat-core", wt], repo);
  fs.writeFileSync(path.join(wt, "b.txt"), "b");
  git(["add", "-A"], wt);
  git(["commit", "-q", "-m", "work"], wt);
  git(["merge", "--no-ff", "-q", "-m", "merge", "feat-core"], repo);
  return { root, repo, wt };
}

describe("integration-check --remove --now", () => {
  it("a just-merged, clean sub worktree is kept by the idle rule but removed with --now", () => {
    const { root, repo, wt } = setup();
    try {
      expect(run(repo, []).removed).toEqual([]);
      expect(fs.existsSync(wt)).toBe(true);
      expect(run(repo, ["--now"]).removed.length).toBe(1);
      expect(fs.existsSync(wt)).toBe(false);
      expect(git(["branch", "--list", "feat-core"], repo)).toBe("");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 60000);

  it("--now still refuses an unlanded sub branch", () => {
    const { root, repo, wt } = setup();
    try {
      fs.writeFileSync(path.join(wt, "c.txt"), "c");
      git(["add", "-A"], wt);
      git(["commit", "-q", "-m", "more"], wt);
      expect(run(repo, ["--now"]).removed).toEqual([]);
      expect(fs.existsSync(wt)).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 60000);
});
