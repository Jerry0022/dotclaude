/**
 * Static-text regression tests for the claude-batch SKILL.md routing contract
 * (issue #306).
 *
 * The skill is prose, so the only cheap guard against the two regressions the
 * issue describes is asserting the wording that makes them impossible:
 *
 *   1. A free-text argument (`/claude-batch <Gedanke>`) must have an explicit
 *      routing row — the old table only knew keywords + "none", so unrecognised
 *      content matched nothing and was silently dropped.
 *   2. A dead marker (`markerFallback`) must be repaired from EVERY route, not
 *      only `on` / `marker` — otherwise `status` re-reports it forever.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PREFIX } from "../../mcp-server/lib/mode-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(here, "SKILL.md"), "utf8");

function section(startHeading, endHeading) {
  const start = skill.indexOf(startHeading);
  expect(start, `heading not found: ${startHeading}`).toBeGreaterThan(-1);
  const end = endHeading ? skill.indexOf(endHeading, start + 1) : skill.length;
  return skill.slice(start, end === -1 ? skill.length : end);
}

describe("claude-batch SKILL.md routing — issue #306", () => {
  const step1 = section("## Step 1 — Route the invocation", "## Step 2 — Activate");

  it("routes a free-text argument to the content fallback (note #1), never to nothing", () => {
    // The row must live inside the routing table, not only in prose.
    const tableRows = step1.split("\n").filter((l) => l.startsWith("|"));
    const fallbackRow = tableRows.find((l) => /anything else|free text/i.test(l));
    expect(fallbackRow, "routing table lacks the free-text fallback row").toBeTruthy();
    expect(fallbackRow).toMatch(/note #1/);
    expect(fallbackRow).toMatch(/activate/i);
  });

  it("runs the marker pre-check on every route", () => {
    expect(step1).toMatch(/Marker pre-check — on EVERY route/);
    for (const route of ["`on`", "`off`", "`go`", "`status`", "`marker`", "content fallback"]) {
      expect(step1, `pre-check paragraph does not name route ${route}`).toContain(route);
    }
    expect(step1).toMatch(/saveConfig\(\{ marker \}\)/);
  });

  it("Step 3 no longer treats a dead marker as report-only", () => {
    const step3 = section("## Step 3 — Status", "## Step 4 — Fire the merge");
    expect(step3).toMatch(/pre-check has\s+already asked the marker question/);
  });

  it("Step 4 and Step 5 reference the pre-check", () => {
    expect(section("## Step 4 — Fire the merge", "## Step 5 — Deactivate")).toMatch(/marker\s+pre-check/);
    expect(section("## Step 5 — Deactivate", "## Optional")).toMatch(/marker pre-check/);
  });
});

// The mode is invisible from the sidebar — the dot says idle while the hook
// swallows every prompt. The skill prefixes the session title while armed and
// strips it on every way out. The prefix string is the card layer's; the hook's
// merge context carries the same restore instruction for the marker path.
describe("claude-batch SKILL.md — session title prefix", () => {
  const prefix = SESSION_PREFIX.batch;

  it("allows the session-mgmt tools", () => {
    const fm = skill.slice(0, skill.indexOf("\n---", 4));
    expect(fm).toContain("mcp__ccd_session_mgmt__get_session");
    expect(fm).toContain("mcp__ccd_session_mgmt__set_session_title");
  });

  it("Step 2 sets exactly the card layer's prefix and skips silently without the tools", () => {
    const step2 = section("## Step 2 — Activate", "## Step 3 — Status");
    expect(step2).toContain("**2.2b Mark the session in the sidebar.**");
    expect(step2).toContain("`" + prefix + "`");
    expect(step2).toMatch(/session_id: "self"/);
    expect(step2).toMatch(/skip silently/);
    // The activation card must see the mode file — that is how it swaps its CTA.
    expect(step2).toMatch(/completion card \*\*with `cwd` set to the project root\*\*/);
    expect(step2).toContain("📥 BATCH sammelt");
  });

  it("every way out strips the prefix: go, off, expiry", () => {
    expect(section("## Step 4 — Fire the merge", "## Step 5 — Deactivate")).toContain("`" + prefix + "`");
    expect(section("## Step 5 — Deactivate", "## Optional")).toContain("`" + prefix + "`");
    expect(section("## Step 3 — Status", "## Step 4 — Fire the merge")).toMatch(/strip the\s+session-title prefix/);
    expect(section("## Rules")).toMatch(/title prefix is state, not decoration/);
  });

  it("the hook's merge context names the same prefix", () => {
    const hook = readFileSync(join(here, "..", "..", "hooks", "user-prompt-submit", "prompt.batch.collect.js"), "utf8");
    expect(hook).toContain('"' + prefix + '"');
  });
});
