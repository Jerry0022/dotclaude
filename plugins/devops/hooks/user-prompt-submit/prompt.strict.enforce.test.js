import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../lib/strict-state.js";
import * as B from "../lib/batch-state.js";

const HOOK = fileURLToPath(new URL("./prompt.strict.enforce.js", import.meta.url));

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

/** Run the hook exactly as the harness does: JSON on stdin, project as cwd. */
function runHook(payload) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: "sess-1", ...payload }),
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* not JSON */ }
  const ctx = json && json.hookSpecificOutput ? json.hookSpecificOutput.additionalContext || "" : "";
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "", ctx };
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "strict-hook-"));
  git(cwd, "init", "-q", "-b", "feat/x");
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
    "utf8",
  );
  fs.writeFileSync(path.join(cwd, "README.md"), "x\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", "init");
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("inert", () => {
  test("mode off, no mention → exit 0, nothing injected, no mode file", () => {
    const r = runHook({ prompt: "mach den Button blau" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(S.readMode(cwd)).toBeNull();
  });

  test("the word strict alone is not a mention", () => {
    const r = runHook({ prompt: "set strict: true in tsconfig" });
    expect(r.stdout).toBe("");
    expect(S.readMode(cwd)).toBeNull();
  });
});

describe("arming by mention", () => {
  test("inline task arms an inline mode and injects the contract", () => {
    const r = runHook({ prompt: "/claude-strict mach den Rand der Box dünner" });
    expect(r.code).toBe(0);
    expect(S.readMode(cwd)).toMatchObject({ reason: "inline", branch: "feat/x", sessionId: "sess-1" });
    expect(r.ctx).toContain(S.CONTRACT_OPEN);
    expect(r.ctx.split("\n")[0]).toMatch(/^strict: inline · branch feat\/x/);
  });

  test("on arms a branch mode without expiry", () => {
    const r = runHook({ prompt: "/claude-strict on" });
    expect(S.readMode(cwd)).toMatchObject({ reason: "on", expiresAt: null });
    expect(r.ctx).toContain("strict: on · branch feat/x");
    expect(r.ctx).toContain(S.CONTRACT_OPEN);
  });

  test("expanded slash command arms too", () => {
    runHook({ prompt: "<command-name>/claude-strict</command-name><command-args>on</command-args>" });
    expect(S.readMode(cwd)).toMatchObject({ reason: "on" });
  });

  test("off removes the mode and says so in one line", () => {
    S.activate(cwd, { reason: "on" });
    const r = runHook({ prompt: "/claude-strict off" });
    expect(S.readMode(cwd)).toBeNull();
    expect(r.ctx).toMatch(/off/);
    expect(r.ctx).not.toContain(S.CONTRACT_OPEN);
  });

  test("an inline mention while on does not downgrade the branch mode", () => {
    S.activate(cwd, { reason: "on" });
    runHook({ prompt: "/claude-strict noch den Schatten" });
    expect(S.readMode(cwd)).toMatchObject({ reason: "on" });
  });

  test("the prompt field name does not matter", () => {
    expect(runHook({ user_message: "/claude-strict on" }).ctx).toContain(S.CONTRACT_OPEN);
    S.deactivate(cwd);
    expect(runHook({ message: "/claude-strict on" }).ctx).toContain(S.CONTRACT_OPEN);
  });
});

describe("active mode", () => {
  beforeEach(() => S.activate(cwd, { reason: "on" }));

  test("plain prompt gets exactly one contract", () => {
    const r = runHook({ prompt: "und jetzt die Farbe" });
    expect(count(r.ctx, S.CONTRACT_OPEN)).toBe(1);
  });

  test.each([
    ["autonomous resume", "AUTONOMOUS_RESUME: weiter"],
    ["concept cron", "Silently service the concept bridge on port 8742."],
    ["backlog autostart", "RUN_BACKLOG_AUTOSTART: presence timeout. phase=gate"],
  ])("machine prompt (%s) is still injected — those turns must stay strict", (_l, prompt) => {
    expect(runHook({ prompt }).ctx).toContain(S.CONTRACT_OPEN);
  });

  test("branch mismatch: one notice, then silence, contract not injected", () => {
    git(cwd, "checkout", "-q", "-b", "other");
    const first = runHook({ prompt: "irgendwas" });
    expect(first.ctx).toContain("feat/x");
    expect(first.ctx).toContain("other");
    expect(first.ctx).not.toContain(S.CONTRACT_OPEN);
    const second = runHook({ prompt: "noch was" });
    expect(second.stdout).toBe("");
  });
});

describe("batch interaction", () => {
  test("a prompt the batch hook will collect never arms strict", () => {
    B.activate(cwd);
    const r = runHook({ prompt: "/claude-strict den Rand dünner" });
    expect(r.stdout).toBe("");
    expect(S.readMode(cwd)).toBeNull();
  });

  test("the batch execute marker still gets the contract when strict is on", () => {
    S.activate(cwd, { reason: "on" });
    B.activate(cwd);
    B.appendNote(cwd, "Rand dünner");
    const r = runHook({ prompt: ">> los" });
    expect(r.ctx).toContain(S.CONTRACT_OPEN);
  });
});
