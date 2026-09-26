import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readTemplates, templateParts, TEMPLATES_DIR } from "./templates-source.js";

// The engine reference was one 15 000-line templates.md; it is now split into
// topic parts that templates.md lists in reading order. Every consumer — the
// tests in this folder, the concept gate's drift checks, the fixture builder —
// reads the joined text, so a part the index forgets, or an index row whose
// file is gone, silently drops a slice of the engine from pages and tests alike.

describe("templates-source — the split reference joins back into one", () => {
  const parts = templateParts();

  test("templates.md lists every templates-*.md part exactly once, and nothing else", () => {
    const onDisk = fs.readdirSync(TEMPLATES_DIR).filter((f) => /^templates-.+\.md$/.test(f)).sort();
    expect([...parts].sort()).toEqual(onDisk);
    expect(new Set(parts).size).toBe(parts.length);
  });

  test("each part opens with its numbered header, in reading order", () => {
    parts.forEach((file, i) => {
      const first = fs.readFileSync(path.join(TEMPLATES_DIR, file), "utf8").split("\n")[0];
      expect(first, file).toMatch(new RegExp(`^# Concept templates, part ${String(i + 1).padStart(2, "0")} of ${parts.length}: `));
    });
  });

  test("the joined text is the whole reference, without part headers", () => {
    const md = readTemplates();
    expect(md.startsWith("# Concept HTML Templates\n")).toBe(true);
    expect(md).not.toMatch(/^# Concept templates, part /m);
    // one top-level heading per template plus the shared systems
    for (const h of ["# Template: decision", "# Template: design", "# Template: free", "# Shared Systems (all templates)"]) {
      expect(md).toContain("\n" + h + "\n");
    }
  });
});
