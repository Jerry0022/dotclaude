/**
 * Regression tests for the 2026-09-26 audit findings on burn-plan.js's git
 * side — throw-away repos only, no model, no tokens, no remote beyond a bare
 * temp one:
 *   AUD-C005 salvage secrets (already staged, upper-case, wider list) ·
 *   AUD-C018 failed add → no empty patch · AUD-C020 prune-check unknown →
 *   keep · AUD-C021/C048 mayWrite spelling, trunk, sub-branch parent, no
 *   repo · AUD-C022 parallel gate claims · AUD-C049/C050 strict CLI knobs ·
 *   AUD-C051 bounded git calls.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "burn-plan.js");
const bp = require("./burn-plan.js");
const NOW = "2026-09-25T10:00:00.000Z";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};
Object.assign(process.env, GIT_ENV);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let tmp;
let repo;
let usageFile;
let calFile;

function env(extra = {}) {
  return {
    ...process.env, ...GIT_ENV,
    DEVOPS_BURN_USAGE_FILE: usageFile,
    DEVOPS_BURN_CALIBRATION: calFile,
    DEVOPS_BURN_NO_REFRESH: "1",
    DEVOPS_BURN_NOW: NOW,
    CLAUDE_SESSION_ID: "",
    CLAUDE_CODE_SESSION_ID: "ENV-S",
    ...extra,
  };
}

function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8", env: env(extraEnv) });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* non-JSON output */ }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

function runAsync(args) {
  return new Promise((resolve) => {
    let out = "";
    const c = spawn(process.execPath, [SCRIPT, ...args], { cwd: repo, env: env() });
    c.stdout.on("data", (d) => { out += d; });
    c.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch { /* non-JSON output */ }
      resolve({ code, json });
    });
  });
}

function writeUsage({ weeklyUsed = 70, weeklyResetMin = 30 * 60, sessionUsed = 10, sessionResetMin = 200 } = {}) {
  fs.writeFileSync(usageFile, JSON.stringify({
    timestamp: NOW, plan: "Max 20x",
    weekly: { pct: weeklyUsed, resetInMinutes: weeklyResetMin },
    session: { pct: sessionUsed, resetInMinutes: sessionResetMin },
  }));
}

const put = (root, rel, body) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};

function initRepo(dir, branch = "main") {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

/** Session on burn/x (integration), agent worktree on burn/x-core-1. */
function agentWorktree() {
  git(repo, "checkout", "-q", "-b", "burn/x");
  const wt = path.join(tmp, "wt");
  git(repo, "worktree", "add", "-q", "-b", "burn/x-core-1", wt, "burn/x");
  return wt;
}

const committedFiles = (wt) => git(wt, "show", "--name-only", "--format=", "HEAD").split(/\r?\n/).filter(Boolean);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-rob-"));
  repo = initRepo(path.join(tmp, "repo"));
  usageFile = path.join(tmp, "usage-live.json");
  calFile = path.join(tmp, "burn-calibration.json");
  writeUsage();
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
});

describe("AUD-C005 — the salvage commit never carries a secret", () => {
  test("a secret the cut-off agent had ALREADY staged is unstaged before the wip commit", () => {
    const wt = agentWorktree();
    put(wt, "work.js", "x\n");
    put(wt, ".env", "API_KEY=staged-before-the-limit\n");
    put(wt, "cfg/id_rsa", "KEY\n");
    git(wt, "add", "-A");
    const res = bp.salvageWorktree({ id: "t2", worktree: wt }, { stateDir: repo });
    expect(res).toMatchObject({ ok: true, method: "commit" });
    expect(committedFiles(wt)).toEqual(["work.js"]);
    // still on disk, uncommitted — the worktree stays dirty, so prune-check keeps it
    expect(fs.readFileSync(path.join(wt, ".env"), "utf8")).toMatch(/staged-before/);
    expect(git(wt, "status", "--porcelain")).toMatch(/\.env/);
  });

  test("upper-case names and the wider secret list stay out", () => {
    const wt = agentWorktree();
    const secrets = [
      ".ENV", "u/ID_RSA", "u/SERVER.PEM", "u/CREDENTIALS.JSON", "u/Secrets.yaml", "u/Tls.Key", "u/.Env.Production",
      ".aws/credentials", ".git-credentials", ".netrc", ".npmrc", ".pypirc", "id_dsa", "id_ecdsa",
      "k/keystore.jks", "k/release.keystore", "k/putty.ppk", "infra/prod.tfvars", "gcp/my-service-account-key.json",
      "token.txt", "c.p12", "c.pfx",
    ];
    for (const f of secrets) put(wt, f, `SECRET ${f}\n`);
    put(wt, "work.js", "work\n");
    const res = bp.salvageWorktree({ id: "t3", worktree: wt }, { stateDir: repo });
    expect(res).toMatchObject({ ok: true, method: "commit" });
    expect(committedFiles(wt)).toEqual(["work.js"]);
    for (const f of secrets) expect(bp.isSalvageSecret(f)).toBe(true);
    expect(bp.isSalvageSecret("src/work.js")).toBe(false);
    expect(bp.isSalvageSecret("docs/tokenizer.md")).toBe(false);
  });

  test("only secrets dirty → nothing is committed, the secret is not left staged", () => {
    const wt = agentWorktree();
    put(wt, ".env", "A=1\n");
    git(wt, "add", ".env");
    const res = bp.salvageWorktree({ id: "t4", worktree: wt }, { stateDir: repo });
    expect(res.ok).toBe(false);
    expect(git(wt, "log", "-1", "--format=%s")).toBe("init");
    expect(git(wt, "diff", "--cached", "--name-only")).toBe("");
  });
});

