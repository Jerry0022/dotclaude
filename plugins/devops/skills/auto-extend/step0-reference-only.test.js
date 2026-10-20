/**
 * Issues audit row 10: an override named SKILL.md under ~/.claude/skills/<skill>/
 * or .claude/skills/<skill>/ is loaded by Claude Code as a bare user skill of
 * its own. The override file is therefore reference.md; a legacy SKILL.md is
 * only a deprecated fallback; auto-extend scaffolds reference.md only.
 *
 * F1 (unified override loader): no skill reads its extensions itself any
 * more. hooks/lib/skill-overrides.js resolves and injects them as one
 * `[skill-overrides]` block; every Step 0 is the one line pointing at it.
 */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SKILLS = path.resolve(__dirname, "..");
const PLUGIN = path.resolve(SKILLS, "..");
const { OVERRIDE_FILE, LEGACY_FILE, OVERRIDE_FILES } = require("../../hooks/lib/skill-overrides.js");

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

describe("Step 0 — the override loader injects reference.md", () => {
  test("covers the skills that load extensions", () => {
    expect(sections.length).toBeGreaterThanOrEqual(14);
  });

  test.each(sections)("%s is the one loader line, no hand-read paths", (_f, sec) => {
    expect(sec).toMatch(/`\[skill-overrides\]` block[^\n]*; none shown → none exist\./);
    expect(sec).not.toMatch(/~\/\.claude\/skills\//);
    expect(sec).not.toMatch(/\{project\}\/\.claude\/skills\/[\w-]+\/(?:reference|SKILL)\.md/);
  });

  test("the loader reads reference.md, SKILL.md only as the legacy fallback", () => {
    expect(OVERRIDE_FILE).toBe("reference.md");
    expect(LEGACY_FILE).toBe("SKILL.md");
    expect(OVERRIDE_FILES).toEqual(["reference.md", "SKILL.md"]);
  });

  test("the extension guide names reference.md and calls SKILL.md deprecated", () => {
    const guide = fs.readFileSync(path.join(PLUGIN, "deep-knowledge", "skill-extension-guide.md"), "utf8");
    expect(guide).toMatch(/the override file is `reference\.md`/i);
    expect(guide).toMatch(/Legacy `SKILL\.md` overrides are deprecated/);
    expect(guide).toMatch(/## Directives/);
  });

  test("auto-extend scaffolds reference.md only, with the directive headings", () => {
    const text = fs.readFileSync(path.join(SKILLS, "auto-extend", "SKILL.md"), "utf8");
    const scaffold = text.slice(text.indexOf("## Step 3"), text.indexOf("## Step 4"));
    expect(scaffold).toMatch(/Scaffold \*\*`reference\.md` only\*\*/);
    expect(scaffold).not.toMatch(/^name: \{skill-name\}$/m);
    for (const h of ["## Add after Step {N}", "## Skip Step {N}", "## Replace Step {N}"]) expect(scaffold).toContain(h);
  });
});
