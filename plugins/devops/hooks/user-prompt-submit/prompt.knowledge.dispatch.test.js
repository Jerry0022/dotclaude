import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The per-prompt delegation nudge. Measured 2026-09-14 with `claude plugin
 * eval`: with the always-on policy injected at SessionStart alone, the model
 * still did web research inline; with this one line appended to the prompt
 * it spawned devops:research as its first action. Two things must hold:
 *
 *   1. the hook emits the nudge on every prompt (not one-shot like DK docs);
 *   2. the evals under evals/delegation/ carry the SAME text — the eval
 *      runner fires no UserPromptSubmit hooks, so the cases append it by hand.
 */

const HOOK = path.resolve(import.meta.dirname, "prompt.knowledge.dispatch.js");
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");

function nudgeFromSource() {
  const src = fs.readFileSync(HOOK, "utf8");
  const block = src.match(/const DELEGATION_NUDGE =\n([\s\S]*?);\n/);
  expect(block, "DELEGATION_NUDGE constant not found").not.toBeNull();
  return [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join("");
}

function runHook(userMessage) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: `vitest-dispatch-${process.pid}-${Date.now()}`, user_message: userMessage }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    encoding: "utf8",
  });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
}

describe("prompt.knowledge.dispatch — delegation nudge", () => {
  const nudge = nudgeFromSource();

  test("nudge is short and names every tier", () => {
    expect(Buffer.byteLength(nudge, "utf8")).toBeLessThan(600);
    for (const needle of ["Inline", "devops:research", "devops:qa", "devops:redteam", "devops:po", "2–3 parallel", "run-agents", "Hard stop"]) {
      expect(nudge).toContain(needle);
    }
  });

  test("hook emits the nudge on every prompt, after the locale tag", () => {
    for (const msg of ["compare vite and webpack for us", "fix the typo in the readme heading please"]) {
      const ctx = runHook(msg);
      const lines = ctx.split("\n");
      expect(lines[0]).toMatch(/^\[ui-locale: (en|de)\]$/);
      expect(lines[1]).toBe(nudge);
    }
  });

  test("every delegation eval prompt ends with the identical nudge", () => {
    const dir = path.join(PLUGIN_ROOT, "evals", "delegation");
    const cases = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const prompt = fs.readFileSync(path.join(dir, c.name, "prompt.md"), "utf8").trimEnd();
      expect(prompt.endsWith(nudge), `${c.name}/prompt.md does not end with the hook's nudge`).toBe(true);
    }
  });
});
