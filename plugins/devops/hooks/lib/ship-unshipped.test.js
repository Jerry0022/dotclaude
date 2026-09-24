import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { hasUnshippedWork } = require("./ship-unshipped.js");

// "promote stable" on a branch with nothing unshipped is a promotion-only
// do-ship run, and prompt.ship.detect spares it the careful-compact stop.
// The check compares CONTENT, so a squash-merged branch reads as shipped.
let root;
let origin;
let work;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commit(cwd, file, content, msg) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-unshipped-"));
  origin = path.join(root, "origin.git");
  work = path.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "main");
  commit(work, "a.txt", "one\n", "init");
  git(work, "push", "-q", "-u", "origin", "main");
  git(work, "remote", "set-head", "origin", "main");
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("hasUnshippedWork", () => {
  test("main in sync with origin → nothing unshipped", () => {
    expect(hasUnshippedWork(work)).toBe(false);
  });

  test("an untracked file is not work to ship", () => {
    fs.writeFileSync(path.join(work, "scratch.txt"), "x");
    expect(hasUnshippedWork(work)).toBe(false);
  });

  test("a tracked, uncommitted change is unshipped", () => {
    fs.writeFileSync(path.join(work, "a.txt"), "two\n");
    expect(hasUnshippedWork(work)).toBe(true);
  });

  test("a branch commit not on main is unshipped", () => {
    git(work, "checkout", "-q", "-b", "feat/x");
    commit(work, "b.txt", "b\n", "feat");
    expect(hasUnshippedWork(work)).toBe(true);
  });

  test("a branch whose work landed by SQUASH merge reads as shipped", () => {
    git(work, "checkout", "-q", "-b", "feat/x");
    commit(work, "b.txt", "b\n", "feat 1");
    commit(work, "b.txt", "b2\n", "feat 2");
    // squash the branch onto main on the remote, as a GitHub squash merge would
    git(work, "checkout", "-q", "main");
    git(work, "merge", "-q", "--squash", "feat/x");
    git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "squash");
    git(work, "push", "-q", "origin", "main");
    git(work, "checkout", "-q", "feat/x");
    git(work, "fetch", "-q", "origin");
    expect(hasUnshippedWork(work)).toBe(false);
  });

  test("any git failure answers true (the compact stop stays in place)", () => {
    const fail = () => { throw new Error("boom"); };
    expect(hasUnshippedWork(work, { git: fail })).toBe(true);
    expect(hasUnshippedWork(path.join(root, "does-not-exist"))).toBe(true);
  });

  test("no origin → true", () => {
    const lone = path.join(root, "lone");
    fs.mkdirSync(lone);
    git(lone, "init", "-q");
    commit(lone, "a.txt", "x", "init");
    expect(hasUnshippedWork(lone)).toBe(true);
  });
});
