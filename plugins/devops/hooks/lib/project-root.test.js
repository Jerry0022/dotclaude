import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findRepoRoot, projectRoot, projectClaudeDir } from "./project-root.js";

let tmp;

/** Real `git init` — the anchor must agree with `git rev-parse --show-toplevel`. */
function gitRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  return dir;
}

function toplevel(cwd) {
  return path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim());
}

function same(a, b) {
  const na = path.resolve(a), nb = path.resolve(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "project-root-test-")));
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("projectRoot — .claude/ state is anchored at the work-tree root, never the cwd", () => {
  test("a subdirectory cwd resolves to the repo root (matches git --show-toplevel)", () => {
    const root = gitRepo(path.join(tmp, "repo"));
    const sub = path.join(root, "plugins", "devops", "scripts");
    fs.mkdirSync(sub, { recursive: true });
    expect(same(projectRoot(sub), root)).toBe(true);
    expect(same(projectRoot(sub), toplevel(sub))).toBe(true);
    expect(same(projectClaudeDir(sub), path.join(root, ".claude"))).toBe(true);
  });

  test("the root itself resolves to itself", () => {
    const root = gitRepo(path.join(tmp, "repo"));
    expect(same(projectRoot(root), root)).toBe(true);
  });

  test("a linked worktree (.git is a FILE) anchors at the worktree, not the main checkout", () => {
    const main = gitRepo(path.join(tmp, "main"));
    execFileSync("git", ["-C", main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { stdio: "ignore" });
    const wt = path.join(tmp, "wt");
    execFileSync("git", ["-C", main, "worktree", "add", "-q", wt], { stdio: "ignore" });
    const sub = path.join(wt, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);
    expect(same(projectRoot(sub), wt)).toBe(true);
    expect(same(projectRoot(sub), toplevel(sub))).toBe(true);
  });

  test("outside any repo it falls back to the cwd itself", () => {
    const plain = path.join(tmp, "plain", "sub");
    fs.mkdirSync(plain, { recursive: true });
    expect(findRepoRoot(plain)).toBeNull();
    expect(same(projectRoot(plain), plain)).toBe(true);
  });

  test("a dotfiles repo in the home dir does not capture unrelated folders below it", () => {
    const home = gitRepo(path.join(tmp, "home"));
    const folder = path.join(home, "Downloads", "stuff");
    fs.mkdirSync(folder, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(home);
    expect(same(projectRoot(folder), folder)).toBe(true);
    expect(same(projectRoot(home), home)).toBe(true);
  });

  test("no cwd argument means process.cwd()", () => {
    expect(same(projectRoot(), projectRoot(process.cwd()))).toBe(true);
  });
});
