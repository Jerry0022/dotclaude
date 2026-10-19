import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// F5 end to end through the real Stop hook: a turn that ends WITHOUT a card
// while the session title is still the bare "⏳ " is blocked once with the
// exact rename to "👉 ⚡ Interrupted – …". A batch title (a batch turn without
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
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
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
      expect(reason).toContain('mcp__ccd_session_mgmt__set_session_title {session_id:"self", title:"👉 ⚡ Interrupted – Refactor"}');
      expect(reason).toMatch(/no get_session/);
      expect(reason).toMatch(/no card/);
      expect(reason).not.toContain("render_completion_card");
      // The follow-up stop passes even though the transcript still says ⏳ — no loop.
      expect(await stop(dir, { transcript_path, stop_hook_active: true })).toBe("");
      // The marker is consumed: a later card-less turn on a bare ⏳ is renamed again.
      expect(await stop(dir, { transcript_path })).toMatch(/Interrupted – Refactor/);
    } finally {
      cleanup(dir);
    }
  });

  test("the legacy worded hourglass is treated as bare work too", async () => {
    const dir = project();
    try {
      const out = await stop(dir, { transcript_path: transcript(dir, "⏳ Working – Refactor") });
      expect(out).toContain("👉 ⚡ Interrupted – Refactor");
    } finally {
      cleanup(dir);
    }
  });

  test("batch, a waiting concept, a running ship and every named state stay untouched", async () => {
    for (const title of [
      "👉 📥 Batch – Ideen", "📥 Batch – Ideen",
      "👉 🧭 Concept – Billing", "🧭 Concept – Billing", "⏳ 🧭 Concept – Billing",
      "⏳ 🚀 Shipping – Login-Fix", "🚀 Shipping – Login-Fix",
      "⏳ 🤖 Agents – Refactor", "🟩 🚀 Released Alpha – Login-Fix", "👉 ⚡ Interrupted – Refactor",
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
});
