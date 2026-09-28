import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.ship.delegate.js");

let dir;

/** Temp project with devops enabled — otherwise plugin-guard exits 0 and every test passes vacuously. */
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-delegate-guard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function transcript(tokens) {
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ type: "user", message: { content: "hallo" } }),
    JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, output_tokens: 50 } } }),
  ].join("\n") + "\n");
  return file;
}

function run(toolName, toolInput, tokens, extra = {}) {
  const env = { ...process.env };
  delete env.DOTCLAUDE_SHIP_DELEGATE_THRESHOLD;
  delete env.DOTCLAUDE_SHIP_COMPACT_THRESHOLD;
  const payload = JSON.stringify({
    cwd: dir, session_id: "s1", tool_name: toolName, tool_input: toolInput,
    transcript_path: tokens == null ? undefined : transcript(tokens), ...extra,
  });
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = spawnSync(process.execPath, [HOOK], { cwd: dir, input: payload, encoding: "utf8", env });
    if (res.status !== null) break;
  }
  return { code: res.status, stderr: res.stderr || "" };
}

const SPAWN = 'Use Skill("devops:do-ship") with args "--delegated". session_id: s1. lang: de.\nBrief:\n...';

// prompt.ship.detect sees only user prompts. Measured 2026-09-27/28: ships the
// model started through the Skill tool (concept finalize, do-run backlog, an
// autonomous ship) ran inline at 219–951 k — half of the large-context ships.
describe("pre.ship.delegate — Skill-tool ships on a large context", () => {
  test("a do-run / concept / autonomous do-ship at 573 k is refused with the delegate instruction", () => {
    const r = run("Skill", { skill: "devops:do-ship", args: "--queued=1/4 --keep" }, 573_000);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("[pre.ship.delegate]");
    expect(r.stderr).toContain("[ship-delegate]");
    expect(r.stderr).toContain('with args "--delegated --queued=1/4 --keep"');
    expect(r.stderr).toContain("session_id: s1");
    expect(r.stderr).toContain("--inline");
  });

  test("passes: small context, unknown size, --delegated, --resume, --inline, other skills", () => {
    expect(run("Skill", { skill: "devops:do-ship", args: "" }, 180_000).code).toBe(0);
    expect(run("Skill", { skill: "devops:do-ship", args: "" }, null).code).toBe(0);
    expect(run("Skill", { skill: "devops:do-ship", args: "--delegated" }, 700_000).code).toBe(0);
    expect(run("Skill", { skill: "devops:do-ship", args: "--resume" }, 700_000).code).toBe(0);
    expect(run("Skill", { skill: "devops:do-ship", args: "--inline" }, 700_000).code).toBe(0);
    expect(run("Skill", { skill: "devops:auto-polish", args: "" }, 700_000).code).toBe(0);
  });

  test("a promotion that names its version never ships, so it stays inline", () => {
    expect(run("Skill", { skill: "devops:do-ship", args: "stable 0.193.0" }, 700_000).code).toBe(0);
  });

  test("inside a subagent the guard is silent", () => {
    expect(run("Skill", { skill: "devops:do-ship", args: "" }, 700_000, { agent_id: "a1" }).code).toBe(0);
  });
});

// Measured at 115 k: the delegated ship cost 28 % more than the inline one.
describe("pre.ship.delegate — a delegated spawn below the threshold", () => {
  test("at 115 k the spawn is refused: the subagent would cost more than inline", () => {
    const r = run("Agent", { subagent_type: "general-purpose", model: "opus", prompt: SPAWN }, 115_000);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("below the delegation threshold");
    expect(r.stderr).toContain('Skill("devops:do-ship")');
  });

  test("above the threshold, on unknown size, for a resume or another agent it passes", () => {
    expect(run("Agent", { prompt: SPAWN }, 450_000).code).toBe(0);
    expect(run("Agent", { prompt: SPAWN }, null).code).toBe(0);
    expect(run("Agent", { prompt: SPAWN.replace('"--delegated"', '"--delegated --resume"') }, 115_000).code).toBe(0);
    expect(run("Agent", { prompt: "Find every caller of x" }, 115_000).code).toBe(0);
  });
});
