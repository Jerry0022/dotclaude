import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

function runHook(userMessage, home) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: `vitest-dispatch-${process.pid}-${Date.now()}`, user_message: userMessage }),
    env,
    encoding: "utf8",
  });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
}

/** A fake HOME whose settings enable the plugin (plugin-guard) and whose usage snapshot says Pro. */
function proHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-home-"));
  fs.mkdirSync(path.join(h, ".claude"));
  fs.writeFileSync(path.join(h, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.writeFileSync(path.join(h, ".claude", "usage-live.json"), JSON.stringify({
    timestamp: new Date().toISOString(), session: { pct: 0, resetInMinutes: 300 }, weekly: { pct: 0 }, plan: "Pro",
  }));
  return h;
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
      expect(lines[1].startsWith(nudge)).toBe(true); // a budget suffix may follow
    }
  });

  test("a Pro plan at 0 % carries the tight suffix — the parallel-tier question is asked even on a fresh window", () => {
    const ctx = runHook("should we upgrade to postgres 17?", proHome());
    expect(ctx.split("\n")[1]).toBe(nudge + " · budget: tight (parallel/ceremony → ask once: spare or full)");
  });

  test("every delegation eval prompt carries the identical nudge line", () => {
    const dir = path.join(PLUGIN_ROOT, "evals", "delegation");
    const cases = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const lines = fs.readFileSync(path.join(dir, c.name, "prompt.md"), "utf8").split("\n");
      // The budget case appends the hook's suffix to the same line, so match on prefix.
      expect(lines.some((l) => l.startsWith(nudge)), `${c.name}/prompt.md does not carry the hook's nudge`).toBe(true);
    }
  });
});
