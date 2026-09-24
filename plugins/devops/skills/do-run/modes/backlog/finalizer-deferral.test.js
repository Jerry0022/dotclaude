/**
 * Static-text regression tests for the multi-ship finalizer deferral.
 *
 * The dotclaude project ship extension (`.claude/skills/do-ship/SKILL.md`, this
 * repo's own extension) ends every ship to main with a plugin self-sync that
 * marks the MCP servers stale. `/do-run backlog` composes `/do-ship` once per queued
 * issue from ONE session, so a finalizer run after the first ship blocks the
 * `ship_*` calls of every later issue. On 2026-09-18 the deferral was done by
 * hand for PRs #401/#402/#404; these tests pin the wording that makes it
 * automatic: the extension skips while a `backlog-runner` lockout is active,
 * and the runner runs the finalizer exactly once at its Step 5.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runner = readFileSync(join(here, "..", "backlog.md"), "utf8");
const extension = readFileSync(join(here, "..", "..", "..", "..", "..", "..", ".claude", "skills", "do-ship", "SKILL.md"), "utf8");

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? text.indexOf(endHeading, start + 1) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}

describe("project ship extension — Step 8 skips while a backlog-runner lockout is active", () => {
  const guards = section(extension, "### Guards — skip the finalizer entirely", "### Action");

  it("names the lockout owner as a skip condition, checked via the lockout script", () => {
    expect(guards).toMatch(/\*\*A `backlog-runner` lockout is active\.\*\*/);
    expect(guards).toContain('autonomous-lockout.js" check');
    expect(guards).toContain('`"backlog-runner"`');
  });

  it("says who runs the finalizer instead, and when", () => {
    expect(guards).toMatch(/runner runs this finalizer exactly once at its Step 5, after its final card/);
  });

  it("explains the failure the guard prevents — stale MCP blocking the rest of the queue", () => {
    expect(guards).toContain("pre.mcp.health");
    expect(guards).toMatch(/every issue still in the queue/);
  });
});

describe("project ship extension — Step 6.5 card wording under the deferral", () => {
  const step65 = section(extension, "## Step 6.5", "## Step 8");

  it("has a dedicated alpha + backlog-runner item that does not claim a sync yet", () => {
    expect(step65).toMatch(/\*\*Pin is `alpha` AND a `backlog-runner` lockout is active\*\*/);
    expect(step65).toContain("wird nach dem letzten Backlog-Issue auf die geshippte Version synchronisiert");
  });
});

describe("do-run backlog mode — Step 5 runs the project finalizer once, before clearing the lockout", () => {
  const step5 = section(runner, "## Step 5 — Completion & Blocked Handling", "## Artifacts");

  it("has the finalizer item after the completion card and before the shutdown/lockout item", () => {
    const card = step5.indexOf("3. **Completion card**");
    const finalizer = step5.indexOf("4. **Project ship-extension finalizer");
    const shutdown = step5.indexOf("5. **Optional shutdown**");
    expect(card).toBeGreaterThan(-1);
    expect(finalizer).toBeGreaterThan(card);
    expect(shutdown).toBeGreaterThan(finalizer);
  });

  it("reads the project extension, runs the step exactly once, and only when something shipped", () => {
    const item = section(step5, "4. **Project ship-extension finalizer", "5. **Optional shutdown**");
    expect(item).toContain("{project}/.claude/skills/do-ship/SKILL.md");
    expect(item).toMatch(/exactly once here, only when ≥1 item shipped/);
    expect(item).toMatch(/\*\*before\*\* the lockout is cleared/);
    expect(item).toMatch(/No extension or no such\s+step → nothing to do/);
  });

  it("the lockout clear still lives in the item that follows", () => {
    const item = section(step5, "5. **Optional shutdown**");
    expect(item).toContain('autonomous-lockout.js" clear');
  });
});
