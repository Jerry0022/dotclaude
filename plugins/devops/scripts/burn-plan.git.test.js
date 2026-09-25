/**
 * Dry runs of the burn conveyor's git side against real throw-away repos —
 * no model, no tokens. Covers audit finding K2: after a hard stop the first
 * version checked only for commits, requeued from scratch and declared a
 * worktree with the agent's uncommitted work "safe to prune"
 * (`git merge-base --is-ancestor` is true for a branch with no commits).
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "burn-plan.js");
const NOW = "2026-09-25T10:00:00.000Z";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();

let tmp;
let repo;
let usageFile;
let calFile;

function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env, ...GIT_ENV,
      DEVOPS_BURN_USAGE_FILE: usageFile,
      DEVOPS_BURN_CALIBRATION: calFile,
      DEVOPS_BURN_NO_REFRESH: "1",
      DEVOPS_BURN_NOW: NOW,
      CLAUDE_SESSION_ID: "",
      CLAUDE_CODE_SESSION_ID: "ENV-S",
      ...extraEnv,
    },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* non-JSON output: json stays null */ }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

function writeUsage({ weeklyUsed = 70, weeklyResetMin = 30 * 60, sessionUsed = 10, sessionResetMin = 200, cached = false } = {}) {
  fs.writeFileSync(usageFile, JSON.stringify({
    timestamp: NOW, plan: "Max 20x",
    weekly: { pct: weeklyUsed, resetInMinutes: weeklyResetMin },
    session: { pct: sessionUsed, resetInMinutes: sessionResetMin },
    ...(cached ? { _cached: true } : {}),
  }));
}

/** Integration branch + one sub-branch in its own worktree. */
function worktreeFor(branch) {
  const wt = path.join(tmp, branch.replace(/\//g, "-"));
  git(repo, "worktree", "add", "-b", branch, wt, "burn/x");
  return wt;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-git-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "branch", "burn/x");
  usageFile = path.join(tmp, "usage-live.json");
  calFile = path.join(tmp, "burn-calibration.json");
  writeUsage();
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp cleanup is best effort */ }
});

describe("prune-check — only clean AND merged worktrees may go", () => {
  test("the K2 case: no commits but uncommitted work → keep (merge-base alone said 'safe')", () => {
    const wt = worktreeFor("burn/x-core-1");
    fs.writeFileSync(path.join(wt, "work.js"), "the only copy of an agent's work\n");
    // What the first version checked:
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", "burn/x-core-1", "burn/x"], { cwd: repo });
    expect(ancestor.status).toBe(0);
    const r = run(["prune-check", "--branch=burn/x-core-1", `--worktree=${wt}`, "--integration=burn/x"]);
    expect(r.code).toBe(1);
    expect(r.json.safe).toBe(false);
    expect(r.json.reasons.join(" ")).toMatch(/uncommitted/);
  });

  test("unmerged commits → keep; merged and clean → safe", () => {
    const wt = worktreeFor("burn/x-core-2");
    fs.writeFileSync(path.join(wt, "b.txt"), "b\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "feat: b");
    let r = run(["prune-check", "--branch=burn/x-core-2", `--worktree=${wt}`, "--integration=burn/x"]);
    expect(r.code).toBe(1);
    expect(r.json.commitsAhead).toBe(1);
    git(repo, "checkout", "-q", "burn/x");
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "burn/x-core-2");
    r = run(["prune-check", "--branch=burn/x-core-2", `--worktree=${wt}`, "--integration=burn/x"]);
    expect(r.code).toBe(0);
    expect(r.json.safe).toBe(true);
  });
});

