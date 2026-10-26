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
  return { code: res.status, stderr: res.stderr || "", stdout: res.stdout || "" };
}

const SPAWN = 'Use Skill("devops:do-ship") with args "--delegated". session_id: s1. lang: de.\nBrief:\n...';

// prompt.ship.detect sees only user prompts. Measured 2026-09-27/28: ships the
// model started through the Skill tool (concept finalize, do-run backlog, an
// autonomous ship) ran inline at 219–951 k — half of the large-context ships.
describe("pre.ship.delegate — Skill-tool ships on a large context", () => {
  test("a do-run / concept / autonomous do-ship at 873 k is refused with the delegate instruction", () => {
    const r = run("Skill", { skill: "devops:do-ship", args: "--queued=1/4 --keep" }, 873_000);
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
    expect(run("Agent", { prompt: SPAWN }, 750_000).code).toBe(0);
    expect(run("Agent", { prompt: SPAWN }, null).code).toBe(0);
    expect(run("Agent", { prompt: SPAWN.replace('"--delegated"', '"--delegated --resume"') }, 115_000).code).toBe(0);
    expect(run("Agent", { prompt: "Find every caller of x" }, 115_000).code).toBe(0);
  });
});

// #892: a hand-rolled ship subagent skipped the protocol and the Shipping title.
describe("pre.ship.delegate — bare ship subagent (#892)", () => {
  const BARE = 'Use Skill("devops:do-ship") with args "stable". session_id: s1.';
  test("a spawn running do-ship without --delegated is refused, at any context size", () => {
    for (const tokens of [115_000, 750_000, null]) {
      const r = run("Agent", { prompt: BARE }, tokens);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("[ship-delegate]");
      expect(r.stderr).toContain("--delegated");
    }
    expect(run("Agent", { prompt: "Run /do-ship now" }, 750_000).code).toBe(2);
    expect(run("Agent", { prompt: 'Use Skill("do-ship")' }, 750_000).code).toBe(2);
  });
  test("a corrected retry passes and asks for the Shipping title; a bare repeat is refused again", () => {
    expect(run("Agent", { prompt: BARE }, 750_000).code).toBe(2);
    expect(run("Agent", { prompt: BARE }, 750_000).code).toBe(2);
    const r = run("Agent", { prompt: SPAWN }, 750_000);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Shipping");
  });
  test("a passing mention of do-ship is no ship", () => {
    expect(run("Agent", { prompt: "QA brief: review the diff, don't run do-ship or ship anything." }, 750_000).code).toBe(0);
    expect(run("Agent", { prompt: "Implement #12. Do not run /do-ship — the runner ships." }, 750_000).code).toBe(0);
    expect(run("Agent", { prompt: "Fix the bug, ohne /devops:do-ship zu starten." }, 750_000).code).toBe(0);
  });
  test("a prefix-less delegated spawn still gets the below-threshold refusal", () => {
    expect(run("Agent", { prompt: 'Use Skill("do-ship") with args "--delegated".' }, 115_000).code).toBe(2);
  });
  test("a resume spawn passes", () => {
    expect(run("Agent", { prompt: 'Use Skill("devops:do-ship") with args "--resume".' }, 750_000).code).toBe(0);
  });
});

// #712: the finalize ship of an /auto-concept passes --card-data, so the
// caller renders the card after its close-out.
describe("pre.ship.delegate — concept finalize ship returns card data", () => {
  test("--card-data in the args is kept in the delegated args", () => {
    const r = run("Skill", { skill: "devops:do-ship", args: "--card-data beta" }, 873_000);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('with args "--delegated --card-data beta"');
    expect(r.stderr).toMatch(/Step 6a[\s\S]*render_completion_card with cardData/);
  });

  // Redteam: a state file alone (paused, stale, close-out-only #693) is no
  // finalize — its ship must not trigger a close-out.
  test("a concept state file alone adds no --card-data", () => {
    fs.writeFileSync(path.join(dir, ".claude", "concept-active.json"), JSON.stringify({ port: 8811, html_path: "docs/concepts/x.html" }));
    const r = run("Skill", { skill: "devops:do-ship", args: "beta" }, 873_000);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('with args "--delegated beta"');
    expect(r.stderr).not.toContain("--card-data");
  });

  test("no concept: no --card-data", () => {
    const r = run("Skill", { skill: "devops:do-ship", args: "beta" }, 873_000);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('with args "--delegated beta"');
    expect(r.stderr).not.toContain("--card-data");
  });
});

// Backlog run 2026-10-26: the Shipping-title context arrived with the spawn
// result, so a delegated ship never showed Shipping in the sidebar.
describe("pre.ship.delegate — Shipping title before a delegated spawn", () => {
  const SET = "mcp__ccd_session_mgmt__set_session_title";
  function titled(title, extra = []) {
    const file = path.join(dir, "titled.jsonl");
    fs.writeFileSync(file, [
      JSON.stringify({ type: "user", message: { content: "ship it" } }),
      JSON.stringify({ type: "custom-title", customTitle: title }),
      JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 2, cache_read_input_tokens: 450_000, cache_creation_input_tokens: 0, output_tokens: 50 } } }),
      ...extra.map((e) => JSON.stringify(e)),
    ].join("\n") + "\n");
    return file;
  }
  function spawn(file) {
    const r = spawnSync(process.execPath, [HOOK], {
      cwd: dir, encoding: "utf8",
      input: JSON.stringify({ cwd: dir, session_id: "s1", tool_name: "Agent", tool_input: { prompt: SPAWN }, transcript_path: file }),
    });
    return { code: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
  }

  test("a known non-Shipping title refuses the spawn with the exact set call", () => {
    const r = spawn(titled("⏳ ➜ 🤖 Team ┃ Backlog"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("[pre.ship.delegate:title]");
    expect(r.stderr).toContain(`${SET} {session_id:"self", title:"⏳ ➜ 🚀 Shipping ┃ Backlog"}`);
  });

  test("a set call to the Shipping title in the same message passes", () => {
    const set = { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: SET, input: { session_id: "self", title: "⏳ ➜ 🚀 Shipping ┃ Backlog" } }] } };
    expect(spawn(titled("⏳ ➜ 🤖 Team ┃ Backlog", [set])).code).toBe(0);
  });

  test("an already-Shipping title passes; a second refusal in one turn never happens", () => {
    expect(spawn(titled("⏳ ➜ 🚀 Shipping ┃ Backlog")).code).toBe(0);
    const refused = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: "[pre.ship.delegate:title] ..." }] } };
    expect(spawn(titled("⏳ ➜ 🤖 Team ┃ Backlog", [refused])).code).toBe(0);
  });
});
