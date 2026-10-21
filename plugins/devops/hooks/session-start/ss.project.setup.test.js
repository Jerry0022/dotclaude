import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const { setupProject, versionTag } = require("./ss.project.setup.js");
const { BLOCK_START, BLOCK_END } = require("../lib/runtime-ignores.js");

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

const gitignoreOf = (repo) => fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
const blocks = (text) => text.split("\n").filter((l) => l.startsWith(BLOCK_START)).length;

describe("ss.project.setup — the managed block lives in .gitignore; info/exclude only as the pre-migrate fallback", () => {
  test("a repo without a commit gets the block once; runtime files vanish from status, config does not", () => {
    const repo = initRepo({ commit: false });
    const home = mkTmp("ps-home-");
    const excludeBefore = fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
    expect(setupProject({ cwd: repo, home }).gitignore).toBe("written");
    expect(setupProject({ cwd: repo, home }).gitignore).toBe("current");
    expect(blocks(gitignoreOf(repo))).toBe(1);
    expect(gitignoreOf(repo)).toContain("node_modules/");
    expect(fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8")).toBe(excludeBefore);

    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "batch.md"), "x");
    fs.writeFileSync(path.join(repo, ".claude", "devops-config.json"), "{}");
    fs.writeFileSync(path.join(repo, ".claude", "settings.local.json"), "{}");
    fs.writeFileSync(path.join(repo, ".claude", "settings.json"), "{}");
    const status = git(repo, "status", "--porcelain", "--untracked-files=all");
    expect(status).not.toContain("batch.md");
    expect(status).not.toContain("devops-config.json");
    expect(status).not.toContain("settings.local.json");
    expect(status).toContain(".claude/settings.json");
  });

  test("an established repo without the block keeps its .gitignore — the block goes into info/exclude as a fallback", () => {
    const repo = initRepo();
    const home = mkTmp("ps-home-");
    const before = gitignoreOf(repo);
    expect(setupProject({ cwd: repo, home }).gitignore).toBe("fallback");
    expect(setupProject({ cwd: repo, home }).gitignore).toBe("current");
    expect(gitignoreOf(repo)).toBe(before);
    const exclude = fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
    expect(blocks(exclude)).toBe(1);
    // a fresh clone is covered from its first session: runtime files stay out of status
    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "devops-config.json"), "{}");
    fs.writeFileSync(path.join(repo, ".claude", "settings.json"), "{}");
    const status = git(repo, "status", "--porcelain", "--untracked-files=all");
    expect(status).not.toContain("devops-config.json");
    expect(status).toContain(".claude/settings.json");
  });

  test("the fallback replaces the old plugin block in info/exclude and keeps the user's lines", () => {
    const repo = initRepo();
    const file = path.join(repo, ".git", "info", "exclude");
    fs.writeFileSync(file, "mine.txt\n# >>> devops-plugin runtime state >>>\n.claude/batch.md\n# <<< devops-plugin runtime state <<<\n");
    expect(setupProject({ cwd: repo, home: mkTmp("ps-home-") }).gitignore).toBe("fallback");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("mine.txt");
    expect(text).not.toContain("devops-plugin runtime state");
    expect(blocks(text)).toBe(1);
  });

  test("a stale block is rewritten in place, user lines around it survive", () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, ".gitignore"), `dist/\n\n${BLOCK_START}\n**/.claude/batch.md\n${BLOCK_END}\n\nlocal/\n`);
    expect(setupProject({ cwd: repo, home: mkTmp("ps-home-") }).gitignore).toBe("written");
    const text = gitignoreOf(repo);
    expect(blocks(text)).toBe(1);
    expect(text.startsWith("dist/\n")).toBe(true);
    expect(text.trimEnd().endsWith("local/")).toBe(true);
    expect(text).toContain("**/.claude/settings.local.json");
  });

  test("nothing is written while a merge is in progress", () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, ".gitignore"), `${BLOCK_START}\n${BLOCK_END}\n`);
    fs.writeFileSync(path.join(repo, ".git", "MERGE_HEAD"), "0".repeat(40) + "\n");
    expect(setupProject({ cwd: repo, home: mkTmp("ps-home-") }).gitignore).toBe("skipped");
  });

  test("a linked worktree writes its own .gitignore", () => {
    const repo = initRepo();
    fs.writeFileSync(path.join(repo, ".gitignore"), `${BLOCK_START}\n${BLOCK_END}\n`);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "block");
    const wt = path.join(mkTmp("ps-wt-"), "w1");
    git(repo, "worktree", "add", "-q", "-b", "w1", wt);
    expect(setupProject({ cwd: wt, home: mkTmp("ps-home-") }).gitignore).toBe("written");
    expect(gitignoreOf(wt)).toContain("**/.claude/batch.md");
    expect(blocks(gitignoreOf(repo))).toBe(1);
  });

  test("a git repo at ~/.claude (the home backup) is never touched", () => {
    const home = mkTmp("ps-home-");
    const dot = path.join(home, ".claude");
    fs.mkdirSync(dot);
    git(dot, "init", "-q", "-b", "main");
    expect(setupProject({ cwd: dot, home })).toEqual({ gitignore: null, offer: null });
    expect(fs.existsSync(path.join(dot, ".gitignore"))).toBe(false);
  });

  test("outside a git work tree it does nothing", () => {
    const dir = mkTmp("ps-plain-");
    expect(setupProject({ cwd: dir, home: mkTmp("ps-home-") })).toEqual({ gitignore: null, offer: null });
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

describe("version tag", () => {
  test("reads the manifest version into a parseable tag", () => {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname_, "..", "..", ".claude-plugin", "plugin.json"), "utf8")).version;
    expect(versionTag()).toBe(`[devops] version=${v}`);
    expect(versionTag(os.tmpdir())).toBeNull();
  });
});
