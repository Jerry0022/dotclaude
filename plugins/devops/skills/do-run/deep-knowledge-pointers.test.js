/**
 * do-run's SKILL.md keeps the router's decisions; question and execution
 * detail lives in its sibling deep-knowledge/ (content-conventions.md §
 * Extraction procedure). A `§ <heading>` pointer that no longer matches a
 * heading sends the reader nowhere, and a section no pointer reaches is
 * unreachable from the router — both fail here instead of at run time.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8").replace(/\r\n/g, "\n");

const skill = read("SKILL.md");
const docs = Object.fromEntries(
  readdirSync(join(here, "deep-knowledge"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, read("deep-knowledge", f)]),
);
const headings = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
// `deep-knowledge/<file>` — the whole doc — or `deep-knowledge/<file>` § <heading>.
const pointers = [...skill.matchAll(/`deep-knowledge\/([\w.-]+\.md)`(?: § ([^.\n]+))?/g)]
  .map((m) => ({ file: m[1], section: m[2] ? m[2].trim() : null }));

describe("do-run SKILL.md → deep-knowledge pointers", () => {
  test("every pointer names an existing doc and, with §, one of its headings", () => {
    expect(pointers.length).toBeGreaterThan(0);
    for (const { file, section } of pointers) {
      expect(docs[file], `deep-knowledge/${file}`).toBeDefined();
      if (section) expect(headings(docs[file]), `${file} § ${section}`).toContain(section);
    }
  });

  test("every section of every doc is reachable from SKILL.md", () => {
    for (const [file, text] of Object.entries(docs)) {
      const whole = pointers.some((p) => p.file === file && p.section === null);
      for (const h of headings(text)) {
        const named = pointers.some((p) => p.file === file && p.section === h);
        expect(whole || named, `${file} § ${h} is not reachable from SKILL.md`).toBe(true);
      }
    }
  });
});
