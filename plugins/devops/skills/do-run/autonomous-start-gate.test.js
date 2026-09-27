import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Benchmark item 8 (2026-09-27): a clean autonomous run starts without a
// second "start now?" click — the router's "Autonom" answer and the granted
// permissions already are that decision. The start gate with its 3-minute
// autostart stays for the cases where the user has something new to see.
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, ...p), "utf8");
const AUTO = read("modes", "autonomous.md");
const BURN = read("modes", "burn.md");
const COMPOSITE = read("modes", "burn", "deep-knowledge", "composite-prompt.md");

function section(text, start, end) {
  const a = text.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = end ? text.indexOf(end, a + 1) : -1;
  return text.slice(a, b === -1 ? text.length : b);
}

describe("autonomous Step 4 — direct start unless a gate reason applies", () => {
  const decide = section(AUTO, "### 4a — Decide", "### 4b");
  const gate = section(AUTO, "### 4b — Start gate", "### 4c");
  const resolve = section(AUTO, "### 4c — Resolve", "### 4d");

  test("the gate reasons are a closed table: failed priming, tools that will prompt, burn", () => {
    expect(decide).toMatch(/\| G1 \| A priming is not granted: a Step 3e line is neither `\[OK\]` nor `\[--\]`/);
    expect(decide).toMatch(/\| G2 \| Tools will still prompt during the run: Step 0\.7 applied fewer rules than it suggested, or `tamper_protected_writes` is non-empty/);
    expect(decide).toMatch(/\| G3 \| This is a burn/);
    expect(decide).not.toMatch(/\| G4 /);
    expect(decide).toMatch(/no reason → direct start; one reason → gate/);
    expect(decide).toMatch(/Never open\s+the gate "to be safe" without a reason from the table, and never skip it\s+when one applies/);
  });

  test("the checklist is shown in both paths", () => {
    expect(decide).toMatch(/Show the Step 3e checklist first, in both cases/);
  });

  test("direct start: one line, no autostart cron, resume + watchdog armed, lockout on", () => {
    expect(decide).toContain('**"Alle Berechtigungen erteilt — starte jetzt autonom."**');
    expect(decide).toMatch(/Arm no autostart\s+cron/);
    expect(decide).toMatch(/If `\$AUTO_RESUME=yes`, arm the resume\s+cron now \(Step 4e\)/);
    expect(decide).toMatch(/Arm the watchdog \(Step 4d\), then go to Step 5/);
    expect(decide).toMatch(/Post-Confirmation Lockout is active from this line on/);
  });

  test("the gate keeps its timeout safety: cron before the question, both options, re-arm", () => {
    expect(gate.indexOf("CronCreate")).toBeGreaterThan(-1);
    expect(gate.indexOf("CronCreate")).toBeLessThan(gate.indexOf("AskUserQuestion"));
    expect(gate).toContain("AUTONOMOUS_AUTOSTART:");
    expect(gate).toMatch(/<Grund aus 4a, eine Zeile>/);
    expect(gate).toContain('label: "Jetzt starten"');
    expect(gate).toContain('label: "Später starten"');
    expect(resolve).toMatch(/CronDelete\(\$TIMEOUT_JOB_ID\)/);
    expect(resolve).toMatch(/Re-arm guard/);
  });

  test("the autostart handler (Step 0.1) still exists for the gate path", () => {
    const autostart = section(AUTO, "## Step 0.1", "## Step 0.2");
    expect(autostart).toMatch(/3-minute timeout of the Step 4b start gate firing/);
    expect(autostart).toMatch(/Pending-question guard/);
  });

  test("every place that arms on the start names the direct start too", () => {
    expect(AUTO).not.toMatch(/after confirming "Jetzt starten"/);
    expect(AUTO).toMatch(/direct start \(Step 4a\), "Jetzt starten" \(Step 4c\) or auto-start \(Step 0\.1\) — via Step 4e/);
    expect(AUTO).toMatch(/Armed at the direct start \(Step 4a\), "Jetzt starten" \(Step 4c\) or on auto-start/);
    expect(AUTO).toMatch(/\*\*Once the run has started — direct start \(Step 4a\), "Jetzt starten" or the autostart — ZERO user interaction is allowed\.\*\*/);
  });
});

describe("burn keeps its start gate — the plan has no other confirmation", () => {
  test("G3 uses the same burn test as Step 5", () => {
    const decide = section(AUTO, "### 4a — Decide", "### 4b");
    expect(decide).toMatch(/burn's composite prompt and `BURN-STATE\.json` exists/);
    expect(AUTO).toMatch(/\*\*Under burn\*\* \(the task is burn's composite prompt and `BURN-STATE\.json`\s+exists\)/);
  });

  test("burn.md and the composite prompt say the gate is always shown for a burn", () => {
    expect(BURN).toMatch(/autonomous Step 4 always opens\s+its start gate for a burn \(reason G3\)/);
    expect(BURN).toMatch(/the start gate\s+\(always shown for a burn, Step 4a reason G3\)/);
    expect(COMPOSITE).toMatch(/the start gate \(always shown for a burn —\s+autonomous Step 4a, reason G3\)/);
    for (const text of [BURN, COMPOSITE]) expect(text).not.toMatch(/3-minute start\s+confirmation/);
  });
});
