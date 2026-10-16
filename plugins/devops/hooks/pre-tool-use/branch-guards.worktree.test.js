import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * The main-branch guards in a checkout several sessions share.
 *
 * Fixture: a bare `origin`, its main checkout (`main`, on main) and two
 * linked worktrees under `main/.claude/worktrees/` — `feat` on a feature
 * branch and `onmain`, a linked worktree that sits on main itself — plus an
 * unrelated repo on main. The hooks run as real processes against it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const EDIT = join(HERE, "pre.edit.branch.js");
const MAIN = join(HERE, "pre.main.guard.js");
const require = createRequire(import.meta.url);
const { branchFix } = require("../lib/branch-fix.js");

const TIMEOUT = 120_000;
let root, mainDir, featDir, onMainDir, otherDir;

function git(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function run(hook, payload, env = {}) {
  const e = { ...process.env, ...env };
  if (!("DEVOPS_ALLOW_MAIN" in env)) delete e.DEVOPS_ALLOW_MAIN;
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload), encoding: "utf8", env: e, timeout: 30_000,
  });
  return { status: r.status, stderr: r.stderr || "" };
}

const edit = (cwd, file, extra = {}, env) => run(EDIT, { tool_name: "Edit", cwd, tool_input: { file_path: file }, ...extra }, env);
const commit = (cwd, extra = {}, env) => run(MAIN, { tool_name: "Bash", cwd, tool_input: { command: "git commit -m x" }, ...extra }, env);

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "bguard-")));
  const origin = join(root, "origin.git");
  git(["init", "-q", "--bare", "-b", "main", origin], root);
  mainDir = join(root, "main");
  mkdirSync(mainDir);
  git(["init", "-q", "-b", "main", "."], mainDir);
  git(["config", "user.email", "t@example.com"], mainDir);
  git(["config", "user.name", "Test"], mainDir);
  writeFileSync(join(mainDir, "a.txt"), "one\n");
  git(["add", "."], mainDir);
  git(["commit", "-qm", "c1"], mainDir);
  git(["remote", "add", "origin", origin], mainDir);
  git(["push", "-q", "origin", "main"], mainDir);
  featDir = join(mainDir, ".claude", "worktrees", "feat");
  git(["worktree", "add", "-q", "-b", "feat/x", featDir, "main"], mainDir);
  onMainDir = join(mainDir, ".claude", "worktrees", "onmain");
  git(["worktree", "add", "-q", "--detach", onMainDir, "main"], mainDir);
  // A linked worktree that holds main — main itself is checked out in the
  // root, so point the root at a side branch first, then give main away.
  git(["switch", "-q", "-c", "side"], mainDir);
  git(["-C", onMainDir, "switch", "-q", "main"], mainDir);
  otherDir = join(root, "other");
  mkdirSync(otherDir);
  git(["init", "-q", "-b", "main", "."], otherDir);
  git(["config", "user.email", "t@example.com"], otherDir);
  git(["config", "user.name", "Test"], otherDir);
  writeFileSync(join(otherDir, "o.txt"), "o\n");
  git(["add", "."], otherDir);
  git(["commit", "-qm", "o1"], otherDir);
}, TIMEOUT);

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** The root checkout back on main (some tests need it there). */
function rootOnMain(fn) {
  git(["-C", onMainDir, "switch", "-q", "--detach"], mainDir);
  git(["switch", "-q", "main"], mainDir);
  try { return fn(); } finally {
    git(["switch", "-q", "side"], mainDir);
    git(["-C", onMainDir, "switch", "-q", "main"], mainDir);
  }
}

