import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** pre.session.archive — a live background autosave blocks archiving the session. */

const PRE = fileURLToPath(new URL("./pre.session.archive.js", import.meta.url));
const ARCHIVE = "mcp__ccd_session_mgmt__archive_session";
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pre-archive-run-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function run(sid, prompt) {
  const tmp = path.join(dir, ".tmp");
  const transcript = path.join(dir, "t.jsonl");
  fs.writeFileSync(transcript, `${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`);
  return spawnSync(process.execPath, [PRE], {
    cwd: dir,
    input: JSON.stringify({ tool_name: ARCHIVE, tool_input: { session_id: "self" }, session_id: sid, cwd: dir, transcript_path: transcript }),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
  });
}

describe("pre.session.archive — running autosave", () => {
  test("a live running marker blocks even a user-requested archive; dead pid and stale marker do not", () => {
    const marker = path.join(dir, ".tmp", "dotclaude-devops-autosave-running-s-run-1");
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, start: Date.now() }));
    const blocked = run("s-run-1", "bitte archivieren");
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain("autosave");
    fs.writeFileSync(marker, JSON.stringify({ pid: 2147483000, start: Date.now() }));
    expect(run("s-run-1", "bitte archivieren").status).toBe(0);
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, start: Date.now() - 11 * 60 * 1000 }));
    expect(run("s-run-1", "bitte archivieren").status).toBe(0);
  });
});
