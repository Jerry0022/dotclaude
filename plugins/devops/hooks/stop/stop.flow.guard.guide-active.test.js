import { describe, test, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #526 end-to-end through the real Stop hook: a fresh guide-active marker
// under <project>/.claude/ must stop the card gate from forcing the turn to
// end, and a stale one must not.
const STOP_HOOK = path.join(__dirname, "stop.flow.guard.js");
const SESSION = "guide-active-e2e";

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guide-active-guard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(dir + "-tmp", { recursive: true });
  return dir;
}

function cleanup(dir) {
  for (const d of [dir, dir + "-tmp"]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}

function writeMarker(dir, ts) {
  fs.writeFileSync(path.join(dir, ".claude", "auto-guide-active.json"), JSON.stringify({ ts }));
}

function setFlag(dir, name) {
  fs.writeFileSync(path.join(dir + "-tmp", `dotclaude-devops-${name}-${SESSION}`), new Date().toISOString());
}

// No transcript file at all: an untouched turn with tool calls but no card —
// exactly what a mid-guide wait() loop looks like.
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
    child.stdin.end(JSON.stringify({
      session_id: SESSION, cwd: dir, stop_hook_active: false,
      transcript_path: path.join(dir, "missing-transcript.jsonl"), ...extra,
    }));
  });
}

describe("stop.flow.guard — guide-active exemption (#526)", () => {
  test("a fresh marker suppresses the card block", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      writeMarker(dir, Date.now());
      const out = await stop(dir);
      expect(out).toBe("");
    } finally {
      cleanup(dir);
    }
  });

  test("a marker older than 30 minutes no longer suppresses the block", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      writeMarker(dir, Date.now() - 31 * 60 * 1000);
      const out = await stop(dir);
      expect(out).toMatch(/"decision":"block"/);
    } finally {
      cleanup(dir);
    }
  });

  test("no marker at all behaves exactly as before (block)", async () => {
    const dir = project();
    try {
      setFlag(dir, "work-happened");
      const out = await stop(dir);
      expect(out).toMatch(/"decision":"block"/);
    } finally {
      cleanup(dir);
    }
  });
});
