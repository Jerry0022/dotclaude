/**
 * Issues audit row 10: an override named SKILL.md under ~/.claude/skills/<skill>/
 * or .claude/skills/<skill>/ is loaded by Claude Code as a bare user skill of
 * its own. Step 0 therefore documents reference.md as the override file and
 * keeps a legacy SKILL.md only as a deprecated fallback; auto-extend scaffolds
 * reference.md only.
 */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SKILLS = path.resolve(__dirname, "..");

function step0(text) {
  const m = /^## Step 0 — Load [Ee]xtensions$/m.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

const files = [];
for (const name of fs.readdirSync(SKILLS)) {
  const skill = path.join(SKILLS, name, "SKILL.md");
  if (fs.existsSync(skill)) files.push(skill);
  const modes = path.join(SKILLS, name, "modes");
  if (fs.existsSync(modes)) for (const m of fs.readdirSync(modes)) if (m.endsWith(".md")) files.push(path.join(modes, m));
}
const sections = files.map((f) => [path.relative(SKILLS, f), step0(fs.readFileSync(f, "utf8"))]).filter(([, s]) => s);

describe("Step 0 — overrides live in reference.md", () => {
  test("covers the skills that load extensions", () => {
    expect(sections.length).toBeGreaterThanOrEqual(14);
  });

  test.each(sections)("%s names reference.md, never SKILL.md, as the override file", (_f, sec) => {
    expect(sec).not.toMatch(/\/SKILL\.md` \+ `reference\.md`/);
    expect(sec).toMatch(/skills\/[\w-]+\/reference\.md`/);
    expect(sec).toMatch(/Legacy: an override still named `SKILL\.md`.*deprecated fallback.*Rename it to `reference\.md`/);
  });

  test("auto-extend scaffolds reference.md only", () => {
    const text = fs.readFileSync(path.join(SKILLS, "auto-extend", "SKILL.md"), "utf8");
    const scaffold = text.slice(text.indexOf("## Step 3"), text.indexOf("## Step 4"));
    expect(scaffold).toMatch(/Scaffold \*\*`reference\.md` only\*\*/);
    expect(scaffold).not.toMatch(/^name: \{skill-name\}$/m);
  });
});
