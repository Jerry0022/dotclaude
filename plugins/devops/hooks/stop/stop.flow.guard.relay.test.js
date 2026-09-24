import { describe, test, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #449 end-to-end through the real Stop hook: the render flag says the card
// tool ran, the transcript says whether the user actually saw the card.
const STOP_HOOK = path.join(__dirname, "stop.flow.guard.js");
const MARKER = "✨✨✨";
const SESSION = "relay-e2e";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-guard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(dir + "-tmp", { recursive: true });
  return dir;
}

function cleanup(dir) {
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}

function setFlag(dir, name) {
  fs.writeFileSync(path.join(dir + "-tmp", `dotclaude-devops-${name}-${SESSION}`), new Date().toISOString());
}

function transcript(dir, ...texts) {
  const file = path.join(dir, "t.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: [{ type: "text", text: "ship it" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "mcp__plugin_devops_dotclaude-completion__render_completion_card", input: {} }] } },
    ...texts.map((text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } })),
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

// Desktop (§ 4): the card-body widget is the turn's last action, no markdown after it.
function widgetTranscript(dir, ...textsAfter) {
  const file = path.join(dir, "t.jsonl");
  const widget = {
    title: "completion_card_body",
    widget_code: '<div><h3 class="card-title" style="margin:0">Card relay guarded</h3></div>',
  };
  const lines = [
    { type: "user", message: { role: "user", content: [{ type: "text", text: "ship it" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "mcp__plugin_devops_dotclaude-completion__render_completion_card", input: {} }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "w1", name: "mcp__visualize__show_widget", input: widget }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "ok" }] } },
    ...textsAfter.map((text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } })),
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

// Async spawn, never spawnSync: a sync child blocks the vitest worker's event
// loop and fails a loaded full run with "Timeout calling onTaskUpdate".
function stop(dir, transcriptPath, extra = {}) {
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
    child.stdin.end(JSON.stringify({ session_id: SESSION, cwd: dir, stop_hook_active: false, transcript_path: transcriptPath, ...extra }));
  });
}

describe("stop.flow.guard — a rendered card must also be relayed (#449)", () => {
  test("flag set, card markdown relayed as the last text → pass", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const out = await stop(dir, transcript(dir, `### **${MARKER} Card relay guarded ${MARKER}**\n\n---`));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("Desktop: the card widget as the turn's last action counts as relayed — no markdown needed", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      expect((await stop(dir, widgetTranscript(dir))).trim()).toBe("");
      // blank text after the widget is still "nothing after it"
      expect((await stop(dir, widgetTranscript(dir, "\n"))).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  // Regression 2026-09-24: blocking here made the model show the same widget
  // again — two identical cards, plus one more stray line for the app's nudge.
  test("Desktop: text after the card widget → the card is on screen, pass — never a second card", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      setFlag(dir, "card-widget");
      const out = await stop(dir, widgetTranscript(dir, "Noch ein Nachsatz."));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("flag set, the turn ended on other text → block once", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const t = transcript(dir, "Release ran, all good.");
      const out = await stop(dir, t);
      expect(out).toContain('"decision":"block"');
      expect(out).toContain("never relayed");
      // The follow-up stop cycle yields, whatever the answer was.
      expect((await stop(dir, t, { stop_hook_active: true })).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("unreadable transcript → the flag alone still passes", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const out = await stop(dir, path.join(dir, "missing.jsonl"));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("Desktop render owed the widget, no show_widget call → block naming the file (#451)", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      setFlag(dir, "card-widget");
      const t = transcript(dir, `### **${MARKER} Card relay guarded ${MARKER}**`);
      const out = await stop(dir, t);
      expect(out).toContain('"decision":"block"');
      expect(out).toContain("Card widget skipped");
      expect(out).toContain(`dotclaude-devops-card-widget-${SESSION}`);
      // A block keeps the widget file for the retry to Read.
      expect(fs.existsSync(path.join(dir + "-tmp", `dotclaude-devops-card-widget-${SESSION}`))).toBe(true);
    } finally { cleanup(dir); }
  });

  test("Desktop render with the show_widget call → pass, widget file cleared", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      setFlag(dir, "card-widget");
      expect((await stop(dir, widgetTranscript(dir))).trim()).toBe("");
      expect(fs.existsSync(path.join(dir + "-tmp", `dotclaude-devops-card-widget-${SESSION}`))).toBe(false);
    } finally { cleanup(dir); }
  });

  test("marker relayed but flag write failed → still counts as rendered", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      const out = await stop(dir, transcript(dir, `### **${MARKER} Card relay guarded ${MARKER}**`));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });
});
