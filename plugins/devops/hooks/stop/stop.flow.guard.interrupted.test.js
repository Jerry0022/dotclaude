import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TITLE_SCHEME_MOD from "../lib/title-scheme.js";

// F5 end to end through the real Stop hook: a turn that ends WITHOUT a card
// while the session title is still the bare "⏳ " is blocked once with the
// exact rename to "👉 ➜ ⚡ Interrupted ┃ …". A batch title (a batch turn without
// a card is intended), a waiting concept and a running ship stay untouched,
// and the follow-up stop always passes — never a loop.
const STOP_HOOK = path.join(__dirname, "stop.flow.guard.js");
const SESSION = "interrupted-title-e2e";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interrupted-title-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(dir + "-tmp", { recursive: true });
  return dir;
}

function cleanup(dir) {
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ } }
}

/** A short chat turn (no tools, no substantial prose) with `title` as the sidebar title. */
function transcript(dir, title) {
  const p = path.join(dir, "transcript.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: "kurze Frage" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Ja." }] } },
  ];
  if (title !== null) lines.push({ type: "custom-title", customTitle: title, sessionId: SESSION });
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

/** Agent launch text as the harness writes it (id swapped for the fixture's). */
const AGENT_ID = "a75d674f7108dd6c8";
const AGENT_LAUNCH_TEXT =
  "Async agent launched successfully.\nagentId: " + AGENT_ID +
  " (internal ID - do not mention to user.)\nThe agent is working in the background.";
const BASH_BG_TEXT =
  "Command running in background with ID: b68oycrr6. Output is being written to: " +
  "C:\\Temp\\tasks\\b68oycrr6.output. You will be notified when it completes.";

/**
 * #833: a card-less turn that answers a task notification. A background agent
 * was launched and its notification arrived (so it is closed); `result` is the
 * text the notification carries; `bash` keeps a backgrounded command open.
 */
function notificationTranscript(dir, title, { result = "Agent finished.", bash = false, bashCmd = "npm test" } = {}) {
  const p = path.join(dir, "transcript.jsonl");
  const use = (id, name, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, text) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });
  const lines = [
    { type: "user", message: { role: "user", content: "ship it" } },
    use("toolu_1", "Agent", { subagent_type: "general-purpose", run_in_background: true, description: "Delegated ship", prompt: "x" }),
    res("toolu_1", AGENT_LAUNCH_TEXT),
  ];
  if (bash) {
    lines.push(use("toolu_2", "Bash", { command: bashCmd, description: "Run the suite", run_in_background: true }));
    lines.push(res("toolu_2", BASH_BG_TEXT));
  }
  const note = "<task-notification>\n<task-id>" + AGENT_ID + "</task-id>\n<status>completed</status>\n" +
    "<summary>Agent finished</summary>\n<result>" + result + "</result>\n</task-notification>";
  lines.push({ type: "queue-operation", operation: "enqueue", content: note });
  lines.push({ type: "user", message: { role: "user", content: note } });
  lines.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Fertig." }] } });
  lines.push({ type: "custom-title", customTitle: title, sessionId: SESSION });
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

function setFlag(dir, name) {
  fs.writeFileSync(path.join(dir + "-tmp", `dotclaude-devops-${name}-${SESSION}`), new Date().toISOString());
}

function stop(dir, extra = {}) {
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
    child.stdin.end(JSON.stringify({ session_id: SESSION, cwd: dir, stop_hook_active: false, ...extra }));
  });
}

