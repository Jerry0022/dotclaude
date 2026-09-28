import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Official skill guidance (platform.claude.com agent-skills best practices):
// reference files one level deep — a file reached only through another one
// may be read partially or not at all. For a deterministic pipeline every
// pointer must also land: a dangling file or § section lets a ship skip a
// step silently. This suite checks both across the whole do-ship tree.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DK = path.join(__dirname, "..", "..", "deep-knowledge");
const SKILL = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const list = (dir) => fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith(".md")).sort();
const DK = list("deep-knowledge");
const MODES = list("modes");
const INDEX = SKILL.slice(SKILL.indexOf("## Reference files"));

/** Every markdown file of the skill, keyed by its path relative to the skill dir. */
const DOCS = Object.fromEntries([
  ["SKILL.md", SKILL],
  ["reference.md", fs.readFileSync(path.join(__dirname, "reference.md"), "utf8")],
  ...DK.map((f) => [`deep-knowledge/${f}`, fs.readFileSync(path.join(__dirname, "deep-knowledge", f), "utf8")]),
  ...MODES.map((f) => [`modes/${f}`, fs.readFileSync(path.join(__dirname, "modes", f), "utf8")]),
]);

/** Resolve a referenced file name to an absolute path, or null. */
function resolve(name, raw) {
  if (name === "SKILL.md") return path.join(__dirname, "SKILL.md");
  if (/modes\/$/.test(raw) || (MODES.includes(name) && !DK.includes(name))) return path.join(__dirname, "modes", name);
  if (/skills\/do-ship\/deep-knowledge\/$/.test(raw) || (!raw.includes("{PLUGIN_ROOT}/deep-knowledge/") && DK.includes(name))) {
    return path.join(__dirname, "deep-knowledge", name);
  }
  const plugin = path.join(PLUGIN_DK, name);
  return fs.existsSync(plugin) ? plugin : null;
}

const headings = (file) => fs.readFileSync(file, "utf8").split("\n").filter((l) => /^#{1,4} /.test(l))
  .map((l) => l.replace(/[`*]/g, "").toLowerCase()).join("\n");

// `file.md` § Section / file.md → Section — the section text ends at the first
// clause boundary; its first three words must appear in a heading of the file.
const SECTION_REF = /([\w{}./-]*\/)?([A-Za-z][\w-]*\.md)`?\s*(?:§|→)\s*\**([A-Za-z][^\n.()`|:*\]]*)/g;
function sectionRefs() {
  const out = [];
  for (const [doc, text] of Object.entries(DOCS)) {
    for (const m of text.matchAll(SECTION_REF)) {
      const words = m[3].split(/\s+(?:and|has|for|in|then)(?:\s+|$)/)[0].trim().split(/\s+/).slice(0, 3).join(" ");
      if (words) out.push({ doc, raw: m[1] || "", name: m[2], words });
    }
  }
  return out;
}

describe("do-ship — every reference file is one level from SKILL.md", () => {
  test("the tree still has its deep-knowledge and mode files", () => {
    expect(DK.length).toBeGreaterThanOrEqual(19);
    expect(MODES).toEqual(expect.arrayContaining(["delegated.md", "promote.md", "resume.md"]));
  });

  test.each([...DK.map((f) => `deep-knowledge/${f}`), ...MODES.map((f) => `modes/${f}`)])(
    "%s is listed in the Reference files index", (rel) => {
      expect(INDEX).toContain("`" + rel + "`");
    });

  test("every index row names an existing file", () => {
    const rows = [...INDEX.matchAll(/^\| `((?:deep-knowledge|modes)\/[a-z-]+\.md)` \|/gm)].map((m) => m[1]);
    expect(rows.length).toBe(DK.length + MODES.length);
    for (const rel of rows) expect(fs.existsSync(path.join(__dirname, rel)), rel).toBe(true);
  });

  test("every index row says when to read the file", () => {
    for (const m of INDEX.matchAll(/^\| `[^`]+` \| (.*) \|$/gm)) expect(m[1].trim().length, m[0]).toBeGreaterThan(5);
  });
});

describe("do-ship — every pointer lands", () => {
  test("every deep-knowledge/ or modes/ path in SKILL.md exists", () => {
    const paths = [...SKILL.matchAll(/(?:\{PLUGIN_ROOT\}\/skills\/do-ship\/)?((?:deep-knowledge|modes)\/[a-z-]+\.md)/g)]
      .filter((m) => !SKILL.slice(Math.max(0, m.index - 16), m.index).includes("{PLUGIN_ROOT}/"))
      .map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(30);
    for (const rel of new Set(paths)) expect(fs.existsSync(path.join(__dirname, rel)), rel).toBe(true);
  });

  test("every {PLUGIN_ROOT}/deep-knowledge file named anywhere in the skill exists", () => {
    for (const [doc, text] of Object.entries(DOCS)) {
      for (const m of text.matchAll(/\{PLUGIN_ROOT\}\/deep-knowledge\/([a-z-]+\.md)/g)) {
        expect(fs.existsSync(path.join(PLUGIN_DK, m[1])), `${doc} → ${m[1]}`).toBe(true);
      }
    }
  });

  test("every `file.md` § / → section reference resolves to a heading", () => {
    const refs = sectionRefs();
    expect(refs.length).toBeGreaterThanOrEqual(35);
    for (const r of refs) {
      const file = resolve(r.name, r.raw);
      expect(file, `${r.doc}: ${r.name} not found`).not.toBeNull();
      expect(headings(file), `${r.doc}: ${r.name} § ${r.words}`).toContain(r.words.toLowerCase());
    }
  });
});
