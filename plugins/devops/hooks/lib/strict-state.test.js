import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "./strict-state.js";

const LIB = fileURLToPath(new URL("./strict-state.js", import.meta.url));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Throwaway repo on `branch` with one commit, so HEAD is born. */
function repo(branch = "feat/x") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strict-state-"));
  git(dir, "init", "-q", "-b", branch);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

let cwd;
beforeEach(() => { cwd = repo(); });
afterEach(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ } });

// ── mode file ──────────────────────────────────────────────────────────────

describe("activate / readMode", () => {
  test("writes the mode file with the current branch and reason", () => {
    const m = S.activate(cwd, { reason: "on" });
    expect(fs.existsSync(S.modePath(cwd))).toBe(true);
    expect(m.active).toBe(true);
    expect(m.reason).toBe("on");
    expect(m.branch).toBe("feat/x");
    expect(m.expiresAt).toBeNull();
    expect(S.readMode(cwd).branch).toBe("feat/x");
  });

  test("inline mode carries an expiry; explicit branch and sessionId are stored", () => {
    const m = S.activate(cwd, { reason: "inline", sessionId: "s1", now: Date.parse("2026-09-04T10:00:00Z") });
    expect(m.sessionId).toBe("s1");
    expect(typeof m.expiresAt).toBe("string");
    expect(Date.parse(m.expiresAt)).toBeGreaterThan(Date.parse("2026-09-04T10:00:00Z"));
  });

  test("readMode is null without a file and null on corrupt JSON", () => {
    expect(S.readMode(cwd)).toBeNull();
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(S.modePath(cwd), "{not json", "utf8");
    expect(S.readMode(cwd)).toBeNull();
  });

  test("deactivate removes the file and is idempotent", () => {
    S.activate(cwd, { reason: "on" });
    S.deactivate(cwd);
    S.deactivate(cwd);
    expect(fs.existsSync(S.modePath(cwd))).toBe(false);
  });
});

describe("currentBranch", () => {
  test("reads the checked-out branch", () => {
    expect(S.currentBranch(cwd)).toBe("feat/x");
  });
  test("is null outside a repo", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "strict-norepo-"));
    try { expect(S.currentBranch(plain)).toBeNull(); }
    finally { fs.rmSync(plain, { recursive: true, force: true }); }
  });
});

describe("evaluate", () => {
  test("off when there is no mode file", () => {
    expect(S.evaluate(cwd)).toMatchObject({ active: false, why: "off" });
  });

  test("active on the same branch", () => {
    S.activate(cwd, { reason: "on" });
    expect(S.evaluate(cwd)).toMatchObject({ active: true, why: null });
  });

  test("branch-mismatch after switching branches", () => {
    S.activate(cwd, { reason: "on" });
    git(cwd, "checkout", "-q", "-b", "other");
    expect(S.evaluate(cwd)).toMatchObject({ active: false, why: "branch-mismatch" });
  });

  test("expired when now is past expiresAt", () => {
    const t0 = Date.parse("2026-09-04T10:00:00Z");
    S.activate(cwd, { reason: "inline", now: t0 });
    expect(S.evaluate(cwd, { now: t0 + 60_000 }).active).toBe(true);
    expect(S.evaluate(cwd, { now: t0 + 48 * 3600_000 })).toMatchObject({ active: false, why: "expired" });
  });

  test("binding-gone when a bound workflow file has disappeared", () => {
    S.activate(cwd, { reason: "inline" });
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude", "concept-active.json"), "{}");
    S.bind(cwd, "concept", path.join(".claude", "concept-active.json"));
    expect(S.evaluate(cwd)).toMatchObject({ active: true });
    fs.unlinkSync(path.join(cwd, ".claude", "concept-active.json"));
    expect(S.evaluate(cwd)).toMatchObject({ active: false, why: "binding-gone" });
  });

  test("no repo: branch check is skipped, mode counts", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "strict-norepo-"));
    try {
      S.activate(plain, { reason: "on" });
      expect(S.readMode(plain).branch).toBeNull();
      expect(S.evaluate(plain)).toMatchObject({ active: true });
    } finally { fs.rmSync(plain, { recursive: true, force: true }); }
  });
});

describe("bindings", () => {
  test("findBinding: none, concept, autonomous", () => {
    expect(S.findBinding(cwd)).toBeNull();
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude", "concept-active.json"), "{}");
    expect(S.findBinding(cwd)).toMatchObject({ reason: "concept" });
    fs.unlinkSync(path.join(cwd, ".claude", "concept-active.json"));
    fs.writeFileSync(path.join(cwd, "AUTONOMOUS-LOCKOUT.flag"), "{}");
    expect(S.findBinding(cwd)).toMatchObject({ reason: "autonomous" });
  });

  test("bind rewrites reason and boundTo, keeps the branch", () => {
    S.activate(cwd, { reason: "inline" });
    const m = S.bind(cwd, "autonomous", "AUTONOMOUS-LOCKOUT.flag");
    expect(m).toMatchObject({ reason: "autonomous", boundTo: "AUTONOMOUS-LOCKOUT.flag", branch: "feat/x" });
    expect(typeof m.expiresAt).toBe("string");
  });

  test("branch notice bookkeeping", () => {
    S.activate(cwd, { reason: "on" });
    expect(S.branchNoticed(cwd, "other")).toBe(false);
    S.markBranchNoticed(cwd, "other");
    expect(S.branchNoticed(cwd, "other")).toBe(true);
    expect(S.branchNoticed(cwd, "third")).toBe(false);
  });
});

// ── inherited mode (worktree agents) ───────────────────────────────────────

