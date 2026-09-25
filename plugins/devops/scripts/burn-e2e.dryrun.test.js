/**
 * End-to-end dry run of a burn across the real pieces — CLI, hook, git — with
 * a synthetic usage file and a synthetic transcript. No model, no tokens.
 *
 * It executes the very commands the `[burn-resume]` block tells Claude to
 * run, so a wrong script path, a wrong --state or a stale flag in the hook
 * text fails here instead of in a stopped burn at night.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "burn-plan.js");
const HOOK = path.join(here, "..", "hooks", "user-prompt-submit", "prompt.burn.resume.js");

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};
const SESSION = `e2e-${Date.now()}`;
let tmp, repo, usageFile, transcript, clock;

const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();
const env = () => ({
  ...process.env, ...GIT_ENV,
  DEVOPS_BURN_USAGE_FILE: usageFile,
  DEVOPS_BURN_CALIBRATION: path.join(tmp, "cal.json"),
  DEVOPS_BURN_NO_REFRESH: "1",
  DEVOPS_BURN_NOW: new Date(clock).toISOString(),
  CLAUDE_SESSION_ID: "",
  CLAUDE_CODE_SESSION_ID: SESSION,
});
const cli = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8", env: env() });
  return JSON.parse(r.stdout);
};
/** Run a `node "<script>" …` line exactly as the hook wrote it. */
const runLine = (line) => {
  const m = line.match(/node "([^"]+)" (.+)$/);
  expect(m, `not a node command: ${line}`).toBeTruthy();
  const args = [...m[2].matchAll(/--[a-z-]+=(?:"[^"]*"|\S+)|\S+/g)].map((x) => x[0].replace(/="(.*)"$/, "=$1"));
  const r = spawnSync(process.execPath, [m[1], ...args], { cwd: repo, encoding: "utf8", env: env() });
  return JSON.parse(r.stdout);
};
const usage = (weeklyUsed, sessionUsed, sessionResetMin = 200) => fs.writeFileSync(usageFile, JSON.stringify({
  timestamp: new Date(clock).toISOString(), plan: "Max 20x",
  weekly: { pct: weeklyUsed, resetInMinutes: 30 * 60 }, session: { pct: sessionUsed, resetInMinutes: sessionResetMin },
}));
const hook = (prompt) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ prompt, cwd: repo, session_id: SESSION, transcript_path: transcript }), encoding: "utf8", cwd: repo,
}).stdout;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "burn-e2e-"));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "branch", "burn/e2e");
  usageFile = path.join(tmp, "usage-live.json");
  transcript = path.join(tmp, "transcript.jsonl");
  clock = Date.parse("2026-09-25T10:00:00.000Z");
});
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp cleanup is best effort */ } });

