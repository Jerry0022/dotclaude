/**
 * Audit finding K1 (2026-09-25): the burn's rules lived only as prose in a
 * prompt handed through four skill layers; auto-agents — the single
 * execution path — never mentioned burn, lanes, the conveyor or
 * BURN-STATE.json. These assertions keep every layer wired to the one
 * implementation (scripts/burn-plan.js), so a later edit cannot silently
 * cut the chain again.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "..");
const read = (...p) => readFileSync(join(plugin, ...p), "utf8").replace(/\r\n/g, "\n");

const router = read("skills", "do-run", "SKILL.md");
const burn = read("skills", "do-run", "modes", "burn.md");
const scheduler = read("skills", "do-run", "modes", "burn", "deep-knowledge", "burn-scheduler.md");
const composite = read("skills", "do-run", "modes", "burn", "deep-knowledge", "composite-prompt.md");
const autonomous = read("skills", "do-run", "modes", "autonomous.md");
const backlog = read("skills", "do-run", "modes", "backlog.md");
const agents = read("skills", "auto-agents", "SKILL.md");
const hooks = JSON.parse(read("hooks", "hooks.json"));

describe("the chain router → burn → autonomous → auto-agents carries the burn", () => {
  test("the implementation exists", () => {
    for (const f of ["scripts/burn-plan.js", "scripts/burn-sim.js", "hooks/lib/burn-state.js", "hooks/user-prompt-submit/prompt.burn.resume.js"]) {
      expect(existsSync(join(plugin, f)), f).toBe(true);
    }
  });

  test("burn mode derives, writes and gates through burn-plan.js — no hand arithmetic", () => {
    expect(burn).toMatch(/burn-plan\.js plan --queue=@/);
    expect(burn).toMatch(/burn-plan\.js init --queue=@/);
    expect(burn).toMatch(/--burn=<project root>\/BURN-STATE\.json/);
    expect(burn).not.toMatch(/lanes = ceil\(/);
    expect(burn).not.toMatch(/requiredPerHour\*\* = /);
  });

  test("autonomous mode hands --burn to auto-agents", () => {
    expect(autonomous).toMatch(/add `--burn=<project root>\/BURN-STATE\.json`/);
  });

  test("auto-agents knows --burn and runs the conveyor from the gate", () => {
    expect(agents).toMatch(/\| `--burn=<path>` \|/);
    expect(agents).toMatch(/### Burn conveyor \(`--burn`\)/);
    for (const op of ["B gate", "B state agent", "B state land", "B prune-check", "B state finish", "state resume-cron"]) {
      expect(agents, op).toContain(op);
    }
    expect(agents).toMatch(/\*\*With `--burn` there is nothing to classify\*\*/);
    expect(agents).toMatch(/^burn: <landed N/m);
  });

  test("the composite prompt points at the conveyor, not at a hand-derived plan", () => {
    expect(composite).toMatch(/auto-agents mit --burn=/);
    expect(composite).toMatch(/nicht neu herleiten/);
  });

  test("backlog budget mode is depth per issue through the same gate — no parallel fan-out, no filler", () => {
    expect(backlog).not.toMatch(/aggressive agent parallelization/);
    expect(backlog).toMatch(/--burn=<project root>\/BURN-STATE\.json/);
    expect(backlog).toMatch(/never\s+parallel issues and never filler/);
  });
});

describe("limit stops: asked on a manual nudge, policy on an automatic resume", () => {
  test("prompt.burn.resume is registered for UserPromptSubmit", () => {
    const cmds = hooks.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command));
    expect(cmds.some((c) => c.endsWith("prompt.burn.resume.js"))).toBe(true);
  });

  test("the router routes BURN_RESUME and asks F7", () => {
    expect(router).toContain("| `BURN_RESUME:` | `modes/burn.md` Step 0.6");
    expect(router).toMatch(/F7 {2}header: "Burn-Resume"/);
  });

  test("autonomous Step 0.2 sends BURN_RESUME to burn worktrees and never messages itself", () => {
    expect(autonomous).toMatch(/`BURN_RESUME: token-window reset reached` when it holds an open\s+burn/);
    expect(autonomous).toMatch(/This\s+session's own worktree is not messaged/);
  });

  test("burn Step 0.6 documents both paths and the salvage", () => {
    expect(burn).toMatch(/## Step 0\.6 — Resume after a limit stop/);
    expect(burn).toMatch(/"Burn abschalten \(Recommended\)"/);
    expect(burn).toMatch(/resume-check --apply/);
    expect(burn).toMatch(/continue-agent/);
  });
});

describe("the scheduler doc matches the implementation", () => {
  test("no PO review, no second QA in the profiles (M2)", () => {
    const profiles = scheduler.slice(scheduler.indexOf("## Depth profiles"), scheduler.indexOf("## When the option is offered"));
    expect(profiles).not.toMatch(/\| .*po review/i);
    expect(profiles).not.toMatch(/second QA \|/);
    expect(profiles).toMatch(/redteam on the task diff/);
  });

  test("names the 5-hour window, blind mode, the dynamic reserve and prune-check", () => {
    expect(scheduler).toMatch(/5-hour window/);
    expect(scheduler).toMatch(/blind mode/);
    expect(scheduler).toMatch(/max\(5 %, lanes × one L task at the profile\)/);
    expect(scheduler).toMatch(/burn-plan\.js prune-check/);
    expect(scheduler).not.toMatch(/git merge-base --is-ancestor <sub-branch> burn\/<slug> \|\| echo/);
  });

  test("lists every simulated scenario", () => {
    // eslint-disable-next-line no-undef
    const sim = require("../../scripts/burn-sim.js");
    for (const name of Object.keys(sim.SCENARIOS)) expect(scheduler, name).toContain(name);
  });
});
