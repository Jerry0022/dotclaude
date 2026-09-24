import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const { run, buildDirs, loadCases, TRIGGERS_DIR } = require("./gen-trigger-evals.js");

describe("gen-trigger-evals", () => {
  it("keeps evals/triggers/ in sync with cases.json", () => {
    const { changed, diffs } = run({ check: true });
    expect(changed, `evals/triggers/ is stale, rerun node plugins/devops/scripts/gen-trigger-evals.js:\n${diffs.join("\n")}`).toBe(false);
  });

  it("expands into 100 cases across fix/setup-issue/concept/tune-harden/claude-extend-skill", () => {
    const data = loadCases();
    const dirs = buildDirs(data);
    expect(dirs.size).toBe(100);
  });

  it("generates every translated case in all 11 languages plus one language-independent case", () => {
    const data = loadCases();
    const dirs = buildDirs(data);
    const translated = data.cases.filter((c) => !c.languageIndependent);
    for (const c of translated) {
      for (const lang of data.languages) {
        expect(dirs.has(`${c.id}-${lang}`)).toBe(true);
      }
    }
    const independent = data.cases.filter((c) => c.languageIndependent);
    for (const c of independent) {
      expect(dirs.has(c.id)).toBe(true);
    }
  });

  it("every generated grader tolerates both the current and post-rename skill name", () => {
    const data = loadCases();
    const dirs = buildDirs(data);
    for (const [name, entry] of dirs) {
      for (const skillName of data.cases.find((c) =>
        name === c.id || name.startsWith(`${c.id}-`)
      ).expectedSkillNames) {
        expect(entry.graderMd).toContain(skillName);
      }
    }
  });

  it("every generated prompt carries the delegation-policy nudge line", () => {
    const data = loadCases();
    const dirs = buildDirs(data);
    for (const [, entry] of dirs) {
      expect(entry.promptMd).toContain("[delegation-policy]");
    }
  });

  it("has no directories under evals/triggers/ that cases.json does not own", () => {
    const data = loadCases();
    const dirs = buildDirs(data);
    const onDisk = fs
      .readdirSync(TRIGGERS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const name of onDisk) {
      expect(dirs.has(name)).toBe(true);
    }
  });

  it("every generated case dir has the exact delegation-format file set", () => {
    const data = loadCases();
    const dirs = buildDirs(data);
    for (const name of dirs.keys()) {
      const base = path.join(TRIGGERS_DIR, name);
      expect(fs.existsSync(path.join(base, "prompt.md"))).toBe(true);
      expect(fs.existsSync(path.join(base, "case.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(base, "scaffold.sh"))).toBe(true);
      expect(fs.existsSync(path.join(base, "graders", "skill-invoked.md"))).toBe(true);
    }
  });
});
