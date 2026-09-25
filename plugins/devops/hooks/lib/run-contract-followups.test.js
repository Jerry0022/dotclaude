/**
 * Audit follow-ups (2026-09-25-run-contract-followups): AUD-010, AUD-012,
 * AUD-023, AUD-025. AUD-019/031 (git budget wiring) and AUD-020 (triage
 * description matcher) are covered in pre.run.contract.test.js /
 * run-contract.test.js / run-contract.redteam.test.js instead — this file
 * groups the findings whose fixtures don't fit those existing suites.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const RC = require("./run-contract.js");
const { cli } = require("./run-contract-cli.js");
const P = require("../pre-tool-use/pre.run.contract.js");
const C = require("./run-contract-calls.js");
const postMod = require("../post-tool-use/post.run.contract.js");

let dir;
const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-followups-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".claude/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function runCli(...args) {
  let out = null;
  const code = cli(args, { cwd: dir, out: (o) => { out = o; } });
  return { code, out };
}

// ── AUD-010 ──────────────────────────────────────────────────────────────

describe("AUD-010: CLI status / done measure qa like the gate", () => {
  // status uses the release gate — qa there is diffed against `main`, not
  // the working tree, so the changed file needs a commit on a branch (the
  // gate's own H-C3 fixtures do the same).
  const commitOnBranch = (name, files = ["a.js"]) => {
    git("checkout", "-q", "-b", name);
    for (const n of files) fs.writeFileSync(path.join(dir, n), "1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "x");
  };

  test("done refuses while qa is owed; status shows the measured count", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "manual", passes: [], presence: false });
    RC.record(dir, { k: "skill", name: "auto-agents" });
    RC.record(dir, { k: "edit" });
    commitOnBranch("fix/1"); // one code file changed vs main → backlog qa threshold (n>=1)

    const s = runCli("status");
    expect(s.out.qa).toBe(1);
    expect(s.out.open.map((o) => o.ob)).toContain("qa");

    const d = runCli("done");
    expect(d.code).toBe(1);
    expect(d.out.error).toContain("qa");
  });

  test("qa satisfied by a devops:qa agent → done closes normally", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "manual", passes: [], presence: false });
    RC.record(dir, { k: "skill", name: "auto-agents" });
    RC.record(dir, { k: "edit" });
    commitOnBranch("fix/2");
    RC.record(dir, { k: "agent", type: "devops:qa" });

    expect(runCli("done").out).toMatchObject({ ok: true, closed: true });
  });

  test("no code changed → qa never blocks; status reports 0, not null", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "manual", passes: [], presence: false });
    RC.record(dir, { k: "skill", name: "auto-agents" });
    RC.record(dir, { k: "edit" });
    const s = runCli("status");
    expect(s.out.qa).toBe(0);
    expect(s.out.open).toEqual([]);
    expect(runCli("done").out).toMatchObject({ ok: true, closed: true });
  });
});

// ── AUD-012 ──────────────────────────────────────────────────────────────

describe("AUD-012: an `analysis` card closes an AUDIT run without being gated", () => {
  test("pre.run.contract never refuses an analysis card, even with obligations open", () => {
    RC.arm(dir, { mode: "audit", flow: "interactive", ship: "manual", passes: ["harden", "polish"] });
    RC.record(dir, { k: "edit" }); // work, but harden/polish never ran
    const hook = {
      cwd: dir, session_id: "s1", hook_event_name: "PreToolUse",
      tool_name: "mcp__plugin_devops_dotclaude-completion__render_completion_card",
      tool_input: { variant: "analysis" },
    };
    const res = require("node:child_process").spawnSync(process.execPath, [require.resolve("../pre-tool-use/pre.run.contract.js")], {
      input: JSON.stringify(hook), cwd: dir, encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stderr || "").toBe("");
  });

  test("post.run.contract closes an audit run on an analysis card", () => {
    RC.arm(dir, { mode: "audit", flow: "interactive", ship: "manual", passes: [] });
    postMod.recordCard(dir, "analysis", false, RC, {});
    expect(RC.readContract(dir)).toBeNull();
  });

  test("an analysis card never closes a prompt / backlog run", () => {
    RC.arm(dir, { mode: "prompt", flow: "interactive", ship: "manual", passes: [] });
    postMod.recordCard(dir, "analysis", false, RC, {});
    expect(RC.readContract(dir)).not.toBeNull();
  });
});

// ── AUD-025 ──────────────────────────────────────────────────────────────

describe("AUD-025: a GitHub MCP merge_pull_request is recorded as a release", () => {
  const MERGE = "mcp__plugin_github_github__merge_pull_request";

  test("post.run.contract records `release` and closes a finished backlog item", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: [], presence: false, items: ["9"] });
    const hook = {
      cwd: dir, session_id: "s1", hook_event_name: "PostToolUse", tool_name: MERGE,
      tool_input: { owner: "o", repo: "r", pullNumber: 9, commit_title: "Closes #9" },
      tool_response: { merged: true, message: "Pull Request successfully merged", sha: "abc123" },
    };
    postMod.main(hook);
    const evs = RC.events(dir);
    const rel = evs.filter((e) => e.k === "release").pop();
    expect(rel).toMatchObject({ ok: true, closes: ["9"] });
    expect(RC.readContract(dir)).toBeNull(); // the only queued item shipped → backlog closes
  });

  test("a merge that did not actually merge records ok:false, never closes", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: [], presence: false, items: ["9"] });
    const hook = {
      cwd: dir, session_id: "s1", hook_event_name: "PostToolUse", tool_name: MERGE,
      tool_input: { owner: "o", repo: "r", pullNumber: 9 },
      tool_response: { merged: false, message: "Pull Request is not mergeable" },
    };
    postMod.main(hook);
    const rel = RC.events(dir).filter((e) => e.k === "release").pop();
    expect(rel).toMatchObject({ ok: false });
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("pre.run.contract still gates the same call as a release under ship: auto", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: [], presence: false, items: ["9"] });
    RC.record(dir, { k: "skill", name: "auto-agents" });
    RC.record(dir, { k: "edit" });
    const hook = { cwd: dir, session_id: "s1", hook_event_name: "PreToolUse", tool_name: MERGE, tool_input: { pullNumber: 9 } };
    const res = require("node:child_process").spawnSync(process.execPath, [require.resolve("../pre-tool-use/pre.run.contract.js")], {
      input: JSON.stringify(hook), cwd: dir, encoding: "utf8",
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("BLOCKED at release");
  });
});

// ── AUD-023 ──────────────────────────────────────────────────────────────

describe("AUD-023: the release gate's git cost on a real multi-file diff", () => {
  test("resolveBase + codeFilesChanged spawn exactly 3 git processes (a deterministic cost budget, not a timing)", () => {
    git("checkout", "-q", "-b", "feat");
    fs.mkdirSync(path.join(dir, "src"));
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, "src", `f${i}.js`), `// ${i}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", "60 files");
    // A real clone's default-branch pointer without a fetched origin/main —
    // the common shallow / single-branch clone shape: resolveBase's
    // symbolic-ref succeeds, the first diff attempt (origin/main...HEAD)
    // fails, codeFilesChanged falls back to main...HEAD (H-C3).
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    // Spy on the shared git helpers (gitOut for resolveBase, gitLines for
    // codeFilesChanged) rather than execFileSync directly — Vitest's module
    // runner does not guarantee the same child_process object identity
    // across an ESM test file's require() and the hook's, but C.gitOut /
    // C.gitLines are the exact functions pre.run.contract.js calls.
    const gitOutSpy = vi.spyOn(C, "gitOut");
    const gitLinesCalls = [];
    const gitLinesSpy = (...args) => { gitLinesCalls.push(args); return C.gitLines(...args); };

    const base = P.resolveBase(dir, undefined, C);
    const n = P.codeFilesChanged(dir, "release", base, gitLinesSpy);
    // Read the count before mockRestore() — it also mockClear()s the history.
    const totalGitSpawns = gitOutSpy.mock.calls.length + gitLinesCalls.length;
    gitOutSpy.mockRestore();

    expect(base).toBe("main");
    expect(n).toBe(60); // the spawn count does not depend on the file count (the audit measured 3 on 301 files)
    // Static analysis (AUD-023 finding): symbolic-ref (resolveBase) + the
    // failed origin/main...HEAD diff + the main...HEAD fallback that succeeds.
    expect(totalGitSpawns).toBe(3);
    // No wall-time assertion: under a loaded machine the same 3 spawns took
    // seconds (#502). The measured numbers live in the design spec's Limits.
  }, 120_000);
});
