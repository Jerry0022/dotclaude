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
    expect(step2).toMatch(/completion\s+card \*\*with `cwd` set to the project root\*\*/);
    expect(step2).toContain("📥 BATCH sammelt");
  });

  it("every way out strips the prefix: go, off, expiry", () => {
    expect(section("## Step 4 — Fire the merge", "## Step 5 — Deactivate")).toContain("`" + prefix + "`");
    expect(section("## Step 5 — Deactivate", "## Step 6 — Help")).toContain("`" + prefix + "`");
    expect(section("## Step 3 — Status", "## Step 4 — Fire the merge")).toMatch(/strip the\s+session-title prefix/);
    expect(section("## Rules")).toMatch(/title prefix is state, not decoration/);
  });

  it("the hook's merge context names the same prefix", () => {
    const hook = readFileSync(join(here, "..", "..", "hooks", "user-prompt-submit", "prompt.batch.collect.js"), "utf8");
    expect(hook).toContain('"' + prefix + '"');
  });
});

describe("claude-batch SKILL.md — 0.4.0: activation ends ON, markers, main sync", () => {
  const step1 = section("## Step 1 — Route the invocation", "## Step 2 — Activate");
  const step2 = section("## Step 2 — Activate", "## Step 3 — Status");
  const step4 = section("## Step 4 — Fire the merge", "## Step 5 — Deactivate");

  it("routes the bare invocation to activation when the mode is off", () => {
    const tableRows = step1.split("\n").filter((l) => l.startsWith("|"));
    const noneRow = tableRows.find((l) => /^\|\s*none\s*\|/i.test(l));
    expect(noneRow, "routing table lacks a dedicated row for the bare invocation").toBeTruthy();
    expect(noneRow).toMatch(/Mode off → Step 2/);
    expect(noneRow).toMatch(/Mode on → Step 3/);
    expect(step1).toMatch(/Activation ends ON/);
  });

  it("tells the skill the hook absorbs a re-activation", () => {
    expect(step1).toMatch(/rearm/);
    expect(step1).toMatch(/`off`, `go`, `status` and `marker` always/);
  });

  it("offers `>>`, `>go`, `>start` — no German, no colon", () => {
    const options = step2.split("\n").filter((l) => /^> \d\. /.test(l));
    expect(options).toHaveLength(3);
    expect(options[0]).toMatch(/`>>` \(empfohlen\)/);
    expect(options[1]).toMatch(/`>go`/);
    expect(options[2]).toMatch(/`>start`/);
    expect(step2).not.toMatch(/`los:`/);
    expect(step2).not.toMatch(/`jetzt:`/);
    expect(step2).toMatch(/MARKER_SUGGESTIONS/);
  });

  it("confirms activation with the shared mode summary, verbatim", () => {
    expect(step2).toMatch(/describeMode\(process\.cwd\(\)\)/);
    expect(step2).toMatch(/do not tell\s+the user to switch the mode on — it is on/);
  });

  it("merges main into the branch before any note is read", () => {
    expect(step4).toMatch(/\*\*4\.0 Bring main into the branch BEFORE/);
    expect(step4).toMatch(/scripts\/git-sync\.js/);
    expect(step4.indexOf("4.0 Bring main")).toBeLessThan(step4.indexOf("**4.1 Read every note"));
  });
});

describe("claude-batch SKILL.md — help route and re-arming", () => {
  const step1 = section("## Step 1 — Route the invocation", "## Step 2 — Activate");
  const step2 = section("## Step 2 — Activate", "## Step 3 — Status");

  it("routes help to its own step", () => {
    const tableRows = step1.split("\n").filter((l) => l.startsWith("|"));
    const helpRow = tableRows.find((l) => /`help`/.test(l));
    expect(helpRow).toBeTruthy();
    expect(helpRow).toMatch(/Step 6/);
    expect(skill).toMatch(/## Step 6 — Help/);
    expect(section("## Step 6 — Help", "## Optional")).toMatch(/renderHelp/);
  });

  it("says re-arming keeps the queue", () => {
    expect(step2).toMatch(/Re-arming keeps the queue/);
    expect(step2).toMatch(/after an auto-end/);
  });
});
