/**
 * Browser MCP server names in skill frontmatter.
 *
 * The browser tools are served as `mcp__Claude_Browser__*` (browser pane) and
 * `mcp__claude-in-chrome__*` (the Edge extension). In 30 days of transcripts
 * before 2026-10-01 the older names `mcp__Claude_Preview__*` and
 * `mcp__Claude_in_Chrome__*` appeared zero times, yet several skills only
 * allowed the old ones. Old names may stay as aliases for older installs,
 * but never alone.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const CURRENT_FOR = { Claude_Preview: "Claude_Browser", Claude_in_Chrome: "claude-in-chrome" };

const skillFiles = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SKILLS, d.name, "SKILL.md")))
  .map((d) => d.name);

describe.each(skillFiles)("skills/%s/SKILL.md", (name) => {
  test("an old browser server is never allowed without its current name", () => {
    const src = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
    const fm = (src.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
    const allowed = (fm.match(/^allowed-tools:([\s\S]*?)(?=^\w[\w-]*:|$(?![\s\S]))/m) || [])[1] || "";
    for (const [old, current] of Object.entries(CURRENT_FOR)) {
      if (allowed.includes(`mcp__${old}__`)) {
        expect(allowed, `${name}: allows mcp__${old}__ but not mcp__${current}__`).toContain(`mcp__${current}__`);
      }
    }
  });
});
