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

  test("workspace.ownWorktree: never ask, move — and relocate this session's own files", () => {
    const t = branchFix({ branch: "main", remote: true, mainCheckout: true, ownWorktree: true }).join("\n");
    expect(t).toContain("Call the EnterWorktree tool");
    expect(t).toContain("do NOT ask the user where to continue");
    expect(t).toContain("restart a running concept bridge");
    expect(t).not.toContain("Do not move, stash or restore them on your own");
    // undecided keeps the hands-off line
    expect(branchFix({ mainCheckout: true }).join("\n")).toContain("Do not move, stash or restore them on your own");
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

  test("workspace.ownWorktree in the project's devops-config reaches the block message (both guards)", () => rootOnMain(() => {
    const cfg = join(mainDir, ".claude", "devops-config.json");
    writeFileSync(cfg, JSON.stringify({ workspace: { ownWorktree: true } }));
    try {
      const r = edit(mainDir, join(mainDir, "a.txt"));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("do NOT ask the user where to continue");
      const c = commit(mainDir);
      expect(c.status).toBe(2);
      expect(c.stderr).toContain("do NOT ask the user where to continue");
    } finally { rmSync(cfg, { force: true }); }
  }), TIMEOUT);

  test("a root file whose name starts with '..' is inside the repo, not outside it", () => rootOnMain(() => {
    const r = edit(mainDir, join(mainDir, "..env.local"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("EnterWorktree");
  }), TIMEOUT);

  test("a new file (Write) in the main checkout is blocked too", () => rootOnMain(() => {
    const r = run(EDIT, { tool_name: "Write", cwd: mainDir, tool_input: { file_path: join(mainDir, "new", "deep", "n.txt") } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("new/deep/n.txt");
  }), TIMEOUT);

  test("R1: a moved session editing a main-checkout path is blocked and pointed at its own worktree path", () => rootOnMain(() => {
    const r = edit(featDir, join(mainDir, "a.txt"));
    expect(r.status).toBe(2);
    const own = featDir.replace(/\\/g, "/");
    expect(r.stderr).toContain(`you work in your own worktree ${own}`);
    expect(r.stderr).toContain(`(${own}/a.txt)`);
    // Already in a worktree: no second EnterWorktree, no branch switch.
    expect(r.stderr).not.toContain("Call the EnterWorktree tool");
    expect(r.stderr).not.toMatch(/git (fetch origin && git )?switch -c/);
  }), TIMEOUT);

  test("R7: from the main checkout, a path in another session's worktree on main is not 'your own'", () => {
    const r = edit(mainDir, join(onMainDir, "a.txt"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("another session's worktree");
    expect(r.stderr).toContain("do not edit it or switch its branch");
    expect(r.stderr).not.toContain("switching its branch is safe");
    expect(r.stderr).toContain("Call the EnterWorktree tool");
  }, TIMEOUT);

  test("a moved session's own worktree path passes", () => rootOnMain(() => {
    expect(edit(featDir, join(featDir, "src", "new.txt")).status).toBe(0);
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

  test("the bypass line never invites an inline env var or a write around the block", () => rootOnMain(() => {
    for (const r of [edit(mainDir, join(mainDir, "a.txt")), commit(mainDir)]) {
      expect(r.stderr).toContain("only the user enables it");
      expect(r.stderr).toContain(".claude/settings.local.json");
      expect(r.stderr).toContain("Never set it yourself and never write the file another way");
      expect(r.stderr).not.toContain("for this single");
    }
  }), TIMEOUT);

  test("DEVOPS_ALLOW_MAIN=1 (the Home Assistant exception) still passes", () => rootOnMain(() => {
    expect(edit(mainDir, join(mainDir, "a.txt"), {}, { DEVOPS_ALLOW_MAIN: "1" }).status).toBe(0);
  }), TIMEOUT);

  test("a subagent gets the report-to-parent remedy", () => rootOnMain(() => {
    const r = edit(mainDir, join(mainDir, "a.txt"), { agent_id: "agent-1" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("do NOT create a worktree");
  }), TIMEOUT);
});

describe("pre.worktree.split-guard", () => {
  const SPLIT = join(HERE, "pre.worktree.split-guard.js");
  const split = (cwd) => spawnSync(process.execPath, [SPLIT], {
    input: JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command: "git commit -m x" } }),
    encoding: "utf8", timeout: 30_000,
  });

  test("the warning reaches the model as additionalContext (stderr of an exit-0 hook is invisible)", () => {
    const r = split(mainDir);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("split-guard");
    expect(out.hookSpecificOutput.additionalContext).toContain("worktrees/feat");
  }, TIMEOUT);

  test("inside the linked worktree it stays silent", () => {
    expect(split(featDir).stdout).toBe("");
  }, TIMEOUT);
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

  // #828: deleting non-default remote branches writes neither local nor remote main.
  const cmdOnMain = (command) => run(MAIN, { tool_name: "Bash", cwd: mainDir, tool_input: { command } });
  test.each([
    "git push origin --delete feat/x",
    "git push origin -d a b",
    "git push origin :feat/x",
    "git -C . push origin --delete x",
  ])("main checkout: %j passes", (command) => rootOnMain(() => {
    expect(cmdOnMain(command).status).toBe(0);
  }), TIMEOUT);

  test.each([
    "git push origin --delete main",
    "git push origin :master",
    "git push origin --delete feat/x main",
    "git push origin main",
    "git push --force origin --delete feat/x",
    "git push origin --delete foo && git commit -m x",
  ])("main checkout: %j stays blocked", (command) => rootOnMain(() => {
    expect(cmdOnMain(command).status).toBe(2);
  }), TIMEOUT);
});

// Audit row 1: the guards matched only `^git <sub>`, so a chained commit,
// `git -C <dir> commit`, `git -c k=v commit` and every PowerShell-tool command
// slipped through. Quoted text that merely mentions a commit must still pass.
describe("pre.main.guard — chained, global options, PowerShell", () => {
  const onMain = (command, tool = "Bash") => run(MAIN, { tool_name: tool, cwd: onMainDir, tool_input: { command } });

  test.each([
    ["git add -A && git commit -m x"],
    ["git add -A; git commit -m x"],
    ["git status || git commit -m x"],
    ["git -C . commit -m x"],
    ['git -C "some dir" commit -m x'],
    ["git -c user.name=x -c user.email=y commit -m x"],
    ["git --no-pager -C . push origin main"],
    ["GIT_AUTHOR_NAME=x git commit -m x"],
    ["echo hi\ngit commit -m x"],
    ["git checkout -- a.txt"],
  ])("blocks %j on main", (command) => {
    expect(onMain(command).status).toBe(2);
  }, TIMEOUT);

  test("the PowerShell tool is guarded too", () => {
    const r = onMain("git add -A; git commit -m x", "PowerShell");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("[pre.main.guard] BLOCKED");
  }, TIMEOUT);

  test.each([
    ['echo "then run git add -A && git commit -m x"'],
    ["git log --grep 'git commit'"],
    ['gh issue create --body "remember: git -C . commit"'],
    ["cat <<'EOF'\ngit commit -m x\nEOF"],
    ["git status && git diff"],
    ["git -C . log -1"],
  ])("lets %j pass (a mention, or read-only)", (command) => {
    expect(onMain(command).status).toBe(0);
    expect(onMain(command, "PowerShell").status).toBe(0);
  }, TIMEOUT);

  test("other tools stay out of scope", () => {
    expect(onMain("git commit -m x", "Read").status).toBe(0);
  }, TIMEOUT);
});

describe("pre.worktree.split-guard — chained, global options, PowerShell", () => {
  const SPLIT = join(HERE, "pre.worktree.split-guard.js");
  const split = (command, tool = "Bash") => spawnSync(process.execPath, [SPLIT], {
    input: JSON.stringify({ tool_name: tool, cwd: mainDir, tool_input: { command } }),
    encoding: "utf8", timeout: 30_000,
  });

  test.each([
    ["git add -A && git commit -m x", "Bash"],
    ["git -C . commit -m x", "Bash"],
    ["git -c core.hooksPath=x merge feat/x", "Bash"],
    ["git add -A; git switch -c topic", "PowerShell"],
  ])("warns on %j (%s)", (command, tool) => {
    const r = split(command, tool);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("split-guard");
  }, TIMEOUT);

  test.each([
    ['echo "git add -A && git commit -m x"'],
    ["git log --grep 'git commit'"],
  ])("stays silent on the mention %j", (command) => {
    expect(split(command).stdout).toBe("");
  }, TIMEOUT);
});
