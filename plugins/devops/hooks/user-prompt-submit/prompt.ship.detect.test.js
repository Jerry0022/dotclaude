import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionFile, writeSessionFile } from "../lib/session-id.js";

const HOOK = fileURLToPath(new URL("./prompt.ship.detect.js", import.meta.url));

let cwd;

/** Run the hook as the harness does: JSON on stdin, a git project as cwd
 *  (the hook is silent outside a work tree), plugin enabled in its settings
 *  so plugin-guard passes whatever the machine's global state is. */
function runHook(payload, env) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: "ship-detect-test", ...payload }),
    cwd,
    encoding: "utf8",
    env: { ...process.env, DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "", ...(env || {}) },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/** A transcript whose newest assistant call carried `tokens` of context. */
function transcript(tokens) {
  const file = path.join(cwd, "transcript.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { content: "hallo" } }),
    JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, output_tokens: 50 } } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ship-detect-test-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  execFileSync("git", ["init", "-q"], { cwd });
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

// The ship pipeline re-reads the whole context ~16 times. Above the threshold
// the hook hands the user the /compact command instead of starting the ship;
// below it, and whenever the size is unknown, the ship instruction is unchanged.
describe("prompt.ship.detect — careful compact", () => {
  test("small context: the ship instruction, no compact advice", () => {
    const r = runHook({ prompt: "/ship", transcript_path: transcript(90_000) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Skill("ship")');
    expect(r.stdout).not.toContain("[ship-compact]");
  });

  test("large context: the compact advice replaces the ship instruction", () => {
    const r = runHook({ prompt: "/ship", transcript_path: transcript(434_000) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("[ship-compact]");
    expect(r.stdout).toContain("434 k");
    expect(r.stdout).toContain("/compact ");
    expect(r.stdout).not.toContain('Skill("ship")');
  });

  test("an affirmation after edits is a ship too, and gets the same stop", () => {
    // the edit counter the affirmation path reads lives in the session file store
    writeSessionFile(sessionFile("dotclaude-devops-edits", "ship-detect-test"), "3");
    const r = runHook({ prompt: "ja", transcript_path: transcript(500_000) });
    expect(r.stdout).toContain("[ship-compact]");
  });

  test("--no-compact lets the large-context ship through", () => {
    const r = runHook({ prompt: "/ship --no-compact", transcript_path: transcript(434_000) });
    expect(r.stdout).toContain('Skill("ship")');
    expect(r.stdout).not.toContain("[ship-compact]");
  });

  test("no transcript path (unknown size) never stops a ship", () => {
    const r = runHook({ prompt: "/ship" });
    expect(r.stdout).toContain('Skill("ship")');
  });

  test("threshold 0 disables the stop", () => {
    const r = runHook({ prompt: "/ship", transcript_path: transcript(900_000) }, { DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "0" });
    expect(r.stdout).toContain('Skill("ship")');
  });

  afterEach(() => { try { fs.unlinkSync(sessionFile("dotclaude-devops-edits", "ship-detect-test")); } catch {} });

  test("a non-ship prompt is untouched", () => {
    const r = runHook({ prompt: "erklär mir cache reads", transcript_path: transcript(900_000) });
    expect(r.stdout).toBe("");
  });
});
