import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { strandedBranch, leftBehindBranches } = require("./stranded-branch.js");
const { strandedWarning } = require("../../hooks/lib/session-archive-gate.js");

/** #951: pushed branch + content not in main + no open PR. All git in temp repos, gh injected. */
const tmp = [];
const mk = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); tmp.push(d); return d; };
afterEach(() => { while (tmp.length) try { fs.rmSync(tmp.pop(), { recursive: true, force: true }); } catch { /* temp */ } });

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
function commit(cwd, file, content) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "c");
  return git(cwd, "rev-parse", "HEAD");
}

/** origin + clone; branch `fix/x` (one commit, pushed) and the clone back on main. */
function setup({ push = true } = {}) {
  const dir = mk("stranded-");
  const bare = mk("stranded-origin-");
  git(bare, "init", "-q", "--bare");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  commit(dir, "a.txt", "a\n");
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");
  git(dir, "checkout", "-q", "-b", "fix/x");
  const tip = commit(dir, "x.txt", "x\n");
  if (push) git(dir, "push", "-q", "origin", "fix/x");
  git(dir, "checkout", "-q", "main");
  git(dir, "fetch", "-q", "origin");
  git(dir, "remote", "set-head", "origin", "main");
  return { dir, bare, tip };
}
const noPr = () => [];

describe("strandedBranch", () => {
  test("pushed, content missing from main, no PR → stranded", () => {
    const { dir, tip } = setup();
    expect(strandedBranch(dir, "fix/x", { prs: noPr })).toEqual({ branch: "fix/x", sha: tip, commits: 1 });
  });

  test("an open PR, or a merged PR with this very head, is not stranded", () => {
    const { dir, tip } = setup();
    expect(strandedBranch(dir, "fix/x", { prs: () => [{ number: 1, state: "OPEN", headRefOid: tip }] })).toBeNull();
    expect(strandedBranch(dir, "fix/x", { prs: () => [{ number: 1, state: "MERGED", headRefOid: tip }] })).toBeNull();
    expect(strandedBranch(dir, "fix/x", { prs: () => [{ number: 1, state: "CLOSED", headRefOid: tip }] })).not.toBeNull();
  });

  test("gh unavailable → silent", () => {
    const { dir } = setup();
    expect(strandedBranch(dir, "fix/x", { prs: () => null })).toBeNull();
  });

  test("never pushed → not this finding", () => {
    const { dir } = setup({ push: false });
    expect(strandedBranch(dir, "fix/x", { prs: noPr })).toBeNull();
  });

  test("content already in main (squash merge under another commit) → not stranded", () => {
    const { dir } = setup();
    fs.writeFileSync(path.join(dir, "x.txt"), "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "squash of fix/x");
    git(dir, "push", "-q", "origin", "main");
    expect(strandedBranch(dir, "fix/x", { prs: noPr })).toBeNull();
  });

  test("the default branch and odd names are never stranded", () => {
    const { dir } = setup();
    expect(strandedBranch(dir, "main", { prs: noPr })).toBeNull();
    expect(strandedBranch(dir, "HEAD", { prs: noPr })).toBeNull();
    expect(strandedBranch(dir, "--help", { prs: noPr })).toBeNull();
  });
});

describe("leftBehindBranches", () => {
  test("a stranded branch the work tree switched away from is found by the reflog", () => {
    const { dir } = setup();
    git(dir, "checkout", "-q", "fix/x");
    git(dir, "checkout", "-q", "-b", "other", "main");
    const left = leftBehindBranches(dir, "other", { prs: noPr });
    expect(left.map((s) => s.branch)).toEqual(["fix/x"]);
    expect(leftBehindBranches(dir, "other", { prs: () => [{ state: "OPEN" }] })).toEqual([]);
    expect(leftBehindBranches(dir, "fix/x", { prs: noPr })).toEqual([]);
  });
});

describe("strandedWarning (session-archive guard)", () => {
  test("warns about the session's own branch and names the work tree; never throws", () => {
    const { dir } = setup();
    git(dir, "checkout", "-q", "fix/x");
    const text = strandedWarning(dir, { prs: noPr });
    expect(text).toContain("fix/x");
    expect(text).toContain(dir);
    expect(text).toContain("not blocked");
    expect(strandedWarning(dir, { prs: () => null })).toBeNull();
    expect(strandedWarning(path.join(dir, "missing"), { prs: noPr })).toBeNull();
  });

  test("also warns about the branch the work tree left behind", () => {
    const { dir } = setup();
    git(dir, "checkout", "-q", "fix/x");
    git(dir, "checkout", "-q", "-b", "other", "main");
    expect(strandedWarning(dir, { prs: noPr, budgetMs: 600000 })).toContain("fix/x");
  });

  test("a branch with an open PR gives no warning", () => {
    const { dir } = setup();
    git(dir, "checkout", "-q", "fix/x");
    expect(strandedWarning(dir, { prs: () => [{ number: 1, state: "OPEN" }] })).toBeNull();
  });
});
