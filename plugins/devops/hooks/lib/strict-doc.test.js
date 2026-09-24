/**
 * Static-text regression tests for deep-knowledge/strict.md — the judgment
 * half of strict mode since the claude-strict skill was retired (skill
 * restructure PR 3; formerly skills/claude-strict/skill-text.test.js).
 *
 * The contract block is duplicated on purpose — the hook injects it from
 * `strict-state.js`, the doc shows it to the model — so the one thing that
 * must never happen is the two drifting apart. Everything else pins the
 * switch forms, the routing rows and the propagation channels the spec
 * requires.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_BLOCK, CONTRACT_OPEN, CONTRACT_CLOSE, detectCommand, LITERAL_SCOPE_PHRASES } from "./strict-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, "..", "..", "deep-knowledge", "strict.md"), "utf8");

function section(startHeading, endHeading) {
  const start = doc.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? doc.indexOf(endHeading, start + 1) : doc.length;
  return doc.slice(start, end === -1 ? doc.length : end);
}

describe("deep-knowledge/strict.md", () => {
  it("is a knowledge doc, not a skill (no frontmatter)", () => {
    expect(doc.startsWith("---")).toBe(false);
    expect(doc).toMatch(/^# Strict Mode/);
  });

  it("carries the contract block identical to the lib", () => {
    const open = doc.indexOf(CONTRACT_OPEN);
    const close = doc.indexOf(CONTRACT_CLOSE, open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(doc.slice(open, close + CONTRACT_CLOSE.length)).toBe(CONTRACT_BLOCK);
  });

  it("documents every switch form, and each one really switches in the hook lib", () => {
    const sw = section("## Switching strict on and off", "## Routing a turn");
    const forms = [
      ["strict on", "on"], ["strikt an", "on"], ["/claude-strict on", "on"],
      ["strict off", "off"], ["strikt aus", "off"], ["/claude-strict off", "off"],
      ["strict status", "status"],
    ];
    for (const [form, route] of forms) {
      expect(sw, `switch table lacks ${form}`).toContain(`\`${form}\``);
      expect(detectCommand(form).route, form).toBe(route);
    }
    expect(sw).toContain("`strict: <task>`");
    expect(detectCommand("strict: den Rand dünner").route).toBe("task");
    for (const phrase of LITERAL_SCOPE_PHRASES) {
      expect(sw).toContain(`"${phrase}"`);
      expect(detectCommand(`bitte ${phrase}`).route, phrase).toBe("task");
    }
    expect(sw).toMatch(/Nur das/);
    expect(sw).toMatch(/TypeScript/);
  });

  it("routes on, off, status and a free-text task", () => {
    const rows = section("## Routing a turn", "## The contract").split("\n").filter((l) => l.startsWith("|"));
    expect(rows.find((l) => /`on`-form/.test(l))).toBeTruthy();
    expect(rows.find((l) => /`off`-form/.test(l))).toBeTruthy();
    expect(rows.find((l) => /`status`-form/.test(l))).toBeTruthy();
    const task = rows.find((l) => /anything else/i.test(l));
    expect(task, "routing table lacks the free-text task row").toBeTruthy();
    expect(task).toMatch(/task/);
    expect(task).toMatch(/\/do-run/);
  });

  it("names every propagation channel", () => {
    const exec = section("## Executing the task under the contract", "## Strict report");
    for (const channel of ["**Agent**", "**Skill**", "/auto-concept", "AUTONOMOUS_AUTOSTART", "RUN_BACKLOG_AUTOSTART", "--strict", "concept-active.json", "AUTONOMOUS-LOCKOUT.flag"]) {
      expect(exec, `does not name ${channel}`).toContain(channel);
    }
    expect(exec).toMatch(/refuses a spawn without it/);
  });

  it("names the four report lines", () => {
    const report = section("## Strict report", "## The state CLI");
    for (const line of ["`requested`", "`done`", "`chosen`", "`untouched`"]) expect(report).toContain(line);
  });

  it("drives on/off/status/inline through the CLI, never the file", () => {
    const cli = section("## The state CLI", "## What strict is NOT");
    for (const sub of ["on", "off", "status", "inline", "contract"]) {
      expect(cli).toContain(`hooks/lib/strict-state.js" ${sub}`);
    }
    expect(cli).toMatch(/never edit the mode file by hand/);
  });

  it("states the grey-zone rules the spec settled", () => {
    const contract = section("## The contract", "## Executing the task");
    expect(contract).toMatch(/import, export entry, existing registry line/);
    expect(contract).toMatch(/asserts the exact old value/);
    expect(contract).toMatch(/single most probable/);
    expect(contract).toMatch(/AskUserQuestion/);
  });

  it("says what happens to an old skill extension", () => {
    expect(section("## Project overrides")).toMatch(/\.claude\/skills\/claude-strict\//);
  });
});
