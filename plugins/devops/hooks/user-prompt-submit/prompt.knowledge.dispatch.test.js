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

/**
 * Claude Code's UserPromptSubmit payload carries the text as `prompt` — the
 * field this helper sends. Until 2026-09-19 the hook read only the legacy
 * `user_message`/`message` names (which these tests used to send), so every
 * real prompt looked empty and the hook exited before emitting anything:
 * ten consecutive Desktop sessions had no nudge, no budget suffix, no locale.
 */
function runHook(userMessage, home, cwd, field = "prompt") {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: `vitest-dispatch-${process.pid}-${Date.now()}`, [field]: userMessage, cwd }),
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

  test("the real payload field is `prompt`; the legacy names still work as aliases", () => {
    const msg = "compare vite and webpack for our typescript spa, please";
    expect(runHook(msg, proHome(), undefined, "prompt")).toContain(nudge);
    expect(runHook(msg, proHome(), undefined, "user_message")).toContain(nudge);
    expect(runHook(msg, proHome(), undefined, "message")).toContain(nudge);
    expect(runHook(msg, proHome(), undefined, "text")).toBe(""); // unknown field → nothing, not a crash
  });

  test("hook emits the nudge on every prompt, after the locale tag", () => {
    for (const msg of ["compare vite and webpack for our typescript spa, please", "fix the typo in the readme heading please, it says recieve"]) {
      const ctx = runHook(msg);
      const lines = ctx.split("\n");
      expect(lines[0]).toMatch(/^\[ui-locale: (en|de)\]$/);
      expect(lines[1].startsWith(nudge)).toBe(true); // a budget suffix may follow
    }
  });

  test("a Pro plan at 0 % carries the ask-before-parallel suffix — the question is asked even on a fresh window", () => {
    // cwd = the fake home: the suffix is dropped whenever the cwd carries an
    // AUTONOMOUS-LOCKOUT sentinel, so running from this repo while a backlog /
    // autonomous run is armed here must not turn the test red.
    const h = proHome();
    const ctx = runHook("should we upgrade to postgres 17 this quarter, for and against?", h, h);
    expect(ctx.split("\n")[1]).toBe(nudge + " · budget: ask-before-parallel (1-agent tier → sonnet ≤10 calls; parallel/ceremony → ask once: inline / 1 sonnet agent / full)");
  });

  test("short follow-ups get no nudge at all; an AUTONOMOUS_* prompt gets the nudge without the budget suffix", () => {
    const short = runHook("ja, weiter so", proHome());
    expect(short.split("\n").length).toBe(1);
    expect(short).toMatch(/^\[ui-locale: (en|de)\]$/);
    const afk = runHook("AUTONOMOUS_AUTOSTART: continue the queued implementation of the tenant switcher", proHome());
    expect(afk.split("\n")[1]).toBe(nudge);
  });

  test("kill-switch: off → no nudge and no budget suffix; ask → the ask variant, suffix kept", () => {
    const switched = (mode) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-cwd-"));
      fs.mkdirSync(path.join(cwd, ".claude"));
      fs.writeFileSync(path.join(cwd, ".claude", "delegation.json"), JSON.stringify({ mode }));
      return runHook("compare vite and webpack for our typescript spa, please", proHome(), cwd);
    };
    const off = switched("off");
    expect(off.split("\n").length).toBe(1);
    expect(off).not.toContain("delegation-policy");
    expect(off).not.toContain("budget:");
    const ask = switched("ask").split("\n")[1];
    expect(ask.startsWith("[delegation-policy: ask] No proactive spawn")).toBe(true);
    expect(ask).toContain("run it only on a yes");
    expect(ask).toContain("· budget: ask-before-parallel");
    expect(ask).not.toContain("Classify before the first tool call");
  });

  test("every delegation eval prompt carries the identical nudge line (off cases: none)", () => {
    const dir = path.join(PLUGIN_ROOT, "evals", "delegation");
    const cases = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const body = fs.readFileSync(path.join(dir, c.name, "prompt.md"), "utf8");
      if (/EVAL_DOTCLAUDE_DELEGATION:\s*off/.test(body)) {
        expect(body, `${c.name}/prompt.md pins off but carries a nudge`).not.toContain("[delegation-policy]");
        continue;
      }
      // The budget case appends the hook's suffix to the same line, so match on prefix.
      expect(body.split("\n").some((l) => l.startsWith(nudge)), `${c.name}/prompt.md does not carry the hook's nudge`).toBe(true);
    }
  });
});
