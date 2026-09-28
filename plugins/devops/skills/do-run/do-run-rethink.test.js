/**
 * Pins the rethink contract (modes/rethink.md): a rethink never asks the
 * user — no AskUserQuestion, no inline question — and ends in exactly one of
 * two exits: an autonomous pick handed to implementation (the default), or a
 * concept page, which opens only when a real fork remains that the evidence
 * cannot settle. The router texts that describe "Rethink vorher" must say
 * the same thing, not the old "always a concept page".
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8").replace(/\r\n/g, "\n");
const rethink = read("modes", "rethink.md");
const skill = read("SKILL.md");

function section(text, heading) {
  const start = text.indexOf(heading);
  expect(start, `heading not found: ${heading}`).toBeGreaterThan(-1);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

/** Sentences (split on . / newline-bullets) that mention asking the user. */
function askingSentences(text) {
  return text
    .split(/(?<=[.:])\s+|\n(?=\s*[-|\d])/)
    .map((s) => s.replace(/\s+/g, " "))
    .filter((s) => /AskUserQuestion|\bask(s|ed|ing)?\b|question/i.test(s));
}

describe("rethink never asks the user", () => {
  test("every mention of AskUserQuestion / asking is a prohibition or history", () => {
    // Allowed: "never", "no", "not asked", "used to be asked", "not a question",
    // "no extra question", "Owns the question" (the lens table header).
    const allowed = /\bnever\b|\bno\b|\bnot\b|used to be asked|Owns the question|no question/i;
    const offending = askingSentences(rethink).filter((s) => !allowed.test(s));
    expect(offending).toEqual([]);
  });

  test("the question round is gone; Step 3 is self-calibration", () => {
    expect(rethink).not.toMatch(/## Step 3 — Question Round/);
    expect(rethink).not.toMatch(/ONE question per round/);
    const s3 = section(rethink, "## Step 3 — Self-Calibration");
    expect(s3).toMatch(/Assumptions/);
    expect(s3).toMatch(/corridor — derived, conservative/i);
    expect(s3).toMatch(/Never assume "everything"/);
  });

  test("an empty target is derived, not asked", () => {
    const s1 = section(rethink, "## Step 1 — Intake & Scope");
    expect(s1).toMatch(/derive the target — never ask for it/);
    expect(s1).not.toMatch(/AskUserQuestion\) to name the/);
  });

  test("the over-corridor case is decided on the page, never by a question", () => {
    expect(rethink).not.toMatch(/ask ONE explicit\s+corridor-widening question/);
    const s6 = section(rethink, "## Step 6 — Decision Gate");
    expect(s6).toMatch(/Over-corridor winner/);
    expect(s6).toMatch(/IS the corridor widening/);
  });

  test("the Rules pin the no-question contract", () => {
    const rules = section(rethink, "## Rules");
    expect(rules).toMatch(/Never ask the user — no `AskUserQuestion`, no question in chat/);
    expect(rules).not.toMatch(/Never skip the question round/);
    expect(rules).not.toMatch(/agreed with the user/);
  });
});

describe("rethink has exactly two exits", () => {
  test("the intro names both exits and the default", () => {
    expect(rethink).toMatch(/\*\*Two exits, no questions\.\*\*/);
    expect(rethink).toMatch(/1\. \*\*Autonomous\*\* \(the default\)/);
    expect(rethink).toMatch(/2\. \*\*Concept page\*\* — only when a real fork remains/);
  });

  test("Step 6 decides autonomously by default and names the page conditions", () => {
    const s6 = section(rethink, "## Step 6 — Decision Gate");
    expect(s6).toMatch(/\*\*Decide autonomously \(default\)\*\*/);
    expect(s6).toMatch(/go to Step 7/);
    for (const cond of ["Real fork", "Over-corridor winner", "Goal unclear"]) {
      expect(s6).toContain(`**${cond}**`);
    }
    // A close call Claude can settle itself does not open the page.
    expect(s6).toMatch(/is not a fork — look further and decide/);
    // The page keeps the concept template rule and its two actions.
    expect(s6).toMatch(/§ Step 1a/);
    expect(s6).toMatch(/\*\*Iterate\*\*/);
    expect(s6).toMatch(/\*\*Implement\*\*/);
  });

  test("an over-corridor winner outranks the autonomous default (behavioral finding S3)", () => {
    const s6 = section(rethink, "## Step 6 — Decision Gate");
    expect(s6).toMatch(/\*\*Precedence:\*\* the page conditions below outrank this default/);
    expect(s6).toMatch(/even if it is the only\s+in-corridor option left/);
  });

  test("a criteria tie has a tie-breaker, so the autonomous pick never stalls (S5)", () => {
    expect(section(rethink, "## Step 6 — Decision Gate")).toMatch(/On a criteria tie the lower risk wins, then the lower\s+effort/);
  });

  test("the page is opened via the real skill name", () => {
    expect(section(rethink, "## Step 6 — Decision Gate")).toContain('Skill("devops:auto-concept")');
  });

  test("the interactive handoff skips auto-agents' plan confirmation via --rethink", () => {
    expect(section(rethink, "## Step 7 — Autonomous Handoff")).toMatch(/`auto-agents` with `--rethink` added/);
    const agents = read("..", "auto-agents", "SKILL.md");
    expect(agents).toMatch(/`--from=do-run --mode=interactive`\s+without `--rethink`/);
    expect(agents).toMatch(/do-run rethink handoff \(`--rethink`: its pick was the go\)/);
    // The router's own args template carries the flag too (behavioral re-run finding).
    expect(skill).toMatch(/--ship=<auto\|manual> \[--rethink\] <task>/);
    expect(skill).toMatch(/`--rethink` after `modes\/rethink.md`/);
  });

  test("Step 7 accepts both the autonomous pick and a page Implement", () => {
    const s7 = section(rethink, "## Step 7 — Autonomous Handoff");
    expect(s7).toMatch(/After the Step 6 autonomous pick, or an \*\*Implement\*\* on the concept page/);
    expect(s7).not.toMatch(/Only after an explicit \*\*Implement\*\* decision/);
  });

  test("the autonomous path never implements over-corridor", () => {
    expect(section(rethink, "## Rules")).toMatch(/Never implement an `over-corridor` approach from the autonomous path/);
    expect(section(rethink, "## Step 5 — Reconciliation")).toMatch(/NEVER implemented from the autonomous path/);
  });

  test("completion covers both exits", () => {
    const c = section(rethink, "## Completion");
    expect(c).toMatch(/Handoff happened \(Step 7\)/);
    expect(c).toMatch(/Concept page opened and waiting/);
    expect(c).toMatch(/`concept` field/);
  });
});

describe("the router describes the new rethink", () => {
  test("Q4 option no longer promises a concept page every time", () => {
    const line = skill.split("\n").find((l) => /^\s+\d\. "Rethink vorher"/.test(l));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/\(Concept-Seite\), dann umsetzen/);
    expect(line).toMatch(/Concept-Seite nur bei echter Weichenstellung/);
  });

  test("the Autonom row no longer needs the user present for the rethink", () => {
    expect(skill).not.toMatch(/while the user is still here/);
    expect(skill).toMatch(/Rethink vorher → `modes\/rethink.md` — decides alone/);
  });

  test("the skill description reflects both exits", () => {
    const desc = skill.slice(0, skill.indexOf("\ntriggers:"));
    expect(desc).toMatch(/decided alone, a concept page only for a real\s+fork/);
  });
});
