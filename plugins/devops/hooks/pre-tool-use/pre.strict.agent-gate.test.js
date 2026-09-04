import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../lib/strict-state.js";

const HOOK = fileURLToPath(new URL("./pre.strict.agent-gate.js", import.meta.url));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

let cwd;

function runHook(payload, at = cwd) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: at, session_id: "sess-1", tool_name: "Agent", ...payload }),
    cwd: at,
    encoding: "utf8",
    env: GIT_ENV,
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function enablePlugin(dir) {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
    "utf8",
  );
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "strict-gate-"));
  git(cwd, "init", "-q", "-b", "feat/x");
  enablePlugin(cwd);
  fs.writeFileSync(path.join(cwd, "README.md"), "x\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", "init");
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

const PLAIN = { tool_input: { subagent_type: "devops:frontend", prompt: "Mach den Rand dünner." } };
const WITH_BLOCK = { tool_input: { subagent_type: "devops:frontend", prompt: `${S.CONTRACT_BLOCK}\n\nMach den Rand dünner.` } };

describe("inactive", () => {
  test("no mode → silent allow", () => {
    const r = runHook(PLAIN);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("branch mismatch → silent allow", () => {
    S.activate(cwd, { reason: "on" });
    git(cwd, "checkout", "-q", "-b", "other");
    expect(runHook(PLAIN).code).toBe(0);
  });
});

describe("active", () => {
  beforeEach(() => S.activate(cwd, { reason: "on" }));

  test("prompt without the block is refused with instructions", () => {
    const r = runHook(PLAIN);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("[claude-strict]");
    expect(r.stderr).toContain("contract");
    expect(r.stderr).toContain("strict-state.js");
    expect(r.stdout).toBe("");
  });

  test("prompt carrying the block passes silently", () => {
    const r = runHook(WITH_BLOCK);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("another tool name is ignored even when the matcher misfires", () => {
    expect(runHook({ ...PLAIN, tool_name: "Bash" }).code).toBe(0);
  });

  test("missing prompt field is treated as no block", () => {
    expect(runHook({ tool_input: { subagent_type: "devops:qa" } }).code).toBe(2);
  });
});

describe("worktree inheritance", () => {
  test("an agent worktree on <branch>-<role> is gated by the parent's mode", () => {
    S.activate(cwd, { reason: "on" });
    const wt = path.join(os.tmpdir(), `strict-gate-wt-${Date.now()}`);
    git(cwd, "worktree", "add", "-q", wt, "-b", "feat/x-frontend");
    enablePlugin(wt);
    try {
      expect(runHook(PLAIN, wt).code).toBe(2);
      expect(runHook(WITH_BLOCK, wt).code).toBe(0);
    } finally {
      git(cwd, "worktree", "remove", "--force", wt);
    }
  });
});