describe("AUD-C018 — a failed git add fails loudly, never an empty patch", () => {
  test("a stale index.lock: ok:false, no patch file", () => {
    const wt = agentWorktree();
    put(wt, "half.js", "the only copy of the agent's work\n");
    fs.writeFileSync(path.join(git(wt, "rev-parse", "--absolute-git-dir"), "index.lock"), "");
    const res = bp.salvageWorktree({ id: "L1", worktree: wt }, { stateDir: repo });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/git add failed/);
    expect(fs.existsSync(path.join(repo, "BURN-SALVAGE-L1.patch"))).toBe(false);
    expect(fs.existsSync(path.join(wt, "half.js"))).toBe(true);
  });

  test("a refused commit with a diff over 1 MiB still becomes a full patch (no ENOBUFS)", () => {
    const wt = agentWorktree();
    const hooks = path.join(tmp, "hooks");
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    git(repo, "config", "core.hooksPath", hooks);
    put(wt, "big.js", ("// generated " + "x".repeat(60) + "\n").repeat(20000));
    const res = bp.salvageWorktree({ id: "B1", worktree: wt }, { stateDir: repo });
    expect(res).toMatchObject({ ok: true, method: "patch" });
    expect(fs.statSync(res.file).size).toBeGreaterThan(1024 * 1024);
  });
});

describe("AUD-C020 — prune-check: unknown is keep", () => {
  test("no --branch and a detached worktree whose commit is nowhere else → keep", () => {
    git(repo, "branch", "burn/x");
    const wt = path.join(tmp, "wt");
    git(repo, "worktree", "add", "-q", "--detach", wt, "burn/x");
    put(wt, "work.js", "agent work\n");
    git(wt, "add", "work.js");
    git(wt, "commit", "-q", "-m", "wip(burn): agent work");
    const r = run(["prune-check", "--branch=", `--worktree=${wt}`, "--integration=burn/x"]);
    expect(r.code).toBe(1);
    expect(r.json.reasons.join(" ")).toMatch(/not proven/);
  });

  test("a recorded branch that is merged, but the worktree HEAD moved elsewhere → keep", () => {
    git(repo, "branch", "burn/x");
    const wt = path.join(tmp, "wt");
    git(repo, "worktree", "add", "-q", "-b", "burn/x-core-1", wt, "burn/x");
    git(wt, "checkout", "-q", "-b", "other");
    put(wt, "w.js", "w\n");
    git(wt, "add", "w.js");
    git(wt, "commit", "-q", "-m", "work on another branch");
    const r = run(["prune-check", "--branch=burn/x-core-1", `--worktree=${wt}`, "--integration=burn/x"]);
    expect(r.json.commitsAhead).toBe(0);
    expect(r.code).toBe(1);
  });

  test("neither branch nor worktree → keep; unreadable status → keep", () => {
    expect(run(["prune-check", "--integration=main"]).code).toBe(1);
    const notRepo = fs.mkdtempSync(path.join(tmp, "plain-"));
    const r = bp.pruneCheck({ repo, branch: null, worktree: notRepo, integrationBranch: "main" });
    expect(r.safe).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unreadable/);
  });
});

