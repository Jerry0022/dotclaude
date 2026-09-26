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
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
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
