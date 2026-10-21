import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
const require = createRequire(import.meta.url);
const { materializeRef } = require("./command.js");

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const variantDir = (m) => m.pluginDir.replace(/[\\/]plugins[\\/]devops$/, "");
let repo;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ab-mat-test-"));
  git(["init", "-q", "-b", "main"], repo);
  git(["config", "user.email", "t@example.com"], repo);
  git(["config", "user.name", "t"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", "init"], repo);
});
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

const registered = () => git(["worktree", "list", "--porcelain"], repo).match(/^worktree /gm).length;

describe("materializeRef cleanup", () => {
  it("cleanup() removes the worktree and the registration, and is idempotent", () => {
    const m = materializeRef("HEAD", { repoRoot: repo });
    expect(registered()).toBe(2);
    m.cleanup();
    m.cleanup();
    expect(registered()).toBe(1);
    expect(fs.existsSync(variantDir(m))).toBe(false);
  });

  it("a failed worktree add leaves nothing registered", () => {
    expect(() => materializeRef("no-such-ref", { repoRoot: repo })).toThrow();
    expect(registered()).toBe(1);
    expect(git(["worktree", "list", "--porcelain"], repo)).not.toMatch(/ab-variant-/);
  });

  it("a locked 'initializing' registration is unlocked and pruned by cleanup", () => {
    const m = materializeRef("HEAD", { repoRoot: repo });
    git(["worktree", "lock", "--reason", "initializing", variantDir(m)], repo);
    m.cleanup();
    expect(registered()).toBe(1);
    expect(fs.existsSync(variantDir(m))).toBe(false);
  });
});
