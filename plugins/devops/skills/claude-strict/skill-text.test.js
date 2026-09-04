/**
 * Static-text regression tests for the claude-strict SKILL.md contract.
 *
 * The contract block is duplicated on purpose — the hook injects it from
 * `hooks/lib/strict-state.js`, the skill shows it to the model — so the one
 * thing that must never happen is the two drifting apart. Everything else here
 * pins the routing rows and the propagation channels the spec requires.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_BLOCK, CONTRACT_OPEN, CONTRACT_CLOSE } from "../../hooks/lib/strict-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, "SKILL.md"), "utf8");

function section(startHeading, endHeading) {
  const start = skill.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? skill.indexOf(endHeading, start + 1) : skill.length;
  return skill.slice(start, end === -1 ? skill.length : end);
}

describe("claude-strict SKILL.md", () => {
  it("has frontmatter with argument-hint and a folded description", () => {
    const fm = skill.slice(0, skill.indexOf("\n---", 4));
    expect(fm).toMatch(/^name: claude-strict$/m);
    expect(fm).toMatch(/^description: >-$/m);
    expect(fm).toMatch(/^argument-hint: "<task> \| on \| off \| status"$/m);
  });

  it("carries the contract block identical to the lib", () => {
    const open = skill.indexOf(CONTRACT_OPEN);
    const close = skill.indexOf(CONTRACT_CLOSE, open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const inSkill = skill.slice(open, close + CONTRACT_CLOSE.length);
    expect(inSkill).toBe(CONTRACT_BLOCK);
  });

  it("routes on, off, status and a free-text task", () => {
    const step1 = section("## Step 1 — Route the invocation", "## Step 2 — The contract");
    const rows = step1.split("\n").filter((l) => l.startsWith("|"));
    expect(rows.find((l) => /`on`/.test(l))).toMatch(/Step 5/);
    expect(rows.find((l) => /`off`/.test(l))).toMatch(/Step 5/);
    expect(rows.find((l) => /`status`/.test(l))).toMatch(/Step 5/);
    const task = rows.find((l) => /anything else/i.test(l));
    expect(task, "routing table lacks the free-text task row").toBeTruthy();
    expect(task).toMatch(/task/);
    expect(task).toMatch(/Step 3/);
    expect(task).toMatch(/\/concept/);
  });

  it("names every propagation channel", () => {
    const step3 = section("## Step 3 — Execute the task under the contract", "## Step 4 — Strict report");
    for (const channel of ["**Agent**", "**Skill**", "/concept", "AUTONOMOUS_AUTOSTART", "RUN_BACKLOG_AUTOSTART", "--strict", "concept-active.json", "AUTONOMOUS-LOCKOUT.flag"]) {
      expect(step3, `Step 3 does not name ${channel}`).toContain(channel);
    }
    expect(step3).toMatch(/refuses a spawn without it/);
  });

  it("names the four report lines", () => {
    const step4 = section("## Step 4 — Strict report", "## Step 5 — `on` / `off` / `status`");
    for (const line of ["`requested`", "`done`", "`chosen`", "`untouched`"]) {
      expect(step4).toContain(line);
    }
  });

  it("drives on/off/status through the CLI, never the file", () => {
    const step5 = section("## Step 5 — `on` / `off` / `status`", "## What strict is NOT");
    expect(step5).toContain("hooks/lib/strict-state.js\" on");
    expect(step5).toContain("hooks/lib/strict-state.js\" off");
    expect(step5).toContain("hooks/lib/strict-state.js\" status");
    expect(step5).toMatch(/never edit the mode file by hand/);
  });

  it("states the grey-zone rules the spec settled", () => {
    const step2 = section("## Step 2 — The contract", "## Step 3 — Execute the task under the contract");
    expect(step2).toMatch(/import, export entry, existing registry line/);
    expect(step2).toMatch(/asserts the exact old value/);
    expect(step2).toMatch(/single most probable/);
    expect(step2).toMatch(/AskUserQuestion/);
  });
});
