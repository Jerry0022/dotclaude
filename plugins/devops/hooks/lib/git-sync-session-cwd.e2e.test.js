import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resultFile, throttleFile } = require("./git-sync-bg.js");

const PROMPT = fileURLToPath(new URL("../user-prompt-submit/prompt.git.sync.js", import.meta.url));
const STOP = fileURLToPath(new URL("../stop/stop.git.sync.js", import.meta.url));

/**
 * The Desktop app starts hooks of a worktree session in the repo root, so the
 * hook process's cwd is the main checkout while the payload's cwd is the
 * worktree. The background sync keys its result by the worktree; reading it
 * under process.cwd() delivered nothing (analysis 2026-10-08: no ✓/⚠ reached
 * a consumer session after 2026-10-03, results piled up in %TEMP%).
 */

let root;
let wt;
let tmp;

function run(hook) {
  const res = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ cwd: wt, session_id: "s1", prompt: "weiter" }),
    cwd: root,
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "" };
}

function enablePlugin(dir) {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-root-"));
  wt = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-wt-"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-tmp-"));
  enablePlugin(root);
  enablePlugin(wt);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["init", "-q"], { cwd: wt });
  execFileSync("git", ["checkout", "-q", "-b", "claude/feature-x"], { cwd: wt });
});

afterEach(() => {
  for (const d of [root, wt, tmp]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* a detached child may still hold it */ }
  }
});

describe("prompt.git.sync — reads the result of the session's worktree", () => {
  test("delivers a result keyed by the payload cwd, not the hook process cwd", () => {
    const file = resultFile(wt, tmp);
    fs.writeFileSync(file, "[git-sync] ✓ origin/main → claude/feature-x: 2 commit(s)\n");

    const { code, stdout } = run(PROMPT);

    expect(code).toBe(0);
    expect(stdout).toContain("origin/main → claude/feature-x: 2 commit(s)");
    expect(fs.existsSync(file)).toBe(false);
  });

  test("delivers a ⚠ conflict with its resolution procedure", () => {
    fs.writeFileSync(
      resultFile(wt, tmp),
      "[git-sync] ⚠ origin/main → claude/feature-x: 1 file(s) with ambiguous conflicts — merge aborted. Resolution required:\n  README.md\n",
    );

    const { stdout } = run(PROMPT);

    expect(stdout).toContain("ambiguous conflicts");
    expect(stdout).toContain("Resolve them now");
  });

  test("drops a result left by the worktree's previous branch", () => {
    const file = resultFile(wt, tmp);
    fs.writeFileSync(file, "[git-sync] ✓ origin/main → claude/old-branch: 1 commit(s)\n");

    const { code, stdout } = run(PROMPT);

    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("stop.git.sync — syncs the session's worktree", () => {
  test("claims the throttle slot of the payload cwd, not of the repo root", () => {
    // A remote is all the gate needs; the detached child's fetch failing is irrelevant here.
    execFileSync("git", ["remote", "add", "origin", path.join(tmp, "no-such-remote.git")], { cwd: wt });

    const { code, stdout } = run(STOP);

    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(fs.existsSync(throttleFile(wt, tmp))).toBe(true);
    expect(fs.existsSync(throttleFile(root, tmp))).toBe(false);
  });
});
