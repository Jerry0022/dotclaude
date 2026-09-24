/**
 * Static-text regression test for the backlog presence-timeout cron.
 *
 * Red-team R4 (skill restructure PR 2): the presence-timeout cron always
 * carried `shutdown=yes`, even when the do-run router's Q2 was answered
 * "Dabei" (the user stays at the PC). A timeout fired while the user was
 * still there would then arm the shutdown watchdog and power the PC down
 * under them. The cron's `shutdown` now follows the router answer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runner = readFileSync(join(here, "..", "backlog.md"), "utf8");

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? text.indexOf(endHeading, start + 1) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}

describe("backlog presence-timeout cron — shutdown follows the router's Q2", () => {
  const step1 = section(runner, "## Step 1 — Fetch & Select", "1. **Fetch open milestones");
  const reentry = section(runner, "## Step 0.1", "## Step 1 — Fetch & Select");

  it("the armed cron never hard-codes shutdown=yes", () => {
    const cron = step1.slice(step1.indexOf("CronCreate("), step1.indexOf("```", step1.indexOf("CronCreate(")));
    expect(cron).toContain("RUN_BACKLOG_AUTOSTART: presence timeout");
    expect(cron).not.toMatch(/shutdown=yes/);
    expect(cron).toMatch(/shutdown=<presence default below>/);
  });

  it("Dabei → shutdown=no in every arm and re-arm; Weg → yes until F6 answers", () => {
    expect(step1).toMatch(/\*\*Dabei\*\* → `shutdown=no`, in every arm and re-arm/);
    expect(step1).toMatch(/\*\*Weg\*\* → `shutdown=yes` until F6 "PC danach" is answered/);
    expect(step1).toMatch(/updating `queue`\/`milestones`\/`shutdown`/);
    expect(step1).not.toMatch(/Keep `shutdown=yes` as the\s+timeout default throughout/);
  });

  it("the re-entry uses the cron's value — no forced shutdown on a presence timeout", () => {
    expect(reentry).not.toMatch(/`shutdown=yes` always/);
    expect(reentry).toMatch(/\*\*Dabei → `shutdown=no`\*\*, always/);
    expect(reentry).toMatch(/watchdog with the cron's `shutdown` value/);
  });

  it("the summary rule names the router-driven default", () => {
    const rules = runner.slice(runner.indexOf("**Presence phase is timeout-safe**"));
    expect(rules).toMatch(/Dabei never shuts down/);
  });
});
