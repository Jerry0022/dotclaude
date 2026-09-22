import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
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

function stop(dir, transcriptPath, extra = {}) {
  const tmp = dir + "-tmp";
  const res = spawnSync(process.execPath, [STOP_HOOK], {
    cwd: dir,
    input: JSON.stringify({ session_id: SESSION, cwd: dir, stop_hook_active: false, transcript_path: transcriptPath, ...extra }),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    timeout: 20_000,
  });
  return res.stdout || "";
}

describe("stop.flow.guard — a rendered card must also be relayed (#449)", () => {
  test("flag set, card markdown relayed as the last text → pass", () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const out = stop(dir, transcript(dir, `### **${MARKER} Card relay guarded ${MARKER}**\n\n---`));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("Desktop marker comment counts as relayed", () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const out = stop(dir, transcript(dir, `<!-- ${MARKER} Card relay guarded ${MARKER} -->`));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("flag set, the turn ended on other text → block once", () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const t = transcript(dir, "Release ran, all good.");
      const out = stop(dir, t);
      expect(out).toContain('"decision":"block"');
      expect(out).toContain("never relayed");
      // The follow-up stop cycle yields, whatever the answer was.
      expect(stop(dir, t, { stop_hook_active: true }).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("unreadable transcript → the flag alone still passes", () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      setFlag(dir, "card-rendered");
      const out = stop(dir, path.join(dir, "missing.jsonl"));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("marker relayed but flag write failed → still counts as rendered", () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      const out = stop(dir, transcript(dir, `### **${MARKER} Card relay guarded ${MARKER}**`));
      expect(out.trim()).toBe("");
    } finally { cleanup(dir); }
  });
});
