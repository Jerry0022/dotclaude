import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { POINTERS, matchPointers, legacyOverrides, pointerLine } = require("./knowledge-pointers.js");
const { RETIRED } = require("./skill-names.js");

const DK = path.resolve(import.meta.dirname, "..", "..", "deep-knowledge");
const files = (msg) => matchPointers(msg).map((h) => h.file);

describe("knowledge-pointers", () => {
  test("every pointer doc exists; a retired skill's pointer is its RETIRED doc", () => {
    for (const p of POINTERS) {
      expect(fs.existsSync(path.join(DK, p.file)), p.file).toBe(true);
      if (p.legacy) expect(RETIRED[p.legacy]?.doc, p.legacy).toBe(p.file);
      else expect(p.extension, `${p.file}: no legacy skill, no legacy override`).toBe(false);
    }
    expect(POINTERS.filter((p) => p.legacy).map((p) => p.legacy).sort()).toEqual(Object.keys(RETIRED).sort());
    // Only the skills that had an extension step keep an override.
    expect(POINTERS.filter((p) => p.extension).map((p) => p.legacy).sort())
      .toEqual(["auto-usage", "claude-strict", "setup-project", "setup-readme"]);
  });

  test.each([
    ["bitte README erstellen", "readme-standards.md"],
    ["can you improve the readme?", "readme-standards.md"],
    ["mach das mit /setup-readme", "readme-standards.md"],
    ["refresh usage", "usage.md"],
    ["wie viel hab ich verbraucht?", "usage.md"],
    ["/auto-usage", "usage.md"],
    ["was sagt der knowledge graph dazu", "graphify.md"],
    ["/auto-graph", "graphify.md"],
    ["strikt bitte", "strict.md"],
    ["nichts anderes anfassen", "strict.md"],
    ["/claude-strict on", "strict.md"],
    ["bitte Projekt einrichten", "project-setup.md"],
    ["add license please", "project-setup.md"],
    ["mach das mit /setup-project", "project-setup.md"],
    ["cleanup einstellen: Hinweis erst ab 80", "devops-config.md"],
    ["zeig mir die devops einstellungen", "devops-config.md"],
    ["bitte nicht automatisch aufräumen in diesem Projekt", "devops-config.md"],
  ])("%j → %s", (msg, file) => {
    expect(files(msg)).toContain(file);
  });

  test.each([
    "set `strict` in tsconfig",
    "lies docs/graphify-notes.md",
    "run /graphify on it",
    "the readme is fine",
    "",
  ])("no pointer for %j", (msg) => {
    expect(files(msg)).toEqual([]);
  });

  test("a pointer without a legacy skill names no old skill", () => {
    const [hit] = matchPointers("devops einstellungen");
    const line = pointerLine(hit, "/x/deep-knowledge");
    expect(line).toContain("/x/deep-knowledge/devops-config.md");
    expect(line).toMatch(/not a skill/);
    expect(line).not.toMatch(/named null|named undefined/);
  });

  test("pointer names the doc, never asks for a Skill, and lists overrides", () => {
    const [hit] = matchPointers("strict");
    const line = pointerLine(hit, "/x/deep-knowledge", ["/p/.claude/skills/claude-strict/reference.md"]);
    expect(line).toContain("/x/deep-knowledge/strict.md");
    expect(line).toMatch(/not a skill/);
    expect(line).not.toMatch(/Skill\(/);
    expect(line).toContain("/p/.claude/skills/claude-strict/reference.md");
  });

  test("legacyOverrides: project first, then home; reference.md and SKILL.md", () => {
    const present = new Set([
      path.join("/p", ".claude", "skills", "auto-usage", "SKILL.md"),
      path.join("/h", ".claude", "skills", "auto-usage", "reference.md"),
    ]);
    expect(legacyOverrides("auto-usage", { cwd: "/p", home: "/h", exists: (p) => present.has(p) })).toEqual([
      path.join("/p", ".claude", "skills", "auto-usage", "SKILL.md"),
      path.join("/h", ".claude", "skills", "auto-usage", "reference.md"),
    ]);
    expect(legacyOverrides("auto-usage", {})).toEqual([]);
  });
});