describe("CLI lifecycle — init, gate, state, resume-check", () => {
  const queue = JSON.stringify([
    { id: "p0", task: "main task", size: "M", priority: "P0" },
    { id: "i1", task: "issue", size: "M", priority: "P2" },
  ]);

  test("init writes a v2 state; a second init refuses; --force archives the old one", () => {
    let r = run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x", "--session=S1"]);
    expect(r.code).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    expect(state.version).toBe(2);
    expect(state.status).toBe("running");
    expect(state.queue.map((t) => t.id)).toEqual(["p0", "i1"]);
    // BURN-* is git-excluded from the first write on — never swept into a commit
    expect(fs.readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8")).toMatch(/^\/BURN-\*$/m);
    expect(git(repo, "status", "--porcelain")).toBe("");
    r = run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    expect(r.code).toBe(1);
    expect(r.json.reason).toBe("open-run-exists");
    r = run(["init", `--queue=${queue}`, "--slug=y", "--integration-branch=burn/x", "--force"]);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(repo, "BURN-STATE.prev.json"))).toBe(true);
  });

  test("init refuses a plan without uplift and writes nothing", () => {
    writeUsage({ weeklyUsed: 88, weeklyResetMin: 20 * 60 });
    const big = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, size: "L", priority: i ? "P2" : "P0" })));
    const r = run(["init", `--queue=${big}`, "--slug=x", "--integration-branch=burn/x"]);
    expect(r.code).toBe(1);
    expect(r.json.plan.reason).toBe("no-uplift");
    expect(fs.existsSync(path.join(repo, "BURN-STATE.json"))).toBe(false);
  });

  test("gate claims, state agent records the agent, land moves it to done", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x", "--session=S1"]);
    let r = run(["gate"]);
    expect(r.json.decision).toBe("spawn");
    expect(r.json.task.id).toBe("p0");
    r = run(["state", "agent", "p0", "--agent-id=A1", "--agent=core", "--branch=burn/x-core-1"]);
    expect(r.json.inFlight).toBe(1);
    r = run(["state", "land", "p0", "--sha=abc1234"]);
    expect(r.json.done).toBe(1);
    const s = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    expect(s.done[0]).toMatchObject({ id: "p0", agentId: "A1", sha: "abc1234" });
  });

  test("a blind scraper: hold, hold, then blind mode — never a spawn on a cached number without the cap", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    writeUsage({ cached: true });
    expect(run(["gate"]).json.decision).toBe("hold");
    expect(run(["gate"]).json.decision).toBe("hold");
    const third = run(["gate"]).json;
    expect(third.decision).toBe("spawn");
    expect(third.blind).toBe(true);
  });

  test("resume-check --apply salvages a dirty worktree as a wip commit and requeues on its branch", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x", "--session=S1"]);
    run(["gate"]);
    const wt = worktreeFor("burn/x-core-1");
    run(["state", "agent", "p0", "--agent-id=A1", "--branch=burn/x-core-1", `--worktree=${wt}`]);
    fs.writeFileSync(path.join(wt, "half.js"), "half done when the limit hit\n");

    const r = run(["resume-check", "--apply", "--session=S-other"]);
    expect(r.code).toBe(0);
    const a = r.json.actions[0];
    expect(a.salvage).toBe(true);
    expect(a.salvaged.method).toBe("commit");
    expect(a.action).toBe("requeue-with-branch");
    expect(git(wt, "log", "-1", "--format=%s")).toMatch(/^wip\(burn\): salvage p0/);
    expect(git(wt, "status", "--porcelain")).toBe("");
    const s = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    expect(s.inFlight).toHaveLength(0);
    expect(s.queue[0]).toMatchObject({ id: "p0", branch: "burn/x-core-1" });
    // and now the worktree is still not prunable: the wip commit is not merged
    expect(run(["prune-check", "--branch=burn/x-core-1", `--worktree=${wt}`, "--integration=burn/x"]).code).toBe(1);
  });

  test("the session defaults to the one Claude Code exports ($CLAUDE_CODE_SESSION_ID)", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    run(["gate"]);
    run(["state", "agent", "p0", "--agent-id=A1"]);
    const s = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    expect(s.sessionId).toBe("ENV-S");
    expect(s.inFlight[0].sessionId).toBe("ENV-S");
    expect(run(["resume-check"]).json.actions[0].action).toBe("continue-agent");
  });

  test("session on a feature branch: init and state integration refuse main, master and origin's default", () => {
    git(repo, "checkout", "-q", "-b", "feat/session");
    let r = run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=main"]);
    expect(r.code).toBe(1);
    expect(r.json.reason).toBe("integration-branch-protected");
    expect(fs.existsSync(path.join(repo, "BURN-STATE.json"))).toBe(false);
    expect(run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=master"]).json.reason).toBe("integration-branch-protected");
    // a repo whose remote default is "trunk"
    git(repo, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    expect(run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=trunk"]).json.reason).toBe("integration-branch-protected");
    r = run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    expect(r.code).toBe(0);
    expect(run(["state", "integration", "--branch=main"]).json.reason).toBe("integration-branch-protected");
    r = run(["state", "integration", "--branch=feat/issue-12"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8")).integrationBranch).toBe("feat/issue-12");
  });

  test("session working on main by necessity: main is the session branch and may be the merge target", () => {
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    let r = run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=main"]);
    expect(r.code).toBe(0);
    // master is still above the session branch here — refused
    expect(run(["state", "integration", "--branch=master"]).json.reason).toBe("integration-branch-protected");
    r = run(["state", "integration", "--branch=main"]);
    expect(r.code).toBe(0);
  });

  test("salvage never commits onto a protected branch", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    run(["gate"]);
    git(repo, "branch", "master", "main");
    const wt = path.join(tmp, "wt-master");
    git(repo, "worktree", "add", wt, "master");
    run(["state", "agent", "p0", "--branch=master", `--worktree=${wt}`]);
    fs.writeFileSync(path.join(wt, "work.js"), "x\n");
    const a = run(["resume-check", "--apply"]).json.actions[0];
    expect(a.salvaged).toMatchObject({ ok: false });
    expect(a.salvaged.error).toMatch(/protected branch/);
    expect(git(wt, "log", "-1", "--format=%s")).toBe("init");
  });

  test("salvage stages the agent's work but never secret-shaped files", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    run(["gate"]);
    const wt = worktreeFor("burn/x-core-1");
    run(["state", "agent", "p0", "--branch=burn/x-core-1", `--worktree=${wt}`]);
    fs.writeFileSync(path.join(wt, "work.js"), "the agent's work\n");
    fs.writeFileSync(path.join(wt, ".env"), "API_KEY=do-not-commit\n");
    fs.mkdirSync(path.join(wt, "cfg"));
    fs.writeFileSync(path.join(wt, "cfg", "server.pem"), "-----BEGIN PRIVATE KEY-----\n");
    const a = run(["resume-check", "--apply"]).json.actions[0];
    expect(a.salvaged.method).toBe("commit");
    const committed = git(wt, "show", "--name-only", "--format=", "HEAD").split(/\r?\n/).filter(Boolean);
    expect(committed).toEqual(["work.js"]);
    expect(git(wt, "status", "--porcelain")).toMatch(/\.env/);
    // the secrets keep the worktree dirty — so it is never pruned with them in it
    expect(run(["prune-check", "--branch=burn/x-core-1", `--worktree=${wt}`, "--integration=burn/x"]).code).toBe(1);
  });

  test("resume-check in the same session with a known agent → continue it (state untouched)", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x", "--session=S1"]);
    run(["gate"]);
    const wt = worktreeFor("burn/x-core-1");
    run(["state", "agent", "p0", "--agent-id=A1", "--branch=burn/x-core-1", `--worktree=${wt}`, "--session=S1"]);
    fs.writeFileSync(path.join(wt, "half.js"), "x\n");
    const r = run(["resume-check", "--apply", "--session=S1"]);
    expect(r.json.actions[0].action).toBe("continue-agent");
    expect(r.json.actions[0].salvaged.method).toBe("commit");
    expect(r.json.inFlight).toBe(1);
  });

  test("a pre-commit hook that refuses the wip commit → the diff is kept as a patch", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x", "--session=S1"]);
    run(["gate"]);
    const wt = worktreeFor("burn/x-core-1");
    run(["state", "agent", "p0", "--branch=burn/x-core-1", `--worktree=${wt}`]);
    const hooks = path.join(tmp, "hooks");
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n", { mode: 0o755 });
    git(repo, "config", "core.hooksPath", hooks);
    fs.writeFileSync(path.join(wt, "half.js"), "work the hook dislikes\n");
    const r = run(["resume-check", "--apply"]);
    const a = r.json.actions[0];
    expect(a.salvaged.method).toBe("patch");
    const patch = fs.readFileSync(a.salvaged.file, "utf8");
    expect(patch).toMatch(/work the hook dislikes/);
    const s = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    expect(s.queue[0].salvage).toBe(a.salvaged.file);
  });

  test("resumed --choice=off via the CLI switches the burn off and keeps the run", () => {
    run(["init", `--queue=${JSON.stringify([
      { id: "p0", size: "M", priority: "P0" }, { id: "f1", size: "S", priority: "P4", source: "discovery" },
    ])}`, "--slug=x", "--integration-branch=burn/x"]);
    const r = run(["resumed", "--trigger=manual", "--choice=off", "--session=S2"]);
    expect(r.json).toMatchObject({ applied: "off", burnActive: false, profile: "standard", lanes: 1, skipped: 1 });
    const st = run(["status"]).json;
    expect(st).toMatchObject({ open: true, burnActive: false, queue: 1 });
    expect(st.lastResume.trigger).toBe("manual");
  });

  test("finish records a calibration sample when the run spent enough to measure", () => {
    run(["init", `--queue=${queue}`, "--slug=x", "--integration-branch=burn/x"]);
    run(["gate"]);
    run(["state", "land", "p0", "--sha=a1"], { DEVOPS_BURN_NOW: "2026-09-25T11:00:00.000Z" });
    writeUsage({ weeklyUsed: 74 });
    const r = run(["state", "finish", "--status=COMPLETED"], { DEVOPS_BURN_NOW: "2026-09-25T11:00:00.000Z" });
    // usage timestamp is NOW (1 h old at finish) — older than the plan's 10 min → no sample
    expect(r.json.calibration).toBeNull();
    fs.writeFileSync(usageFile, JSON.stringify({
      timestamp: "2026-09-25T11:00:00.000Z", plan: "Max 20x",
      weekly: { pct: 74, resetInMinutes: 1700 }, session: { pct: 30, resetInMinutes: 100 },
    }));
    const st = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    st.status = "running";
    fs.writeFileSync(path.join(repo, "BURN-STATE.json"), JSON.stringify(st));
    const r2 = run(["state", "finish", "--status=COMPLETED"], { DEVOPS_BURN_NOW: "2026-09-25T11:00:00.000Z" });
    expect(r2.json.calibration).toMatchObject({ unitCostPct: expect.any(Number), laneHourlyPct: expect.any(Number) });
    expect(JSON.parse(fs.readFileSync(calFile, "utf8"))["Max 20x"].unitCostPct).toHaveLength(1);
  });
});