describe("AUD-C021/C048 — mayWrite under every spelling", () => {
  test("a feature session never writes main as Main, MAIN, heads/main or refs/heads/main", () => {
    git(repo, "checkout", "-q", "-b", "feat/x");
    for (const b of ["main", "Main", "MAIN", "heads/main", "refs/heads/main", "master", "trunk"]) {
      expect(bp.mayWrite(repo, b)).toBe(false);
    }
    expect(bp.mayWrite(repo, "feat/x")).toBe(true);
    expect(bp.mayWrite(repo, "burn/x")).toBe(true);
  });

  test("a remote default 'develop' read offline from refs/remotes/origin/HEAD is protected", () => {
    const r2 = initRepo(path.join(tmp, "r2"), "develop");
    git(r2, "update-ref", "refs/remotes/origin/develop", "HEAD");
    git(r2, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
    git(r2, "checkout", "-q", "-b", "feat/y");
    expect([...bp.protectedBranches(r2)]).toContain("develop");
    expect(bp.mayWrite(r2, "develop")).toBe(false);
    expect(bp.mayWrite(r2, "Develop")).toBe(false);
  });

  test("a sub-branch session never writes its parent; no repo writes nothing", () => {
    git(repo, "checkout", "-q", "-b", "feat/a");
    git(repo, "checkout", "-q", "-b", "feat/a-core");
    expect(bp.mayWrite(repo, "feat/a")).toBe(false);
    expect(bp.mayWrite(repo, "feat/a-core")).toBe(true);
    const plain = fs.mkdtempSync(path.join(tmp, "norepo-"));
    expect(bp.mayWrite(plain, "burn/x")).toBe(false);
  });

  test("a session on main still writes main (any spelling of the same branch)", () => {
    expect(bp.mayWrite(repo, "main")).toBe(true);
    expect(bp.mayWrite(repo, "refs/heads/main")).toBe(true);
    expect(bp.mayWrite(repo, "master")).toBe(false);
  });

  test("init refuses Main from a feature session", () => {
    git(repo, "checkout", "-q", "-b", "feat/x");
    const r = run(["init", `--queue=${JSON.stringify([{ id: "p0", size: "M", priority: "P0" }])}`, "--slug=x", "--integration-branch=Main"]);
    expect(r.code).toBe(1);
    expect(r.json.reason).toBe("integration-branch-protected");
  });
});

describe("AUD-C022 — parallel gate calls never claim the same task", () => {
  test("three gates at once → three different tasks, all in flight", async () => {
    writeUsage({ weeklyUsed: 40, weeklyResetMin: 3 * 60, sessionUsed: 5, sessionResetMin: 280 });
    const queue = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, size: "L", priority: i ? "P2" : "P0" }));
    expect(run(["init", `--queue=${JSON.stringify(queue)}`, "--slug=r", "--integration-branch=burn/r"]).code).toBe(0);
    const lanes = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8")).lanes;
    expect(lanes).toBeGreaterThanOrEqual(3);
    const rs = await Promise.all([runAsync(["gate"]), runAsync(["gate"]), runAsync(["gate"])]);
    const ids = rs.filter((r) => r.json && r.json.decision === "spawn").map((r) => r.json.task.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const s = JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8"));
    expect(s.inFlight.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(fs.existsSync(path.join(repo, "BURN-STATE.json.lock"))).toBe(false);
  }, 30000);

  test("a stale lock (dead holder) is taken over; a live one times out loudly", () => {
    const file = path.join(tmp, "S.json");
    const lock = `${file}.lock`;
    fs.writeFileSync(lock, "999999 old\n");
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lock, old, old);
    expect(bp.withStateLock(file, () => 42)).toBe(42);
    expect(fs.existsSync(lock)).toBe(false);
    fs.writeFileSync(lock, "1 now\n");
    expect(() => bp.withStateLock(file, () => 1, { waitMs: 100 })).toThrow(/locked/);
  });
});

describe("AUD-C049/C050 — strict CLI knobs", () => {
  const q = JSON.stringify([{ id: "p0", size: "M", priority: "P0" }]);
  test("--resume-auto accepts continue|on|off only", () => {
    let r = run(["init", `--queue=${q}`, "--slug=x", "--integration-branch=burn/x", "--resume-auto=of"]);
    expect(r.code).toBe(1);
    expect(r.json.error).toMatch(/continue\|on\|off/);
    expect(fs.existsSync(path.join(repo, "BURN-STATE.json"))).toBe(false);
    r = run(["init", `--queue=${q}`, "--slug=x", "--integration-branch=burn/x", "--resume-auto=OFF"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(repo, "BURN-STATE.json"), "utf8")).resume.auto).toBe("off");
    expect(run(["state", "resume-policy", "--auto=nope"]).code).toBe(1);
    expect(run(["state", "resume-policy", "--auto=on"]).json.ok).toBe(true);
  });

  test("--lane-cap and --reserve must be numbers in range", () => {
    for (const bad of ["--lane-cap=0", "--lane-cap=abc", "--lane-cap=2.5", "--lane-cap=99", "--reserve=-1", "--reserve=x", "--reserve=80"]) {
      const r = run(["plan", `--queue=${q}`, bad]);
      expect(r.code, bad).toBe(1);
      expect(r.json.error, bad).toMatch(/must be/);
    }
    expect(run(["plan", `--queue=${q}`, "--lane-cap=2", "--reserve=7"]).json.laneCap).toBe(2);
  });
});

describe("AUD-C051 — bounded git calls", () => {
  test("git calls carry a timeout and a buffer well above 1 MiB", () => {
    expect(bp.GIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(bp.GIT_MAX_BUFFER).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    const src = fs.readFileSync(SCRIPT, "utf8");
    // every execFileSync('git', …) goes through the bounded helper
    expect(src.match(/execFileSync\('git'/g)).toHaveLength(1);
    expect(src).toMatch(/timeout, maxBuffer: GIT_MAX_BUFFER/);
  });
});
