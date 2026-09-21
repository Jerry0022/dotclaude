import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PREFIX } from "../../mcp-server/lib/mode-state.js";

// A concept turns the session into a waiting room, and from the sidebar that
// is invisible: the dot says idle, the user types the next task into a session
// that is waiting for page decisions. The skill therefore prefixes the session
// title while the page is open and strips it again at close-out. The prefix
// string lives in mode-state.js next to the card's emoji; these tests pin the
// skill prose to it so title and card can never drift apart.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

function section(start, end) {
  const a = SKILL.indexOf(start);
  expect(a, `heading not found: ${start}`).toBeGreaterThan(-1);
  const b = SKILL.indexOf(end, a + 1);
  return SKILL.slice(a, b === -1 ? SKILL.length : b);
}

describe("concept SKILL.md — session title prefix", () => {
  test("the session-mgmt tools are allowed", () => {
    const fm = SKILL.slice(0, SKILL.indexOf("\n---", 4));
    expect(fm).toContain("mcp__ccd_session_mgmt__get_session");
    expect(fm).toContain("mcp__ccd_session_mgmt__set_session_title");
  });

  test("Step 3 sets exactly the prefix the card layer defines", () => {
    const mark = section("### Mark the session in the sidebar", "### After opening, inform the user:");
    expect(mark).toContain("`" + SESSION_PREFIX.concept + "`");
    expect(mark).toMatch(/session_id: "self"/);
    expect(mark).toMatch(/Desktop app/);
    expect(mark).toMatch(/skip silently/);
  });

  test("Step 6a strips the prefix and leaves any other title alone", () => {
    const cleanup = section("### 6a. Clean up the active-concept state", "**Apply disposition on the concept files.**");
    expect(cleanup).toContain("**Restore the session title**");
    expect(cleanup).toContain("`" + SESSION_PREFIX.concept + "`");
    expect(cleanup).toMatch(/prefix removed/);
    expect(cleanup).toMatch(/left untouched/);
  });

  test("the open-concept card passes cwd so the page URL is resolved from the state file", () => {
    const cards = section("### Completion cards while the concept is open", "## Step 4 — Monitor via HTTP Bridge");
    expect(cards).toMatch(/`cwd` set to the session cwd/);   // #417: the state file lives in the session cwd
    expect(cards).toContain("concept-active.json");
    expect(cards).toContain("http://localhost:{port}/docs/concepts/{date}-{slug}.html");
  });
});
