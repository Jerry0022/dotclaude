import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.claude.budget.js");
const HOURS = 60 * 60 * 1000;

const projects = [];
afterAll(() => {
  for (const dir of projects) fs.rmSync(dir, { recursive: true, force: true });
});

// A temp project whose settings enable the plugin (plugin-guard), with its own
// tmpdir: runOnce keeps the dedupe markers in os.tmpdir(), which honours
// TMPDIR/TEMP/TMP, so no parallel test's marker can silence this hook.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-budget-"));
  projects.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".home"), { recursive: true });
  return dir;
}

let sidCounter = 0;
function nextSid() {
  sidCounter += 1;
  return `s-claude-budget-${process.pid}-${sidCounter}`;
}

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n";

/** PostToolUse runs after the tool wrote the file: the hook measures the disk. */
function onDisk(file, n) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines(n));
}

/** A Write of the whole file — growth of unknown size, which counts as growth. */
function write(file, n) {
  onDisk(file, n);
  return { tool_name: "Write", tool_input: { file_path: file, content: lines(n) } };
}

/** An Edit that leaves `n` lines on disk and changed the line count by `delta`. */
function edit(file, n, delta) {
  onDisk(file, n);
  return {
    tool_name: "Edit",
    tool_input: {
      file_path: file,
      old_string: ["a", ...Array(Math.max(-delta, 0)).fill("b")].join("\n"),
      new_string: ["a", ...Array(Math.max(delta, 0)).fill("b")].join("\n"),
    },
  };
}

/** Backdate every dedupe marker, as if the reports were `ms` old. */
function age(dir, ms) {
  const tmp = path.join(dir, ".tmp");
  const then = new Date(Date.now() - ms);
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith("dotclaude-claude-budget-")) fs.utimesSync(path.join(tmp, name), then, then);
  }
}

function runHookRaw(dir, call, { sessionId, agentId } = {}) {
  const tmp = path.join(dir, ".tmp");
  const home = path.join(dir, ".home");
  const input = { ...call, cwd: dir };
  if (sessionId) input.session_id = sessionId;
  if (agentId) input.agent_id = agentId;
  for (let attempt = 0; ; attempt++) {
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: home, USERPROFILE: home },
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) {
        throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      }
      // Never blocks: silent or not, every path exits 0.
      expect(res.status).toBe(0);
      return res;
    }
  }
}

/** stdout must be exactly one PostToolUse envelope — no plain text beside it. */
function envelope(stdout) {
  const out = JSON.parse(stdout);
  expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
  expect(out.hookSpecificOutput).toEqual({ hookEventName: "PostToolUse", additionalContext: expect.any(String) });
  return out.hookSpecificOutput.additionalContext;
}

/** What the model reads from one run; '' when the hook sent nothing. */
function runHook(dir, call, opts) {
  const { stdout } = runHookRaw(dir, call, opts);
  return stdout ? envelope(stdout) : "";
}

// A PostToolUse hook reaches the model only through
// hookSpecificOutput.additionalContext — its plain stdout lands in the
// transcript as `hook_success` and nowhere else (CONVENTIONS.md, verified live
// 2026-09-25). Until 0.2.0 this hook wrote plain stdout: no report was ever read.
describe("post.claude.budget — reaches the model", () => {
  test("an over-budget, growing write sends one envelope; the summary stays on stderr", () => {
    const dir = project();
    const file = path.join(dir, "CLAUDE.md");
    const res = runHookRaw(dir, write(file, 40), { sessionId: nextSid() });
    const context = envelope(res.stdout);
    expect(context).toContain(`[claude-file-budget] ${file}`);
    expect(context).toContain("CLAUDE.md is now 40 lines against a 25-line budget, and just got rewritten in full.");
    expect(context).toContain("content-conventions.md");
    expect(res.stderr).toBe("[claude-file-budget] WARNING — CLAUDE.md is 40 lines (budget 25, full rewrite)\n");
  });

  test("silent cases send nothing on either channel", () => {
    const dir = project();
    const sid = nextSid();
    const claude = path.join(dir, "CLAUDE.md");
    // Thunks: each call puts its own file state on disk right before its run.
    for (const call of [
      () => write(claude, 20), // within budget
      () => edit(claude, 40, -3), // over budget, but shrinking
      () => edit(claude, 40, 0), // over budget, net zero
      () => write(path.join(dir, "README.md"), 900), // not Claude context
      () => write(path.join(dir, "src", "big.js"), 900), // not markdown
    ]) {
      const res = runHookRaw(dir, call(), { sessionId: sid });
      expect(res.stdout).toBe("");
      expect(res.stderr).toBe("");
    }
  });
});

