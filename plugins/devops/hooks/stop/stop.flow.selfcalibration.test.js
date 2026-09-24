import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skill restructure PR 2 folded five run/tune skills into do-run modes; their
// deep-knowledge moved to skills/do-run/modes/<mode>/deep-knowledge/. The
// self-calibration rotation scanned only skills/<skill>/deep-knowledge and
// silently dropped those files (red-team finding).
const require = createRequire(import.meta.url);
const { discoverDeepKnowledge } = require("./stop.flow.selfcalibration.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", "..");

describe("stop.flow.selfcalibration — deep-knowledge discovery", () => {
  const files = discoverDeepKnowledge().map((f) => f.replace(/\\/g, "/"));

  test("includes the folded modes' deep-knowledge under skills/<skill>/modes/<mode>/", () => {
    const modeDir = path.join(pluginRoot, "skills", "do-run", "modes");
    const expected = [];
    for (const mode of fs.readdirSync(modeDir)) {
      const dk = path.join(modeDir, mode, "deep-knowledge");
      if (!fs.existsSync(dk)) continue;
      for (const f of fs.readdirSync(dk)) if (f.endsWith(".md")) expected.push(path.join(dk, f).replace(/\\/g, "/"));
    }
    expect(expected.length).toBeGreaterThan(0);
    for (const f of expected) expect(files, f).toContain(f);
  });

  test("still includes plugin-level and skill-level deep-knowledge, never INDEX.md, sorted", () => {
    expect(files.some((f) => f.includes("/plugins/devops/deep-knowledge/"))).toBe(true);
    expect(files.some((f) => /\/skills\/do-ship\/deep-knowledge\/[^/]+\.md$/.test(f))).toBe(true);
    expect(files.some((f) => f.endsWith("/deep-knowledge/INDEX.md") && !f.includes("/skills/"))).toBe(false);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    const raw = discoverDeepKnowledge();
    expect([...raw].sort()).toEqual(raw);
  });

  test("the scheduled-task runbook documents the recursive scan", () => {
    const runbook = fs.readFileSync(path.join(pluginRoot, "scheduled-tasks", "self-calibration", "SKILL.md"), "utf8");
    expect(runbook).toContain("skills/**/deep-knowledge/*.md");
    expect(runbook).toContain("modes/<mode>/deep-knowledge/");
  });
});
