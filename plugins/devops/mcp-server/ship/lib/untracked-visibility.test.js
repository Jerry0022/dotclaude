import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { dirtyState, gitTry } from "./git.js";
import { worktreeDirty } from "./worktree.js";

// AUD-C013: under `status.showUntrackedFiles=no` a plain `git status
// --porcelain` lists no new file, so the clean-tree gate passed and release
// staging dropped them. Real git in a temp repo — the config is what matters.

let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "untracked-vis-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-qm", "init");
  git("config", "status.showUntrackedFiles", "no");
  fs.mkdirSync(path.join(dir, "src", "new"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "new", "module.js"), "export {};\n");
});

afterAll(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
});

describe("new files stay visible under status.showUntrackedFiles=no (AUD-C013)", () => {
  test("the config really hides them from plain porcelain", () => {
    expect(git("status", "--porcelain")).toBe("");
  });

  test("dirtyState reports the file itself, not just its directory", () => {
    const st = dirtyState({ cwd: dir });
    expect(st.dirty).toBe(true);
    expect(st.untracked).toEqual(["src/new/module.js"]);
  });

  test("worktreeDirty counts it", () => {
    expect(worktreeDirty(dir)).toMatchObject({ dirty: true, changes: 1 });
  });
});

describe("gitTry (AUD-C014)", () => {
  test("passes a metacharacter name verbatim and answers null instead of running it", () => {
    expect(gitTry(["rev-parse", "--verify", "-q", "refs/heads/x&echo pwned"], { cwd: dir })).toBeNull();
    expect(gitTry(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir })).toBe("main");
  });
});
