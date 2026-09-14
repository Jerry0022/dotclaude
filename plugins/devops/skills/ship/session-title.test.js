import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PREFIX } from "../../mcp-server/lib/mode-state.js";

// /ship marks the session while the pipeline runs and leaves its outcome on
// the title: 🚀 while shipping, 🧪 once a final ship landed (go test the
// installed build), ⛔ when the ship blocked — the same emoji the ship-blocked
// card headline uses. The prefixes are pinned in mode-state.js next to the
// concept/batch ones; these tests bind the skill prose to them.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

function section(start, end) {
  const a = SKILL.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = SKILL.indexOf(end, a + 1);
  return SKILL.slice(a, b === -1 ? SKILL.length : b);
}

describe("ship SKILL.md — session title prefix", () => {
  test("the session-mgmt tools are allowed", () => {
    const fm = SKILL.slice(0, SKILL.indexOf("\n---", 4));
    expect(fm).toContain("mcp__ccd_session_mgmt__get_session");
    expect(fm).toContain("mcp__ccd_session_mgmt__set_session_title");
  });

  test("Pre-Step C sets the shipping prefix and strips every ship prefix first", () => {
    const mark = section("## Pre-Step C — Mark the session in the sidebar", "## Step 0 — Load Extensions");
    expect(mark).toContain("`" + SESSION_PREFIX.shipping + "`");
    expect(mark).toContain("`" + SESSION_PREFIX.test + "`");
    expect(mark).toContain("`" + SESSION_PREFIX.blocked + "`");
    expect(mark).toContain("`SESSION_PREFIX`");
    expect(mark).toMatch(/session_id: "self"/);
    expect(mark).toMatch(/never stack/);
    expect(mark).toMatch(/Desktop app/);
    expect(mark).toMatch(/skip silently/);
  });

  test("Step 6 maps each outcome to its title before the card renders", () => {
    const exit = section("### Session title on exit", "### Promotion-gap nudge");
    expect(exit).toContain("`" + SESSION_PREFIX.test + "{title}`");
    expect(exit).toContain("`" + SESSION_PREFIX.blocked + "{title}`");
    expect(exit).toMatch(/intermediate ship[^|]*\|\s*`\{title\}`/);
    expect(exit).toMatch(/keep-mode/);
    expect(exit).toMatch(/left untouched/);
    expect(exit).toContain("[SESSION TITLE]");
    expect(exit).toMatch(/\*\*before\*\* outputting/);
  });

  test("the ship-blocked sentinel rule also swaps the title to blocked", () => {
    const hygiene = section("> **Sentinel hygiene (every exit path).**", "## Step 0 — Load Extensions");
    expect(hygiene).toContain("`" + SESSION_PREFIX.blocked + "`");
  });

  test("the blocked prefix carries the ship-blocked card emoji", () => {
    expect(SESSION_PREFIX.blocked.startsWith("⛔")).toBe(true);
  });
});
