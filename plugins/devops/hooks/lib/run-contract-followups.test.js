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
const Q = require("./run-contract-qa.js");
const C = require("./run-contract-calls.js");
const postMod = require("../post-tool-use/post.run.contract.js");
const OB = require("./run-contract-obligations.js");
const A = require("./run-contract-answers.js");

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

    const base = Q.resolveBase(dir, undefined, C);
    const n = Q.codeFilesChanged(dir, "release", base, gitLinesSpy);
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

// ── red-team round 2 (2026-09-25-run-contract-followups) ──────────────────

describe("R2 Q1: fixFor('triage') names the pinned pre-triage agent description", () => {
  test("hints the exact backlog.md Step 2.1 format so a blocked model can satisfy it", () => {
    const hint = OB.fixFor({ mode: "backlog" }, "triage", []);
    expect(hint).toContain("Triage #<N> — <title>");
  });
});

describe("R2 Q1: the triage format pinned in backlog.md satisfies the gate end to end", () => {
  // Read from the skill doc itself, so a reworded Step 2.1 fails here
  // instead of silently leaving every backlog run stuck at the triage gate.
  const pinned = () => {
    const doc = fs.readFileSync(new URL("../../skills/do-run/modes/backlog.md", import.meta.url), "utf8");
    const m = doc.match(/pinned form `([^`]+)`/);
    expect(m, "backlog.md Step 2.1 no longer pins the pre-triage description").not.toBeNull();
    return m[1];
  };

  test("fixFor('triage') hints exactly the documented format", () => {
    expect(OB.fixFor({ mode: "backlog" }, "triage", [])).toContain(pinned());
  });

  test("an Agent call titled in that format, recorded by post.run.contract, clears triage", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "auto", passes: [], items: ["12"] });
    RC.record(dir, { k: "skill", name: "auto-agents" });
    const open = () => RC.openObligations(RC.readContract(dir), RC.events(dir), "card").map((o) => o.ob);
    expect(open()).toContain("triage");
    const description = pinned().replace("<N>", "12").replace("<title>", "Fix the login redirect");
    postMod.main({
      cwd: dir, session_id: "s1", hook_event_name: "PostToolUse", tool_name: "Agent",
      tool_input: { subagent_type: "Explore", description, prompt: "classify #12" },
      tool_response: {},
    });
    expect(open()).not.toContain("triage");
  });
});

describe("R2 Q2: an implement-mode audit's analysis card must not close before work", () => {
  test("no work yet + auditResult 'implement' → the card is recorded but the run stays open", () => {
    RC.arm(dir, { mode: "audit", flow: "interactive", ship: "manual", passes: [], auditResult: "implement" });
    postMod.recordCard(dir, "analysis", false, RC, {});
    expect(RC.readContract(dir)).not.toBeNull();
  });

  test("work done + nothing open + auditResult 'implement' → the card still closes", () => {
    RC.arm(dir, { mode: "audit", flow: "interactive", ship: "manual", passes: [], auditResult: "implement" });
    RC.record(dir, { k: "edit" });
    postMod.recordCard(dir, "analysis", false, RC, {});
    expect(RC.readContract(dir)).toBeNull();
  });

  test("no work yet + auditResult 'concept' (unaffected) → the card still closes as before", () => {
    RC.arm(dir, { mode: "audit", flow: "interactive", ship: "manual", passes: [], auditResult: "concept" });
    postMod.recordCard(dir, "analysis", false, RC, {});
    expect(RC.readContract(dir)).toBeNull();
  });
});

describe("R2 Q2: parseFollowUp maps the exact do-run 'Ergebnis' labels to auditResult", () => {
  const q = [{ header: "Ergebnis", question: "Ergebnis" }];
  test.each([
    ["Audit umsetzen (Recommended)", "implement"], // SKILL.md F1
    ["Audit als Concept", "concept"], // SKILL.md F1
    ["Audit + Umsetzung (Recommended)", "implement"], // modes/audit.md Q2 (de)
    ["Audit + implementation (Recommended)", "implement"], // modes/audit.md Q2 (en)
    ["Audit als DevOps-Concept", "concept"], // modes/audit.md Q2 (de)
    ["Audit as DevOps concept", "concept"], // modes/audit.md Q2 (en)
  ])("%s → %s", (label, expected) => {
    const patch = A.parseFollowUp(q, { Ergebnis: label });
    expect(patch.auditResult).toBe(expected);
  });
});

describe("R2 Q5: a budget-cut transcript walk must not arm from an incomplete answer", () => {
  test("linesBackward sets stats.stoppedOnBudget only when the budget (not the file end) stopped it", () => {
    const file = path.join(dir, "transcript.jsonl");
    fs.writeFileSync(file, "line one\nline two\nline three\n");
    const expiredBudget = { expired: () => true };
    const stoppedStats = {};
    expect([...C.linesBackward(file, { budget: expiredBudget, stats: stoppedStats })]).toEqual([]);
    expect(stoppedStats.stoppedOnBudget).toBe(true);

    const openStats = {};
    const lines = [...C.linesBackward(file, { budget: { expired: () => false }, stats: openStats })];
    expect(lines.length).toBeGreaterThan(0);
    expect(openStats.stoppedOnBudget).toBeFalsy();
  });

  test("routerFromTranscript propagates stoppedOnBudget through the info out-param", () => {
    const file = path.join(dir, "transcript.jsonl");
    fs.writeFileSync(file, "not json\n");
    const info = {};
    C.routerFromTranscript(file, null, RC, { expired: () => true }, info);
    expect(info.stoppedOnBudget).toBe(true);
  });

  test("armFromPending returns null and keeps the marker when the walk was cut short", () => {
    const fakeRC = {
      pendingArm: () => ({ at: "2026-01-01T00:00:00.000Z", args: "", sessionId: "s1" }),
      readContract: () => null,
      clearPendingArm: vi.fn(),
      arm: vi.fn(() => ({ id: "x" })),
      parseRouterAnswers: vi.fn(),
      applyFollowUp: vi.fn(),
      answeredFields: vi.fn(),
    };
    const fakeC = {
      routerFromTranscript: (transcriptPath, sinceIso, rc, budget, info) => {
        if (info) info.stoppedOnBudget = true;
        return null;
      },
    };
    const result = P.armFromPending({ transcript_path: "/fake" }, dir, fakeRC, fakeC, "s1", {});
    expect(result).toBeNull();
    expect(fakeRC.clearPendingArm).not.toHaveBeenCalled();
    expect(fakeRC.arm).not.toHaveBeenCalled();
  });
});

describe("R2 Q6: the corrupt/expiry notice survives an exit-2 (BLOCKED) call", () => {
  test("a refused call's stderr still carries the one-shot notice", () => {
    // A corrupt header quarantines to run-contract.json.corrupt.pending and
    // leaves the notice queued (R5); arm a fresh contract with an open
    // obligation so the very same call also hits a gate and exits 2.
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "manual", passes: [], presence: false });
    fs.writeFileSync(path.join(dir, ".claude", "run-contract.json.corrupt.pending"), "");
    // auto-agents deliberately never ran → the commit gate is open.
    const hook = {
      cwd: dir, session_id: "s1", hook_event_name: "PreToolUse",
      tool_name: "Bash", tool_input: { command: "git commit -m x" },
    };
    const res = require("node:child_process").spawnSync(process.execPath, [require.resolve("../pre-tool-use/pre.run.contract.js")], {
      input: JSON.stringify(hook), cwd: dir, encoding: "utf8",
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("BLOCKED at commit");
  });
});

describe("R2 Q9: originMatches also accepts a fork's upstream remote", () => {
  test("origin is the fork, upstream is the real repo → a merge into upstream still matches", () => {
    git("remote", "add", "origin", "https://github.com/me/fork.git");
    git("remote", "add", "upstream", "git@github.com:acme/real.git");
    expect(C.originMatches(dir, "acme", "real")).toBe(true);
  });

  test("neither origin nor any other remote matches → still dropped", () => {
    git("remote", "add", "origin", "https://github.com/me/fork.git");
    expect(C.originMatches(dir, "someone-else", "other-repo")).toBe(false);
  });
});

describe("R2 Q10: a defensive `done` without an active contract must not fail", () => {
  test("no active contract → exit 0, ok:true, closed:false", () => {
    const d = runCli("done");
    expect(d.code).toBe(0);
    expect(d.out).toEqual({ ok: true, closed: false, reason: "no active contract" });
  });

  test("an active contract with open obligations and no --reason still refuses (unchanged)", () => {
    RC.arm(dir, { mode: "backlog", flow: "autonomous", ship: "manual", passes: [], presence: false });
    RC.record(dir, { k: "edit" }); // auto-agents never ran → open at the card gate
    const d = runCli("done");
    expect(d.code).toBe(1);
    expect(d.out.error).toContain("auto-agents");
  });
});
