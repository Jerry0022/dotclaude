import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// End-to-end through the real Stop hook: a test run the harness put in the
// background verifies nothing at launch. The gate settles it from its
// task-notification before it decides, and does not block while it still runs.
const STOP_HOOK = path.join(__dirname, "stop.flow.browsertest.js");
const SESSION = "bgrun-e2e";
const TASK = "b68oycrr6";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browsertest-bgrun-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(dir + "-tmp", { recursive: true });
  return dir;
}

function cleanup(dir) {
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
}

const flagPath = (dir, name) => path.join(dir + "-tmp", `dotclaude-devops-${name}-${SESSION}`);
const hasFlag = (dir, name) => fs.existsSync(flagPath(dir, name));

/** A code change that still owes a passing test run, and the run launched for it. */
function oweWithBackgroundRun(dir, launchedAt) {
  fs.writeFileSync(flagPath(dir, "light-pending"), path.join(dir, "a.js"));
  fs.writeFileSync(flagPath(dir, "light-kind"), "runner");
  fs.writeFileSync(flagPath(dir, "light-bgrun"), `${TASK} ${launchedAt}`);
}

/** The transcript as it stands once the task ended: its notification, and the output file it names. */
function transcriptWithEnd(dir, status, summary, output) {
  const out = path.join(dir, `${TASK}.output`);
  fs.writeFileSync(out, output);
  const transcript = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>${TASK}</task-id>\n<output-file>${out}</output-file>\n` +
      `<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`,
  }) + "\n");
  return transcript;
}

function stop(dir, transcriptPath) {
  const tmp = dir + "-tmp";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STOP_HOOK], {
      cwd: dir,
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", reject);
    child.on("close", () => resolve(out));
    child.stdin.end(JSON.stringify({
      session_id: SESSION, cwd: dir, stop_hook_active: false,
      transcript_path: transcriptPath || path.join(dir, "missing-transcript.jsonl"),
    }));
  });
}

describe("stop.flow.browsertest — a test run in the background", () => {
  test("still running → no block, and every flag stays for the Stop that sees its result", async () => {
    const dir = project();
    try {
      oweWithBackgroundRun(dir, Date.now() - 60_000);
      expect(await stop(dir)).toBe("");
      expect(hasFlag(dir, "light-pending")).toBe(true);
      expect(hasFlag(dir, "light-bgrun")).toBe(true);
      expect(hasFlag(dir, "light-blockcount")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("its green result settles at the Stop → no block, gate flags reset", async () => {
    const dir = project();
    try {
      oweWithBackgroundRun(dir, Date.now());
      const transcript = transcriptWithEnd(dir, "completed",
        'Background command "Run the suite" completed (exit code 0)',
        " Test Files  2 passed (2)\n      Tests  57 passed (57)");
      expect(await stop(dir, transcript)).toBe("");
      expect(hasFlag(dir, "light-pending")).toBe(false);
      expect(hasFlag(dir, "light-bgrun")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("its red result settles at the Stop → block with the red-run reason", async () => {
    const dir = project();
    try {
      oweWithBackgroundRun(dir, Date.now());
      const transcript = transcriptWithEnd(dir, "failed",
        'Background command "Run the suite" failed with exit code 1',
        " Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 56 passed (57)");
      const decision = JSON.parse(await stop(dir, transcript));
      expect(decision.decision).toBe("block");
      expect(decision.reason).toMatch(/FAILED/);
      expect(hasFlag(dir, "light-pending")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("a run without a result past 30 minutes no longer keeps the gate from blocking", async () => {
    const dir = project();
    try {
      oweWithBackgroundRun(dir, Date.now() - 31 * 60_000);
      const decision = JSON.parse(await stop(dir));
      expect(decision.decision).toBe("block");
      expect(hasFlag(dir, "light-bgrun")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("stop.flow.browsertest — background agents that may still change files", () => {
  const LAUNCH =
    "Async agent launched successfully. (This tool result is internal metadata — never quote or " +
    "paste any part of it, including the agentId below, into a user-facing reply.)\n" +
    "agentId: a75d674f7108dd6c8 (internal ID - do not mention to user. Use SendMessage with to: " +
    "'a75d674f7108dd6c8', summary: '<5-10 word recap>' to continue this agent.)\n" +
    "The agent is working in the background.";

  function transcriptWithAgent(dir, subagentType, { finished = false } = {}) {
    const lines = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Agent", input: { subagent_type: subagentType, run_in_background: true } }] } }),
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: LAUNCH, tool_use_id: "toolu_1" }] } }),
    ];
    if (finished) {
      lines.push(JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "<task-notification>\n<task-id>a75d674f7108dd6c8</task-id>\n<status>completed</status>\n<summary>Agent done</summary>\n</task-notification>" }));
    }
    const file = path.join(dir, "agent-transcript.jsonl");
    fs.writeFileSync(file, lines.join("\n") + "\n");
    return file;
  }

  function owe(dir) {
    fs.writeFileSync(flagPath(dir, "light-pending"), path.join(dir, "a.js"));
    fs.writeFileSync(flagPath(dir, "light-kind"), "runner");
  }

  test("an implementing agent still running → no forced verification turn, every flag kept", async () => {
    const dir = project();
    try {
      owe(dir);
      expect(await stop(dir, transcriptWithAgent(dir, "devops:frontend"))).toBe("");
      expect(hasFlag(dir, "light-pending")).toBe(true);
      expect(hasFlag(dir, "light-blockcount")).toBe(false);
    } finally { cleanup(dir); }
  });

  test("once it finished, the owed check is enforced again", async () => {
    const dir = project();
    try {
      owe(dir);
      const decision = JSON.parse(await stop(dir, transcriptWithAgent(dir, "devops:frontend", { finished: true })));
      expect(decision.decision).toBe("block");
    } finally { cleanup(dir); }
  });

  test("a read-only agent (research, qa, redteam) defers nothing", async () => {
    const dir = project();
    try {
      for (const role of ["devops:research", "devops:qa", "devops:redteam", "Explore"]) {
        owe(dir);
        try { fs.unlinkSync(flagPath(dir, "light-blockcount")); } catch { /* none */ }
        const decision = JSON.parse(await stop(dir, transcriptWithAgent(dir, role)));
        expect(decision.decision, role).toBe("block");
      }
    } finally { cleanup(dir); }
  });
});

// #612 — a skip the completion card recorded (light-skipped) is a justified
// skip: the Stop after the card neither blocks nor asks for prose below it.
describe("stop.flow.browsertest — a skip recorded by the completion card", () => {
  function owe(dir) {
    fs.writeFileSync(flagPath(dir, "light-pending"), path.join(dir, "a.js"));
    fs.writeFileSync(flagPath(dir, "light-kind"), "runner");
  }

  test("owed check + card-recorded skip → no block, the cycle's flags reset", async () => {
    const dir = project();
    try {
      owe(dir);
      fs.writeFileSync(flagPath(dir, "light-skipped"), "plugin hook, no startable surface");
      expect(await stop(dir)).toBe("");
      expect(hasFlag(dir, "light-pending")).toBe(false);
      expect(hasFlag(dir, "light-skipped")).toBe(false);
      expect(hasFlag(dir, "light-blockcount")).toBe(false);
    } finally { cleanup(dir); }
  });

  test("without it the owed check still blocks, and the reason names the card field", async () => {
    const dir = project();
    try {
      owe(dir);
      const decision = JSON.parse(await stop(dir));
      expect(decision.decision).toBe("block");
      expect(decision.reason).toMatch(/verification: \{ skipped: true, reason/);
    } finally { cleanup(dir); }
  });
});