describe("resolveInherited", () => {
  test("a worktree on <branch>-<role> inherits the main worktree's mode", () => {
    S.activate(cwd, { reason: "on" });
    const wt = path.join(os.tmpdir(), `strict-wt-${Date.now()}`);
    git(cwd, "worktree", "add", "-q", wt, "-b", "feat/x-core");
    try {
      expect(S.readMode(wt)).toBeNull();
      expect(S.resolveInherited(wt)).toMatchObject({ branch: "feat/x", reason: "on" });
      expect(S.evaluate(wt, { inherit: true })).toMatchObject({ active: true, inherited: true });
    } finally {
      git(cwd, "worktree", "remove", "--force", wt);
    }
  });

  test("an unrelated branch does not inherit", () => {
    S.activate(cwd, { reason: "on" });
    const wt = path.join(os.tmpdir(), `strict-wt-${Date.now()}`);
    git(cwd, "worktree", "add", "-q", wt, "-b", "hotfix/y");
    try {
      expect(S.resolveInherited(wt)).toBeNull();
      expect(S.evaluate(wt, { inherit: true }).active).toBe(false);
    } finally {
      git(cwd, "worktree", "remove", "--force", wt);
    }
  });
});

// ── mention detection ──────────────────────────────────────────────────────

describe("detectMention", () => {
  test("task with the remainder", () => {
    expect(S.detectMention("/claude-strict mach den Rand dünner"))
      .toEqual({ mentioned: true, route: "task", rest: "mach den Rand dünner" });
  });
  test("plugin-prefixed form and routes", () => {
    expect(S.detectMention("/devops:claude-strict on").route).toBe("on");
    expect(S.detectMention("/claude-strict an").route).toBe("on");
    expect(S.detectMention("/claude-strict off").route).toBe("off");
    expect(S.detectMention("/claude-strict aus").route).toBe("off");
    expect(S.detectMention("/claude-strict status").route).toBe("status");
    expect(S.detectMention("/claude-strict").route).toBe("status");
  });
  test("another slash command after it stays part of the task", () => {
    expect(S.detectMention("/claude-strict /concept Rand-Varianten"))
      .toEqual({ mentioned: true, route: "task", rest: "/concept Rand-Varianten" });
  });
  test("mid-sentence mention counts", () => {
    expect(S.detectMention("bitte /claude-strict nur den Rand").mentioned).toBe(true);
  });
  test("not a mention: backticks, path segments, the word strict", () => {
    expect(S.detectMention("siehe `/claude-strict` im README").mentioned).toBe(false);
    expect(S.detectMention("lies docs/claude-strict.md").mentioned).toBe(false);
    expect(S.detectMention("strict: true in tsconfig").mentioned).toBe(false);
    expect(S.detectMention("be strict about types").mentioned).toBe(false);
    expect(S.detectMention("").mentioned).toBe(false);
    expect(S.detectMention(undefined).mentioned).toBe(false);
  });
  test("expanded slash command with args", () => {
    const x = "<command-message>claude-strict is running…</command-message><command-name>/claude-strict</command-name><command-args>on</command-args>";
    expect(S.detectMention(x)).toMatchObject({ mentioned: true, route: "on" });
    const y = "<command-name>/devops:claude-strict</command-name><command-args>den Rand dünner</command-args>";
    expect(S.detectMention(y)).toEqual({ mentioned: true, route: "task", rest: "den Rand dünner" });
    const z = "<command-name>/concept</command-name><command-args>/claude-strict foo</command-args>";
    expect(S.detectMention(z).mentioned).toBe(false);
  });
});

// ── contract ───────────────────────────────────────────────────────────────

describe("contract", () => {
  test("block shape and size", () => {
    expect(S.CONTRACT_BLOCK.startsWith(S.CONTRACT_OPEN)).toBe(true);
    expect(S.CONTRACT_BLOCK.trimEnd().endsWith(S.CONTRACT_CLOSE)).toBe(true);
    expect(S.CONTRACT_BLOCK.length).toBeLessThanOrEqual(1400);
    for (const must of ["SCOPE IS LITERAL", "DISCRETION", "TESTS", "PRECEDENCE", "PROPAGATION", "REPORT", "tune-polish", "untouched"]) {
      expect(S.CONTRACT_BLOCK).toContain(must);
    }
  });
  test("contractText prefixes a status line", () => {
    S.activate(cwd, { reason: "on" });
    const t = S.contractText({ mode: S.readMode(cwd), branch: "feat/x" });
    expect(t.split("\n")[0]).toMatch(/^strict: on · branch feat\/x · \/claude-strict off/);
    expect(t).toContain(S.CONTRACT_OPEN);
  });
  test("hasContract", () => {
    expect(S.hasContract(`x\n${S.CONTRACT_OPEN}\n…`)).toBe(true);
    expect(S.hasContract("plain prompt")).toBe(false);
    expect(S.hasContract(undefined)).toBe(false);
  });
});

// ── CLI ────────────────────────────────────────────────────────────────────

describe("CLI", () => {
  function cli(...args) {
    return spawnSync(process.execPath, [LIB, ...args], { cwd, encoding: "utf8", env: GIT_ENV });
  }
  test("on / status / off / contract", () => {
    expect(cli("on").status).toBe(0);
    expect(S.readMode(cwd)).toMatchObject({ reason: "on", branch: "feat/x" });
    const st = JSON.parse(cli("status").stdout);
    expect(st).toMatchObject({ active: true, reason: "on", branch: "feat/x" });
    expect(cli("off").status).toBe(0);
    expect(S.readMode(cwd)).toBeNull();
    expect(JSON.parse(cli("status").stdout)).toMatchObject({ active: false });
    expect(cli("contract").stdout).toContain(S.CONTRACT_OPEN);
  });
  test("unknown subcommand exits 1", () => {
    expect(cli("bogus").status).toBe(1);
  });
});
