import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setupProject } = require("./ss.project.setup.js");
const { BLOCK_START } = require("../lib/runtime-ignores.js");

const tmp = [];
function mkTmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop(), { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

function initRepo({ commit = true, gitignore = true } = {}) {
  const dir = mkTmp("ps-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  if (gitignore) fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  if (commit) {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
  }
  return dir;
}

const excludeOf = (repo) => fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");

describe("ss.project.setup — runtime files stay out of git via .git/info/exclude", () => {
  test("writes the block once; the plugin's runtime files vanish from status, config does not", () => {
    const repo = initRepo();
    const home = mkTmp("ps-home-");
    expect(setupProject({ cwd: repo, home }).exclude).toBe("written");
    expect(setupProject({ cwd: repo, home }).exclude).toBe("current");
    expect(excludeOf(repo).split("\n").filter((l) => l.startsWith(BLOCK_START))).toHaveLength(1);

    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "batch.md"), "x");
    fs.writeFileSync(path.join(repo, ".claude", "devops-config.json"), "{}");
    fs.writeFileSync(path.join(repo, ".claude", "settings.json"), "{}");
    const status = git(repo, "status", "--porcelain", "--untracked-files=all");
    expect(status).not.toContain("batch.md");
    expect(status).not.toContain("devops-config.json");
    expect(status).toContain(".claude/settings.json");
  });

  test("a linked worktree writes into the shared common dir, never into the worktree", () => {
    const repo = initRepo();
    const home = mkTmp("ps-home-");
    const wt = path.join(repo, ".claude", "worktrees", "w1");
    git(repo, "worktree", "add", "-q", "-b", "w1", wt);
    expect(setupProject({ cwd: wt, home }).exclude).toBe("written");
    expect(excludeOf(repo)).toContain(".claude/batch.md");
    fs.mkdirSync(path.join(wt, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".claude", "batch-mode.json"), "{}");
    expect(git(wt, "status", "--porcelain", "--untracked-files=all")).not.toContain("batch-mode.json");
  });

  test("outside a git work tree it does nothing", () => {
    const dir = mkTmp("ps-plain-");
    expect(setupProject({ cwd: dir, home: mkTmp("ps-home-") })).toEqual({ exclude: null, offer: null });
  });
});

describe("ss.project.setup — one-time setup offer in a new repository", () => {
  test("a repo without a commit gets the offer once per clone", () => {
    const repo = initRepo({ commit: false });
    const home = mkTmp("ps-home-");
    const first = setupProject({ cwd: repo, home, pluginRoot: "/plugin" });
    expect(first.offer).toContain("no commit yet");
    expect(first.offer).toContain("/plugin/deep-knowledge/project-setup.md");
    expect(first.offer).toMatch(/Do not run it unasked/);
    expect(setupProject({ cwd: repo, home }).offer).toBeNull();
  });

  test("a repo with commits but no .gitignore gets it too", () => {
    const repo = initRepo({ gitignore: false });
    expect(setupProject({ cwd: repo, home: mkTmp("ps-home-") }).offer).toContain("no .gitignore");
  });

  test("an established repo gets no offer", () => {
    const repo = initRepo();
    expect(setupProject({ cwd: repo, home: mkTmp("ps-home-") }).offer).toBeNull();
  });
});
