import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.agent.nudge.js");
const { run } = require("./post.agent.nudge.js");

const dirs = [];
afterAll(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-nudge-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  return dir;
}

/** An assistant tool_use entry editing `filePath` with `toolName`. */
function editEntry(toolName, filePath) {
  const input = toolName === "NotebookEdit" ? { notebook_path: filePath } : { file_path: filePath };
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: toolName, input }] } };
}

/** A Skill tool_use entry. */
function skillEntry(skill) {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill } }] } };
}

/** A real user prompt entry — opens a new turn. */
function promptEntry(text = "do stuff") {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
}

function writeTranscript(dir, entries) {
  const t = path.join(dir, "t.jsonl");
  fs.writeFileSync(t, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return t;
}

const SID = "agent-nudge-test-session";

function hookFor(dir, transcriptPath, filePath, extra = {}) {
  return {
    session_id: SID,
    cwd: dir,
    tool_name: "Edit",
    tool_input: { file_path: filePath },
    transcript_path: transcriptPath,
    ...extra,
  };
}

describe("post.agent.nudge", () => {
  test("files 1-5 in a turn: silent", () => {
    const dir = project();
    const priorFiles = [];
    for (let i = 1; i <= 5; i++) {
      const f = path.join(dir, `f${i}.js`);
      const entries = [promptEntry(), ...priorFiles.map((p) => editEntry("Edit", p))];
      const t = writeTranscript(dir, entries);
      expect(run(hookFor(dir, t, f))).toBe("");
      priorFiles.push(f);
    }
  });

  test("the 6th distinct file → exactly one note naming the auto-agents skill", () => {
    const dir = project();
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `g${i}.js`));
    const entries = [promptEntry(), ...files.map((p) => editEntry("Edit", p))];
    const t = writeTranscript(dir, entries);
    const sixth = path.join(dir, "g5.js");
    const out = run(hookFor(dir, t, sixth));
    expect(out).not.toBe("");
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("auto-agents");
  });

  test("file 7+ in the same turn: silent again", () => {
    const dir = project();
    const files = Array.from({ length: 6 }, (_, i) => path.join(dir, `h${i}.js`));
    const entries = [promptEntry(), ...files.map((p) => editEntry("Edit", p))];
    const t = writeTranscript(dir, entries);
    const seventh = path.join(dir, "h6.js");
    expect(run(hookFor(dir, t, seventh))).toBe("");
  });

  test("re-editing the same file does not advance the count", () => {
    const dir = project();
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `dup${i}.js`));
    // Edit dup0 twice plus the four others = still 5 distinct files.
    const entries = [promptEntry(), ...files.map((p) => editEntry("Edit", p)), editEntry("Edit", files[0])];
    const t = writeTranscript(dir, entries);
    expect(run(hookFor(dir, t, files[0]))).toBe("");
  });

  test("active run contract for this session: silent", () => {
    const dir = project();
    fs.writeFileSync(
      path.join(dir, ".claude", "run-contract.json"),
      JSON.stringify({
        v: 1, id: "contract-1", sessionId: SID, mode: "prompt", flow: "interactive", ship: "manual",
        armedAt: new Date().toISOString(), closedAt: null, items: [], milestones: [],
      })
    );
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `c${i}.js`));
    const entries = [promptEntry(), ...files.map((p) => editEntry("Edit", p))];
    const t = writeTranscript(dir, entries);
    expect(run(hookFor(dir, t, path.join(dir, "c5.js")))).toBe("");
  });

  test("auto-agents invoked via the Skill tool this turn: silent", () => {
    const dir = project();
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `s${i}.js`));
    const entries = [promptEntry(), skillEntry("devops:auto-agents"), ...files.map((p) => editEntry("Edit", p))];
    const t = writeTranscript(dir, entries);
    expect(run(hookFor(dir, t, path.join(dir, "s5.js")))).toBe("");
  });

  test("a subagent's edits: silent", () => {
    const dir = project();
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `a${i}.js`));
    const entries = [promptEntry(), ...files.map((p) => editEntry("Edit", p))];
    const t = writeTranscript(dir, entries);
    expect(run(hookFor(dir, t, path.join(dir, "a5.js"), { agent_id: "sub-1" }))).toBe("");
  });

  test("a file outside the session's own work tree: silent", () => {
    const dir = project();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agent-nudge-outside-"));
    dirs.push(outside);
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `o${i}.js`));
    const entries = [promptEntry(), ...files.map((p) => editEntry("Edit", p))];
    const t = writeTranscript(dir, entries);
    expect(run(hookFor(dir, t, path.join(outside, "o5.js")))).toBe("");
  });

  test("a new user turn resets the count", () => {
    const dir = project();
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `n${i}.js`));
    // Same 5 files edited in a PRIOR turn (before the latest prompt entry) —
    // the current turn only has this one edit, so the count is 1.
    const entries = [...files.map((p) => editEntry("Edit", p)), promptEntry("new turn")];
    const t = writeTranscript(dir, entries);
    expect(run(hookFor(dir, t, path.join(dir, "n5.js")))).toBe("");
  });

  test("NotebookEdit counts toward the distinct-file total", () => {
    const dir = project();
    const files = Array.from({ length: 5 }, (_, i) => path.join(dir, `nb${i}.ipynb`));
    const entries = [promptEntry(), ...files.map((p) => editEntry("NotebookEdit", p))];
    const t = writeTranscript(dir, entries);
    const out = run({
      session_id: SID, cwd: dir, tool_name: "NotebookEdit",
      tool_input: { notebook_path: path.join(dir, "nb5.ipynb") }, transcript_path: t,
    });
    expect(out).not.toBe("");
  });

  test("e2e: malformed stdin exits 0 silently", () => {
    const { spawnSync } = require("node:child_process");
    const dir = project();
    const res = spawnSync(process.execPath, [HOOK], {
      input: "not json",
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(res.status).toBe(0);
    expect(res.stdout || "").toBe("");
  });
});