// Delivered, a report stays in the context for the rest of the session: once
// per file per severity per context, never a window after which the same text
// lands there a second time.
describe("post.claude.budget — once per file per severity per context", () => {
  test("further growth of a reported file stays silent — hours later too", () => {
    const dir = project();
    const sid = nextSid();
    const file = path.join(dir, "CLAUDE.md");
    expect(runHook(dir, write(file, 40), { sessionId: sid })).toContain("[claude-file-budget]");
    expect(runHookRaw(dir, edit(file, 42, 2), { sessionId: sid }).stdout).toBe("");
    age(dir, 3 * HOURS);
    expect(runHookRaw(dir, edit(file, 44, 2), { sessionId: sid }).stdout).toBe("");
  });

  test("an escalation to critical is new information and reports once more", () => {
    const dir = project();
    const sid = nextSid();
    const file = path.join(dir, "CLAUDE.md");
    runHook(dir, write(file, 40), { sessionId: sid });
    expect(runHook(dir, edit(file, 60, 20), { sessionId: sid })).toContain("past the 50-line ceiling");
    expect(runHookRaw(dir, edit(file, 61, 1), { sessionId: sid }).stdout).toBe("");
  });

  test("another file and another session each get their own report", () => {
    const dir = project();
    const sid = nextSid();
    const first = path.join(dir, "CLAUDE.md");
    const second = path.join(dir, "packages", "app", "CLAUDE.md");
    expect(runHook(dir, write(first, 40), { sessionId: sid })).toContain(first);
    expect(runHook(dir, write(second, 40), { sessionId: sid })).toContain(second);
    expect(runHook(dir, write(first, 40), { sessionId: nextSid() })).toContain(first);
  });

  // A subagent's report lands in the subagent's context, never the main
  // thread's — sharing one marker let whichever wrote first silence the other.
  test("a subagent is its own context: its report never spends the main thread's", () => {
    const dir = project();
    const sid = nextSid();
    const file = path.join(dir, "CLAUDE.md");
    expect(runHook(dir, write(file, 40), { sessionId: sid, agentId: "a1" })).toContain("[claude-file-budget]");
    expect(runHookRaw(dir, write(file, 40), { sessionId: sid, agentId: "a1" }).stdout).toBe("");
    expect(runHook(dir, write(file, 40), { sessionId: sid })).toContain("[claude-file-budget]");
    expect(runHookRaw(dir, write(file, 40), { sessionId: sid }).stdout).toBe("");
    expect(runHook(dir, write(file, 40), { sessionId: sid, agentId: "a2" })).toContain("[claude-file-budget]");
  });

  // runOnce keys an id-less payload on the literal "unknown", one marker for
  // every such session; strict-once there would silence the file for good.
  test("without a session_id the 2-hour window stays", () => {
    const dir = project();
    const file = path.join(dir, "CLAUDE.md");
    expect(runHook(dir, write(file, 40))).toContain("[claude-file-budget]");
    expect(runHookRaw(dir, write(file, 40)).stdout).toBe("");
    age(dir, 3 * HOURS);
    expect(runHook(dir, write(file, 40))).toContain("[claude-file-budget]");
  });
});
