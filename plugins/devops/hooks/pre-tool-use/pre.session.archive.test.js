import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * pre.session.archive — the user's own refusal (de + en) blocks the
 * self-archive, even a released post-ship hand-over (audit row 8: the request
 * regex matched "bitte NICHT archivieren" as a request).
 */

const PRE = fileURLToPath(new URL("./pre.session.archive.js", import.meta.url));
const ARCHIVE = "mcp__ccd_session_mgmt__archive_session";
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pre-archive-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function run(sid, prompt, { released = false } = {}) {
  const tmp = path.join(dir, ".tmp");
  if (released) fs.writeFileSync(path.join(tmp, `dotclaude-devops-card-archive-released-${sid}`), "1");
  const transcript = path.join(dir, "t.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
  return spawnSync(process.execPath, [PRE], {
    cwd: dir,
    input: JSON.stringify({ tool_name: ARCHIVE, tool_input: { session_id: "self" }, session_id: sid, cwd: dir, transcript_path: transcript }),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
  });
}

const REFUSALS = [
  "nicht archivieren",
  "bitte NICHT archivieren",
  "die Session wird nicht archiviert",
  "ship es, aber nicht archiviert",
  "don't archive",
  "dont archive this session",
  "do not archive it",
  "Session behalten",
  "behalte die Session",
  "keep the session",
  "please keep this session open",
  "Session offen lassen",
  "lass die Session bitte offen lassen",
];

describe("pre.session.archive — the user's refusal", () => {
  test.each(REFUSALS)("%j blocks the self-archive the user did not ask for", (prompt) => {
    const r = run("s-neg-1", prompt);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/says not to archive/);
  });

  test.each(REFUSALS)("%j blocks even a released post-ship hand-over", (prompt) => {
    const r = run("s-neg-2", prompt, { released: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/says not to archive/);
  });

  test.each(["bitte archiviere diese Session", "Archive this session", "jetzt archivieren", "go ahead with archiving"])(
    "the plain request %j still archives", (prompt) => {
      expect(run("s-neg-3", prompt).status).toBe(0);
    });

  test.each([
    "fix das warum ich sie nicht archivieren kann...",
    "die Session lässt sich nicht archivieren",
    "warum kann ich die Session nicht archivieren?",
    "I can't archive this session",
  ])("an inability %j reads as a request, not a refusal", (prompt) => {
    expect(run("s-neg-6", prompt).status).toBe(0);
  });

  test("a refusal next to an ability verb in another clause still refuses", () => {
    const r = run("s-neg-7", "du kannst sie behalten, nicht archivieren");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/says not to archive/);
  });

  test("a released hand-over with an unrelated prompt still archives", () => {
    expect(run("s-neg-4", "ship it", { released: true }).status).toBe(0);
  });

  test("an unrelated prompt without a hand-over stays denied as not released", () => {
    const r = run("s-neg-5", "ship it");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not released/);
  });
});
