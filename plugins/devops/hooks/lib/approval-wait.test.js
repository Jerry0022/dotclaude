import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression (2026-10-25): a background agent waited on a tool permission
// dialog while the title still said `⏳ ➜ 🤖 Team ┃ …` — nothing woke the idle
// main thread to show the user it was their move.

const require = createRequire(import.meta.url);
const W = require("./approval-wait.js");
const S = require("./title-scheme.js");
const { interruptedFor } = require("./stale-titles.js");
const { staleWorkTitle } = require("./session-title.js");
const ask = require("./ask-title.js");
const flag = require("../permission-request/perm.approval.flag.js");
const watch = require("../permission-request/perm.approval.watch.js");
const STOP = fileURLToPath(new URL("../stop/stop.flow.guard.js", import.meta.url));

const TEAM = "⏳ ➜ 🤖 Team ┃ Concept analysis";
const TEAM_WAIT = "👉 ➜ 🤖 Team ┃ Concept analysis";

let dir;
let sid;
let n = 0;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "approval-wait-"));
  sid = `approval-test-${process.pid}-${Date.now()}-${n++}`;
});
afterEach(() => {
  for (const p of [W.STATE_PREFIX, W.WAKE_PREFIX, "dotclaude-devops-work-happened"]) {
    try { fs.unlinkSync(path.join(os.tmpdir(), `${p}-${sid}.lock`)); } catch { /* none */ }
    try { fs.unlinkSync(path.join(os.tmpdir(), `${p}-${sid}`)); } catch { /* not written */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A main transcript named like the real one, so mainTranscript() takes it. */
function transcript(lines) {
  const file = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}
const titleEntry = (t) => ({ type: "custom-title", customTitle: t });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const endedTurn = { type: "assistant", timestamp: ago(60_000), message: { content: [{ type: "text", text: "done" }] } };
const req = (extra = {}) => ({ session_id: sid, agent_id: "agent-1", tool_name: "Bash", tool_input: { command: "npm test" }, ...extra });

describe("title-scheme: the approval head", () => {
  test("⏳ Team / Solo / Testing → 👉 with the activity kept", () => {
    expect(S.approvalTitle(TEAM)).toBe(TEAM_WAIT);
    expect(S.approvalTitle("⏳ ➜ 🤖 Solo ┃ X")).toBe("👉 ➜ 🤖 Solo ┃ X");
    expect(S.approvalTitle("⏳ ➜ 🧪 Testing ┃ X")).toBe("👉 ➜ 🧪 Testing ┃ X");
    expect(S.approvalTitle("⏳ X")).toBe("👉 ➜ 🤖 Solo ┃ X");
  });

  test("ship, concept, batch, outcomes, questions and unknown titles stay", () => {
    for (const t of ["⏳ ➜ 🚀 Shipping ┃ X", "⏳ ➜ 🧭 Concept ┃ X", "👉 ➜ 🧭 Concept ┃ X", "👉 ➜ 📚 Batch ┃ X",
      "🟩 ➜ 🚀 Released Alpha ┃ X", "👉 ➜ ❓ Question ┃ X", TEAM_WAIT, "X", "", null]) {
      expect(S.approvalTitle(t), String(t)).toBeNull();
    }
  });

  test("👉 → ⏳ restores the same head; classify and strip know it", () => {
    expect(S.approvalRestoredTitle(TEAM_WAIT)).toBe(TEAM);
    expect(S.approvalRestoredTitle("👉 ➜ 🤖 Solo ┃ X")).toBe("⏳ ➜ 🤖 Solo ┃ X");
    expect(S.approvalRestoredTitle(TEAM)).toBeNull();
    expect(S.approvalRestoredTitle("👉 ➜ 📦 Ready ┃ X")).toBeNull();
    expect(S.classify(TEAM_WAIT)).toBe("approval");
    expect(S.stripPrefixes(TEAM_WAIT)).toBe("Concept analysis");
  });

  test("crash sweep, stale notification turn and a question after the wait know the head", () => {
    expect(interruptedFor(TEAM_WAIT)).toBe("👉 ➜ ⚡ Interrupted ┃ Concept analysis");
    expect(staleWorkTitle(TEAM_WAIT)).toBe("👉 ➜ ⚡ Interrupted ┃ Concept analysis");
    expect(ask.restoredTitle("👉 ➜ ❓ Question ┃ Concept analysis", TEAM_WAIT)).toBe(TEAM);
  });
});

describe("approval-wait: the waiting calls", () => {
  test("record is idempotent and ignores main-thread prompts", () => {
    const e = W.record(req(), 1000);
    expect(W.record(req(), 2000)).toEqual(e);
    expect(W.readEntries(sid, 3000)).toHaveLength(1);
    expect(W.record({ ...req(), agent_id: undefined })).toBeNull();
  });

  test("the answered call clears its own entry", () => {
    const e = W.record(req(), 1000);
    expect(W.clear({ ...req(), duration_ms: 50 }, 5000)).toBe(1);
    expect(W.isWaiting(sid, e, 6000)).toBe(false);
    expect(fs.existsSync(W.statePath(sid))).toBe(false);
  });

  test("a call started after the dialog clears it (denied); one started before does not", () => {
    W.record(req(), 10_000);
    const other = { ...req(), tool_name: "Read", tool_input: { file_path: "a" } };
    expect(W.clear({ ...other, duration_ms: 8000 }, 12_000)).toBe(0); // started 4000 < 10000: parallel
    expect(W.clear({ ...other, duration_ms: 100 }, 12_000)).toBe(1); // started 11900: moved on
  });

  test("another agent's calls leave the entry; SubagentStop clears it", () => {
    W.record(req(), 1000);
    expect(W.clear({ ...req(), agent_id: "agent-2", duration_ms: 1 }, 5000)).toBe(0);
    expect(W.clear({ session_id: sid, agent_id: "agent-1", hook_event_name: "SubagentStop" }, 5000)).toBe(1);
  });

  test("a finished call without duration_ms clears only its own entry", () => {
    W.record(req(), 1000);
    const other = { ...req(), tool_name: "Read", tool_input: { file_path: "a" } };
    expect(W.clear(other, 5000)).toBe(0);
    expect(W.clear(req(), 5000)).toBe(1);
  });

  test("parallel writers lose no entry (lock)", async () => {
    const { spawn } = await import("node:child_process");
    const lib = fileURLToPath(new URL("./approval-wait.js", import.meta.url));
    const run = (i) => new Promise((res) => {
      const code = `require(${JSON.stringify(lib)}).record({session_id:${JSON.stringify(sid)},agent_id:"a${i}",tool_name:"Bash",tool_input:{i:${i}}})`;
      spawn(process.execPath, ["-e", code]).on("exit", res);
    });
    await Promise.all([0, 1, 2, 3, 4, 5].map(run));
    expect(W.readEntries(sid)).toHaveLength(6);
    expect(fs.existsSync(`${W.statePath(sid)}.lock`)).toBe(false);
  });

  test("a stale lock from a killed hook is taken over", () => {
    fs.writeFileSync(`${W.statePath(sid)}.lock`, "");
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(`${W.statePath(sid)}.lock`, old, old);
    expect(W.record(req())).not.toBeNull();
    expect(W.readEntries(sid)).toHaveLength(1);
  });

  test("an entry expired past the watch deadline counts as answered", async () => {
    const t = transcript([titleEntry(TEAM_WAIT), endedTurn]);
    const old = Date.now() - W.MAX_AGE_MS + 50;
    W.record(req(), old);
    const out = await watch.main({ ...req(), transcript_path: t }, { pollMs: 20, deadlineMs: 5000 });
    expect(out.block).toContain(JSON.stringify(TEAM));
  });

  test("expired entries are dropped", () => {
    W.record(req(), 1000);
    expect(W.readEntries(sid, 1000 + W.MAX_AGE_MS)).toEqual([]);
  });

  test("isMainIdle: an ended turn is idle, a pending tool call or prompt is not", () => {
    const line = (e) => JSON.stringify(e);
    expect(W.isMainIdle(line(endedTurn))).toBe(true);
    expect(W.isMainIdle(line({ ...endedTurn, timestamp: new Date().toISOString() }))).toBe(false);
    expect(W.isMainIdle(line({ type: "assistant", timestamp: ago(60_000), message: { content: [{ type: "tool_use", name: "Bash" }] } }))).toBe(false);
    expect(W.isMainIdle(line({ type: "user", message: { content: "hi" } }))).toBe(false);
    const side = { type: "assistant", isSidechain: true, message: { content: [{ type: "tool_use", name: "Bash" }] } };
    expect(W.isMainIdle([line(endedTurn), line(side)].join("\n"))).toBe(true);
    expect(W.isMainIdle("")).toBe(false);
  });

  test("onlyRenamedSince: a rename-only turn yes, any other call no", () => {
    const at = Date.now() - 5000;
    const call = (name, ts = new Date().toISOString()) => JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", name }] } });
    expect(W.onlyRenamedSince([call("Bash", ago(60_000)), call("ToolSearch"), call("mcp__ccd_session_mgmt__set_session_title")].join("\n"), at)).toBe(true);
    expect(W.onlyRenamedSince([call("mcp__ccd_session_mgmt__set_session_title"), call("Bash")].join("\n"), at)).toBe(false);
    expect(W.onlyRenamedSince(call("Bash", ago(60_000)), at)).toBe(false);
  });
});

describe("perm.approval.flag / perm.approval.watch", () => {
  test("⏳ Team → wake with the 👉 title; an idle main thread marks the wake turn silent", () => {
    const t = transcript([titleEntry(TEAM), endedTurn]);
    const out = flag.main({ ...req(), transcript_path: t });
    expect(out.block).toContain(W.MARKER);
    expect(out.block).toContain(JSON.stringify(TEAM_WAIT));
    expect(W.wakePending(sid)).toBe(true);
  });

  test("mid-turn → wake text, no silent flag", () => {
    const busy = { type: "assistant", timestamp: ago(60_000), message: { content: [{ type: "tool_use", name: "Bash" }] } };
    const out = flag.main({ ...req(), transcript_path: transcript([titleEntry(TEAM), busy]) });
    expect(out.block).toContain(JSON.stringify(TEAM_WAIT));
    expect(W.wakePending(sid)).toBe(false);
  });

  test("ship title, main-thread prompt and unknown title stay silent (fail-open)", () => {
    expect(flag.main({ ...req(), transcript_path: transcript([titleEntry("⏳ ➜ 🚀 Shipping ┃ X"), endedTurn]) })).toBeNull();
    expect(flag.main({ ...req(), agent_id: undefined, transcript_path: transcript([titleEntry(TEAM)]) })).toBeNull();
    expect(flag.main({ ...req(), transcript_path: path.join(dir, "missing", `${sid}.jsonl`) })).toBeNull();
  });

  test("watch restores ⏳ once the dialog is answered", async () => {
    const t = transcript([titleEntry(TEAM_WAIT), endedTurn]);
    const pending = watch.main({ ...req(), transcript_path: t }, { pollMs: 10, deadlineMs: 5000 });
    await new Promise((r) => setTimeout(r, 30));
    W.clear({ ...req(), duration_ms: 1 });
    const out = await pending;
    expect(out.block).toContain(JSON.stringify(TEAM));
  });

  test("watch stays silent while another dialog still waits, or past its deadline", async () => {
    const t = transcript([titleEntry(TEAM_WAIT), endedTurn]);
    W.record({ ...req(), agent_id: "agent-2" });
    const pending = watch.main({ ...req(), transcript_path: t }, { pollMs: 10, deadlineMs: 5000 });
    await new Promise((r) => setTimeout(r, 30));
    W.clear({ ...req(), duration_ms: 1 });
    expect(await pending).toBeNull();
    expect(await watch.main({ ...req(), agent_id: "agent-3", transcript_path: t }, { pollMs: 10, deadlineMs: 30 })).toBeNull();
  });
});

describe("stop.flow.guard: the wake turn", () => {
  function runStop(lines) {
    const t = transcript(lines);
    fs.writeFileSync(path.join(os.tmpdir(), `dotclaude-devops-work-happened-${sid}`), "1");
    const r = spawnSync(process.execPath, [STOP], {
      input: JSON.stringify({ session_id: sid, transcript_path: t, cwd: dir, stop_hook_active: false }),
      encoding: "utf8",
      timeout: 30_000,
    });
    return r.stdout || "";
  }
  const rename = (title) => ({ type: "assistant", timestamp: new Date().toISOString(),
    message: { content: [{ type: "tool_use", name: "mcp__ccd_session_mgmt__set_session_title", input: { session_id: "self", title } }] } });

  test("a rename-only wake turn needs no card", () => {
    W.markWake(sid, Date.now() - 1000);
    expect(runStop([titleEntry(TEAM), endedTurn, rename(TEAM_WAIT)])).not.toContain('"block"');
    expect(W.wakePending(sid)).toBe(false);
  });

  test("a turn that did real work still owes its card", () => {
    W.markWake(sid, Date.now() - 1000);
    const bash = { type: "assistant", timestamp: new Date().toISOString(), message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } };
    expect(runStop([titleEntry(TEAM), endedTurn, rename(TEAM_WAIT), bash])).toContain('"block"');
  });
});