describe("stop.flow.guard — F5 interrupted title", () => {
  test("a bare ⏳ title at a card-less turn end → one block with the exact Interrupted rename", async () => {
    const dir = project();
    try {
      const transcript_path = transcript(dir, "⏳ Refactor");
      const out = await stop(dir, { transcript_path });
      expect(out).toMatch(/"decision":"block"/);
      const reason = JSON.parse(out).reason;
      expect(reason).toContain('mcp__ccd_session_mgmt__set_session_title {session_id:"self", title:' + JSON.stringify("👉 ➜ ⚡ Interrupted ┃ Refactor") + "}");
      expect(reason).toMatch(/no get_session/);
      expect(reason).toMatch(/no card/);
      expect(reason).not.toContain("render_completion_card");
      // The follow-up stop passes even though the transcript still says ⏳ — no loop.
      expect(await stop(dir, { transcript_path, stop_hook_active: true })).toBe("");
      // The marker is consumed: a later card-less turn on a bare ⏳ is renamed again.
      expect(await stop(dir, { transcript_path })).toMatch(/⚡ Interrupted ┃ Refactor/);
    } finally {
      cleanup(dir);
    }
  });

  test("a card-less notification turn while another background agent still runs → never Interrupted", async () => {
    const dir = project();
    try {
      const p = notificationTranscript(dir, "⏳ Refactor");
      // A second agent, launched before and never notified: work continues.
      const lines = fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const second = "a1e64673538029e08";
      lines.splice(3, 0,
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "Agent", input: { subagent_type: "devops:frontend", run_in_background: true, description: "Overview", prompt: "x" } }] } },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", content: [{ type: "text", text: AGENT_LAUNCH_TEXT.replace(AGENT_ID, second) }] }] } });
      fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      expect(await stop(dir, { transcript_path: p })).not.toContain("Interrupted");
    } finally {
      cleanup(dir);
    }
  });

  test("the concept's working prefix is never renamed to Interrupted", async () => {
    const dir = project();
    try {
      expect(await stop(dir, { transcript_path: transcript(dir, "⏳ ➜ 🧭 Concept ┃ Refactor") })).not.toContain("Interrupted");
    } finally {
      cleanup(dir);
    }
  });

  test("the legacy worded hourglass is treated as bare work too", async () => {
    const dir = project();
    try {
      const out = await stop(dir, { transcript_path: transcript(dir, "⏳ Working – Refactor") });
      expect(out).toContain("👉 ➜ ⚡ Interrupted ┃ Refactor");
    } finally {
      cleanup(dir);
    }
  });

  test("batch, a waiting concept, a running ship and every named state stay untouched", async () => {
    for (const title of [
      "👉 ➜ 📚 Batch ┃ Ideen", "📥 Batch – Ideen",
      "👉 ➜ 🧭 Concept ┃ Billing", "🧭 Concept – Billing", "⏳ ➜ 🧭 Concept ┃ Billing",
      "⏳ ➜ 🚀 Shipping ┃ Login-Fix", "🚀 Shipping – Login-Fix",
      "⏳ ➜ 🤖 Team ┃ Refactor", "🟩 ➜ 🚀 Released Alpha ┃ Login-Fix", "👉 ➜ ⚡ Interrupted ┃ Refactor",
      "Plain title",
    ]) {
      const dir = project();
      try {
        expect(await stop(dir, { transcript_path: transcript(dir, title) }), title).toBe("");
      } finally {
        cleanup(dir);
      }
    }
  });

  test("no title in the transcript (terminal) or a rendered card → nothing", async () => {
    const dir = project();
    try {
      expect(await stop(dir, { transcript_path: transcript(dir, null) })).toBe("");
      setFlag(dir, "card-rendered");
      expect(await stop(dir, { transcript_path: transcript(dir, "⏳ Refactor") })).not.toContain("Interrupted");
    } finally {
      cleanup(dir);
    }
  });

  test("a silent tick never renames", async () => {
    const dir = project();
    try {
      setFlag(dir, "silent-turn");
      expect(await stop(dir, { transcript_path: transcript(dir, "⏳ Refactor") })).toBe("");
    } finally {
      cleanup(dir);
    }
  });

  test("#833: a Team ⏳ on a card-less notification turn takes the ship result's titlePrefix", async () => {
    const dir = project();
    try {
      const result = 'Done.\n```json\n{"status":"done","titlePrefix":"🟩 ➜ 🚀 Released Alpha ┃ "}\n```';
      const out = await stop(dir, { transcript_path: notificationTranscript(dir, "⏳ ➜ 🤖 Team ┃ Refactor", { result }) });
      expect(out).toMatch(/"decision":"block"/);
      expect(JSON.parse(out).reason).toContain("title:" + JSON.stringify("🟩 ➜ 🚀 Released Alpha ┃ Refactor"));
    } finally {
      cleanup(dir);
    }
  });

  test("#833: a Shipping ⏳ without a ship result in the transcript → Interrupted", async () => {
    const dir = project();
    try {
      const out = await stop(dir, { transcript_path: notificationTranscript(dir, "⏳ ➜ 🚀 Shipping ┃ Login-Fix") });
      expect(out).toMatch(/"decision":"block"/);
      expect(JSON.parse(out).reason).toContain("title:" + JSON.stringify("👉 ➜ ⚡ Interrupted ┃ Login-Fix"));
    } finally {
      cleanup(dir);
    }
  });

  test("#833: a ⏳ title stays while a background command of the session is still open", async () => {
    const dir = project();
    try {
      const out = await stop(dir, { transcript_path: notificationTranscript(dir, "⏳ ➜ 🚀 Shipping ┃ Login-Fix", { bash: true }) });
      expect(out).not.toContain("set_session_title");
      expect(out).not.toContain("Interrupted");
    } finally {
      cleanup(dir);
    }
  });
  test("#964: only a dev server open in the background → the ⏳ title drops like an idle end", async () => {
    const dir = project();
    try {
      const out = await stop(dir, { transcript_path: notificationTranscript(dir, "⏳ ➜ 🤖 Team ┃ Refactor", { bash: true, bashCmd: "ng serve --port 4200" }) });
      expect(out).toMatch(/"decision":"block"/);
      expect(JSON.parse(out).reason).toContain("title:" + JSON.stringify("👉 ➜ ⚡ Interrupted ┃ Refactor"));
    } finally {
      cleanup(dir);
    }
  });
});
