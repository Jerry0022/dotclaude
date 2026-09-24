import { describe, test, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STOP_HOOK = path.join(__dirname, "stop.guide.handoff.js");
const SESSION = "guide-handoff-e2e";
const CARD = "✨✨✨";
const UPSTASH = "**Upstash anbinden — 5 Klicks:**\n\n1. Auf upstash.com einloggen\n2. Datenbank anlegen";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guide-handoff-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(dir + "-tmp", { recursive: true });
  return dir;
}

function cleanup(dir) {
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}

function transcriptWith(dir, prompt, ...assistantTexts) {
  const file = path.join(dir, "t.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } },
    ...assistantTexts.map((text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } })),
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

const transcript = (dir, ...texts) => transcriptWith(dir, "help me set this up", ...texts);

// Async spawn (never spawnSync — a sync child blocks the vitest worker's
// event loop, see stop.flow.guard.relay.test.js).
function runRaw(dir, stdin) {
  const tmp = dir + "-tmp";
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STOP_HOOK], {
      cwd: dir,
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ out, err, code }));
    child.stdin.end(stdin);
  });
}

async function stop(dir, transcriptPath, extra = {}) {
  const r = await runRaw(dir, JSON.stringify({
    session_id: SESSION, cwd: dir, stop_hook_active: false,
    transcript_path: transcriptPath, ...extra,
  }));
  return r.out;
}

function pendingFile(dir) {
  return path.join(dir + "-tmp", `dotclaude-devops-guide-handoff-pending-${SESSION}`);
}

vi.setConfig({ testTimeout: 30_000 });

describe("stop.guide.handoff", () => {
  test("web hand-off without a card and without web-guide → block once", async () => {
    const dir = project();
    try {
      const out = await stop(dir, transcript(dir, UPSTASH));
      expect(out).toContain('"decision":"block"');
      expect(out).toContain("Upstash");
      expect(out).toContain("web-guide");
      expect(out).toContain("auto-guide");
    } finally { cleanup(dir); }
  });

  test("same service again in the same session → silent", async () => {
    const dir = project();
    try {
      const t = transcript(dir, UPSTASH);
      await stop(dir, t);
      expect((await stop(dir, t)).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("hand-off in a CARD turn → never blocks, records a pending hint instead", async () => {
    const dir = project();
    try {
      const text = `${UPSTASH}\n\n### **${CARD} Upstash vorbereitet ${CARD}**\n\n› Status: bereit`;
      const out = await stop(dir, transcript(dir, text));
      expect(out.trim()).toBe("");
      const pending = JSON.parse(fs.readFileSync(pendingFile(dir), "utf8"));
      expect(pending.service).toBe("Upstash");
    } finally { cleanup(dir); }
  });

  test("card-only last entry + hand-off in an EARLIER entry of the turn → pending hint, no block (R8)", async () => {
    const dir = project();
    try {
      const t = transcript(dir, UPSTASH, "Kurz geprüft, Env-Variablen stehen.", `### **${CARD} Upstash vorbereitet ${CARD}**\n\n› Status: bereit`);
      const out = await stop(dir, t);
      expect(out.trim()).toBe("");
      const pending = JSON.parse(fs.readFileSync(pendingFile(dir), "utf8"));
      expect(pending.service).toBe("Upstash");
    } finally { cleanup(dir); }
  });

  test("hand-off in an earlier entry, no card anywhere → block (R8)", async () => {
    const dir = project();
    try {
      const out = await stop(dir, transcript(dir, UPSTASH, "Sag Bescheid, wenn du durch bist."));
      expect(out).toContain('"decision":"block"');
    } finally { cleanup(dir); }
  });

  test("a hand-off from a PREVIOUS turn is not rescanned (R8)", async () => {
    const dir = project();
    try {
      const file = path.join(dir, "t.jsonl");
      const lines = [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "set up upstash" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: UPSTASH }] } },
        { type: "user", message: { role: "user", content: [{ type: "text", text: "danke, weiter mit den Tests" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Tests laufen grün." }] } },
      ];
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      expect((await stop(dir, file)).trim()).toBe("");
      expect(fs.existsSync(pendingFile(dir))).toBe(false);
    } finally { cleanup(dir); }
  });

  test("a Desktop card widget ending the turn counts as a card too", async () => {
    const dir = project();
    try {
      const file = path.join(dir, "t.jsonl");
      const lines = [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "help me set this up" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: UPSTASH }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "w1", name: "mcp__visualize__show_widget",
          input: { title: "completion_card_body", widget_code: '<h3 class="card-title">Upstash vorbereitet</h3>' } }] } },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "ok" }] } },
      ];
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      const out = await stop(dir, file);
      expect(out.trim()).toBe("");
      expect(fs.existsSync(pendingFile(dir))).toBe(true);
    } finally { cleanup(dir); }
  });

  test("card turn with a GitHub PR URL and arrows → neither block nor pending", async () => {
    const dir = project();
    try {
      const text =
        "https://github.com/Jerry0022/dotclaude/pull/472 → CI grün → gemergt.\n\n" +
        `### **${CARD} Ship fertig ${CARD}**`;
      const out = await stop(dir, transcript(dir, text));
      expect(out.trim()).toBe("");
      expect(fs.existsSync(pendingFile(dir))).toBe(false);
    } finally { cleanup(dir); }
  });

  test("turn already invoked web-guide → silent", async () => {
    const dir = project();
    try {
      const file = path.join(dir, "t.jsonl");
      const lines = [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "connect upstash" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: { skill: "devops:auto-guide" } }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: UPSTASH }] } },
      ];
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      expect((await stop(dir, file)).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("stop_hook_active → never blocks again", async () => {
    const dir = project();
    try {
      expect((await stop(dir, transcript(dir, UPSTASH), { stop_hook_active: true })).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("machine-driven turn read from the transcript (silent flag already deleted) → silent", async () => {
    const dir = project();
    try {
      for (const prompt of ["Silently run the bridge poll", "<<autonomous-loop>> tick", "AUTONOMOUS_RESUME: go on", "<scheduled-task name=\"x\">run</scheduled-task>"]) {
        const out = await stop(dir, transcriptWith(dir, prompt, UPSTASH));
        expect(out.trim()).toBe("");
      }
    } finally { cleanup(dir); }
  });

  test("local CLI-only step list → silent", async () => {
    const dir = project();
    try {
      const t = transcript(dir, "Worktree manuell aufräumen: `git worktree remove --force ./wt`");
      expect((await stop(dir, t)).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test("no transcript → silent", async () => {
    const dir = project();
    try {
      expect((await stop(dir, path.join(dir, "missing.jsonl"))).trim()).toBe("");
    } finally { cleanup(dir); }
  });

  test.each([
    ["empty", ""],
    ["null", "null"],
    ["string", '"hello"'],
    ["array", "[]"],
    ["invalid JSON", "{nope"],
    ["BOM + object", "\uFEFF" + JSON.stringify({ session_id: SESSION, stop_hook_active: true })],
    ["CRLF object", '{\r\n"session_id": "x",\r\n"stop_hook_active": false\r\n}'],
  ])("malformed / odd stdin (%s) → exit 0, no output, no stderr", async (_name, stdin) => {
    const dir = project();
    try {
      const r = await runRaw(dir, stdin);
      expect(r.code).toBe(0);
      expect(r.out).toBe("");
      expect(r.err).toBe("");
    } finally { cleanup(dir); }
  });
});