describe("branchFix text", () => {
  test("main checkout: EnterWorktree, never a branch switch of the shared checkout", () => {
    const t = branchFix({ branch: "main", remote: true, mainCheckout: true, relPath: "src\\a.js" }).join("\n");
    expect(t).toContain("EnterWorktree");
    expect(t).toContain("counts as the instruction to work in a worktree");
    expect(t).toContain('ToolSearch "select:EnterWorktree"');
    expect(t).toContain("from origin/main");
    expect(t).toContain(".claude/worktrees/<name>/src/a.js");
    expect(t).not.toMatch(/Fix: git (fetch origin && git )?switch -c/);
    expect(t).not.toContain("git stash");
    expect(t).toContain("ask the user");
  });

  test("main checkout without origin names the local base", () => {
    const t = branchFix({ branch: "master", remote: false, mainCheckout: true }).join("\n");
    expect(t).toContain("from local master");
    expect(t).not.toContain("origin/master");
  });

  test("linked worktree keeps git switch -c", () => {
    expect(branchFix({ branch: "main", remote: true, mainCheckout: false }).join("\n"))
      .toContain("git fetch origin && git switch -c <feat/topic> origin/main");
    const local = branchFix({ branch: "main", remote: false, mainCheckout: false }).join("\n");
    expect(local).toContain("git switch -c <feat/topic>");
    expect(local).not.toContain("origin/");
    expect(local).not.toContain("git fetch");
  });

  test("a subagent is told to report, not to create a worktree", () => {
    const t = branchFix({ mainCheckout: true, subagent: true }).join("\n");
    expect(t).toContain("do NOT create a worktree");
    expect(t).toContain("report to the parent");
    expect(t).not.toContain("Call the EnterWorktree tool");
  });
});

describe("pre.edit.branch", () => {
  test("main checkout on main → blocked with the EnterWorktree remedy", () => rootOnMain(() => {
    const r = edit(mainDir, join(mainDir, "a.txt"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("EnterWorktree");
    expect(r.stderr).toContain(".claude/worktrees/<name>/a.txt");
    expect(r.stderr).not.toMatch(/Fix: git (fetch origin && git )?switch -c/);
  }), TIMEOUT);

  test("a new file (Write) in the main checkout is blocked too", () => rootOnMain(() => {
    const r = run(EDIT, { tool_name: "Write", cwd: mainDir, tool_input: { file_path: join(mainDir, "new", "deep", "n.txt") } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("new/deep/n.txt");
  }), TIMEOUT);

  test("R1: a session in its worktree that edits a main-checkout path is still blocked", () => rootOnMain(() => {
    const r = edit(featDir, join(mainDir, "a.txt"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("EnterWorktree");
  }), TIMEOUT);

  test("an edit inside a feature worktree passes — from the worktree and from the main checkout", () => rootOnMain(() => {
    expect(edit(featDir, join(featDir, "a.txt")).status).toBe(0);
    expect(edit(mainDir, join(featDir, "a.txt")).status).toBe(0);
  }), TIMEOUT);

  test("a linked worktree on main gets git switch -c, not EnterWorktree", () => {
    const r = edit(onMainDir, join(onMainDir, "a.txt"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git fetch origin && git switch -c <feat/topic> origin/main");
    expect(r.stderr).not.toContain("Call the EnterWorktree tool");
  }, TIMEOUT);

  test("a file in another repository stays out of scope", () => rootOnMain(() => {
    expect(edit(mainDir, join(otherDir, "o.txt")).status).toBe(0);
    expect(edit(featDir, join(otherDir, "o.txt")).status).toBe(0);
  }), TIMEOUT);

  test("files outside any repo stay out of scope", () => {
    expect(edit(featDir, join(root, "loose.txt")).status).toBe(0);
  }, TIMEOUT);

  test("DEVOPS_ALLOW_MAIN=1 (the Home Assistant exception) still passes", () => rootOnMain(() => {
    expect(edit(mainDir, join(mainDir, "a.txt"), {}, { DEVOPS_ALLOW_MAIN: "1" }).status).toBe(0);
  }), TIMEOUT);

  test("a subagent gets the report-to-parent remedy", () => rootOnMain(() => {
    const r = edit(mainDir, join(mainDir, "a.txt"), { agent_id: "agent-1" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("do NOT create a worktree");
  }), TIMEOUT);
});

describe("pre.main.guard", () => {
  test("main checkout on main → blocked with the EnterWorktree remedy", () => rootOnMain(() => {
    const r = commit(mainDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("[pre.main.guard] Fix: Call the EnterWorktree tool");
    expect(r.stderr).not.toMatch(/Fix: git (fetch origin && git )?switch -c/);
  }), TIMEOUT);

  test("a linked worktree on main keeps git switch -c", () => {
    const r = commit(onMainDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git fetch origin && git switch -c <feat/topic> origin/main");
  }, TIMEOUT);

  test("a feature worktree passes", () => {
    expect(commit(featDir).status).toBe(0);
  }, TIMEOUT);

  test("DEVOPS_ALLOW_MAIN=1 still passes", () => rootOnMain(() => {
    expect(commit(mainDir, {}, { DEVOPS_ALLOW_MAIN: "1" }).status).toBe(0);
  }), TIMEOUT);
});