describe("a burn is stopped by the 5-hour limit and nudged by hand", () => {
  let wt;

  test("1 · init and the first spawn", () => {
    usage(60, 40);
    const init = cli("init", `--queue=${JSON.stringify([
      { id: "p0", task: "main", size: "L", priority: "P0" },
      { id: "i1", task: "issue", size: "M", priority: "P2" },
      { id: "f1", task: "todo", size: "S", priority: "P4", source: "discovery" },
    ])}`, "--slug=e2e", "--integration-branch=burn/e2e", "--resume-auto=continue", "--auto-armed=no");
    expect(init.ok).toBe(true);
    expect(init.plan.profile).toBe("max");
    const g = cli("gate");
    expect(g).toMatchObject({ decision: "spawn", taskProfile: "max", foreground: true });
    expect(g.models.core).toBe("opus");
    wt = path.join(tmp, "wt-p0");
    git(repo, "worktree", "add", "-q", "-b", "burn/e2e-core-1", wt, "burn/e2e");
    expect(cli("state", "agent", "p0", "--agent-id=A-p0", "--agent=core", "--branch=burn/e2e-core-1", `--worktree=${wt}`).inFlight).toBe(1);
  });

  test("2 · the agent checkpoints, then the limit hits with uncommitted work on disk", () => {
    fs.writeFileSync(path.join(wt, "p0-part1.js"), "step 1\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "wip(burn): p0 step 1");
    expect(cli("state", "checkpoint", "p0").ok).toBe(true);
    fs.writeFileSync(path.join(wt, "p0-part2.js"), "step 2 — not committed when the limit hit\n");
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Spawning the next lane…" }] } }),
      JSON.stringify({ type: "assistant", error: "rate_limit", isApiErrorMessage: true, timestamp: new Date(clock + 60000).toISOString(), message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit · resets 3:00pm (Europe/Berlin)" }] } }),
    ].join("\n"));
  });

  let block;
  test("3 · after the reset the user types 'weiter' → the hook asks instead of burning on", () => {
    clock += 5 * 60 * 60000;
    usage(66, 2, 300);
    block = hook("weiter");
    expect(block).toMatch(/Setz den Burn NICHT einfach fort/);
    expect(block).toMatch(/"Burn abschalten \(Recommended\)"/);
    expect(block).toMatch(/0 gelandet · 2 offen · 1 unklar/);
  });

  test("4 · the user picks the default: the hook's own command switches the burn off", () => {
    const line = block.split("\n").find((l) => l.startsWith("Dann: node "));
    const r = runLine(line.replace(/^Dann: /, "").replace("<off|continue|end>", "off"));
    expect(r).toMatchObject({ applied: "off", burnActive: false, profile: "standard", lanes: 1, skipped: 1 });
  });

  test("5 · resume-check salvages the uncommitted step and continues the agent (same session)", () => {
    const r = cli("resume-check", "--apply");
    const a = r.actions[0];
    expect(a).toMatchObject({ id: "p0", salvage: true, action: "continue-agent" });
    expect(a.salvaged.method).toBe("commit");
    expect(git(wt, "log", "--format=%s", "-2")).toMatch(/^wip\(burn\): salvage p0 after a hard stop\nwip\(burn\): p0 step 1$/);
    expect(fs.readFileSync(path.join(wt, "p0-part2.js"), "utf8")).toMatch(/step 2/);
  });

  test("6 · the hook is quiet now; the run lands p0, the next task runs at standard depth, filler is gone", () => {
    expect(hook("weiter")).toBe("");
    git(wt, "commit", "-q", "--allow-empty", "-m", "feat: p0 done");
    git(repo, "checkout", "-q", "burn/e2e");
    git(repo, "merge", "-q", "--no-ff", "-m", "merge p0", "burn/e2e-core-1");
    expect(cli("state", "land", "p0", "--sha=" + git(repo, "rev-parse", "--short", "HEAD")).done).toBe(1);
    const res = spawnSync(process.execPath, [SCRIPT, "prune-check", "--branch=burn/e2e-core-1", `--worktree=${wt}`, "--integration=burn/e2e"], { cwd: repo, encoding: "utf8", env: env() });
    expect(res.status).toBe(0);
    const g = cli("gate");
    expect(g).toMatchObject({ decision: "spawn", taskProfile: "standard", burnActive: false });
    expect(g.task.id).toBe("i1");
    expect(g.models).toEqual({});
    expect(cli("status")).toMatchObject({ burnActive: false, queue: 0, inFlight: 1 });
  });
});

describe("the same stop with auto-resume armed — nobody is asked", () => {
  test("BURN_RESUME applies the F7 policy through the hook's own command", () => {
    const stateFile = path.join(repo, "BURN-STATE.json");
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    Object.assign(s, { status: "paused", pause: { since: new Date(clock + 60000).toISOString(), reason: "window" }, burn: { active: true }, profile: "max", resume: { auto: "continue", autoArmed: true } });
    s.queue.push({ id: "i2", task: "another issue", size: "M", priority: "P2", source: "issue", files: [] });
    fs.writeFileSync(stateFile, JSON.stringify(s));
    fs.writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "pausiert bis 20:15" }] } }));
    clock += 3 * 60 * 60000;
    usage(70, 1, 300);
    const out = hook("BURN_RESUME: window reset");
    expect(out).not.toMatch(/AskUserQuestion/);
    const line = out.split("\n").find((l) => l.startsWith("Führe aus: node "));
    const r = runLine(line.replace(/^Führe aus: /, ""));
    expect(r).toMatchObject({ applied: "continue", burnActive: true });
    expect(cli("status").status).toBe("running");
  });
});
