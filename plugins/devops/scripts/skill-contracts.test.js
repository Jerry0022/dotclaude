import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo-wide contracts every SKILL.md must satisfy. Each of these caught a real
// defect that was invisible at review time and silent at runtime.

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(PLUGIN_ROOT, "skills");

function skillDirs() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(n => fs.existsSync(path.join(SKILLS_DIR, n, "SKILL.md")));
}

const SKILL_NAMES = new Set(skillDirs());

function frontmatterName(body) {
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^name:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

/** Strip fenced code blocks — examples inside them are illustrations, not refs. */
function withoutCodeFences(body) {
  return body.replace(/```[\s\S]*?```/g, "");
}

/** Every markdown file belonging to a skill: SKILL.md + its sibling deep-knowledge. */
function skillDocs(skill) {
  const docs = [["SKILL.md"]];
  const dkDir = path.join(SKILLS_DIR, skill, "deep-knowledge");
  if (fs.existsSync(dkDir)) {
    for (const f of fs.readdirSync(dkDir).filter(f => f.endsWith(".md"))) {
      docs.push(["deep-knowledge", f]);
    }
  }
  return docs;
}

// A skill that owns a sibling deep-knowledge/ dir makes the bare prefix
// `deep-knowledge/x.md` ambiguous: it reads as the sibling, while the
// plugin-level file of that name lives elsewhere. The reader follows a path
// that does not exist and routes from memory instead. Skills without a sibling
// dir have only one possible referent, so bare refs stay unambiguous there.
const SKILLS_WITH_SIBLING_DK = skillDirs().filter(s =>
  fs.existsSync(path.join(SKILLS_DIR, s, "deep-knowledge")),
);

describe("bare deep-knowledge/ refs resolve, in skills that own a sibling dir", () => {
  test.each(SKILLS_WITH_SIBLING_DK)("%s", skill => {
    const unresolved = [];
    for (const rel of skillDocs(skill)) {
      const body = withoutCodeFences(
        fs.readFileSync(path.join(SKILLS_DIR, skill, ...rel), "utf8"),
      );
      // Only bare `deep-knowledge/<file>.md`. A ref carrying an explicit root
      // ({PLUGIN_ROOT}/, plugins/devops/, skills/<name>/) is unambiguous, so
      // the preceding character must not be part of a longer path.
      for (const m of body.matchAll(/(^|[\s(`"])deep-knowledge\/([A-Za-z0-9._-]+\.md)/g)) {
        const target = path.join(SKILLS_DIR, skill, "deep-knowledge", m[2]);
        if (!fs.existsSync(target)) {
          unresolved.push(`${rel.join("/")} → deep-knowledge/${m[2]}`);
        }
      }
    }
    expect(
      unresolved,
      "bare deep-knowledge/ ref resolves to a non-existent sibling — qualify plugin-level refs with {PLUGIN_ROOT}/",
    ).toEqual([]);
  });
});

// Extension dirs that deliberately do NOT correspond to a shipped skill.
// One entry per exemption, each with the reason it is not a stale name.
const EXEMPT_EXTENSION_DIRS = new Map([
  [
    "devops-test-plan",
    "Frozen consumer contract: projects keep their test profiles at this path. " +
      "Stated in deep-knowledge/test-plan.md — the plugin ships no such skill by design.",
  ],
]);

describe("skill extension paths point at skills that exist", () => {
  test("every exemption states why it is not a stale name", () => {
    for (const [dir, reason] of EXEMPT_EXTENSION_DIRS) {
      expect(reason.length, `exemption "${dir}" needs a written reason`).toBeGreaterThan(40);
    }
  });

  // Two failure modes, both silent: a skill's own Step 0 naming a stale
  // directory (left behind by a rename) loads nothing at all, and a
  // cross-reference to another skill's extension dir under its old name sends
  // the reader somewhere that will never be read.
  // Cover every prose surface that can carry such a path — a stale name in
  // plugin-level deep-knowledge or an agent misroutes just as silently.
  const proseFiles = [];
  for (const skill of skillDirs()) {
    for (const rel of skillDocs(skill)) {
      proseFiles.push([`skills/${skill}/${rel.join("/")}`, path.join(SKILLS_DIR, skill, ...rel)]);
    }
  }
  for (const [dir, label] of [["deep-knowledge", "deep-knowledge"], ["agents", "agents"]]) {
    const abs = path.join(PLUGIN_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter(f => f.endsWith(".md"))) {
      proseFiles.push([`${label}/${f}`, path.join(abs, f)]);
    }
  }

  test.each(proseFiles)("%s", (_label, file) => {
    const body = withoutCodeFences(fs.readFileSync(file, "utf8"));
    const unknown = [];
    for (const m of body.matchAll(/\.claude\/skills\/([A-Za-z0-9._-]+)\//g)) {
      const dir = m[1];
      if (dir.startsWith("{") || dir.startsWith("<")) continue; // placeholder
      if (EXEMPT_EXTENSION_DIRS.has(dir)) continue;
      if (!SKILL_NAMES.has(dir)) unknown.push(`.claude/skills/${dir}/`);
    }
    expect([...new Set(unknown)], "extension path names a skill that does not exist").toEqual([]);
  });

  test.each(skillDirs())("%s Step 0 uses its own name", skill => {
    const body = fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
    const name = frontmatterName(body);
    expect(name, `${skill}/SKILL.md has no parseable frontmatter name`).toBeTruthy();

    // The global extension path is unambiguously about THIS skill.
    const globalRefs = [...body.matchAll(/~\/\.claude\/skills\/([A-Za-z0-9._-]+)\//g)]
      .map(m => m[1])
      .filter(d => !d.startsWith("{") && !d.startsWith("<"));
    for (const dir of globalRefs) {
      expect(dir, `Step 0 global extension dir must equal the frontmatter name`).toBe(name);
    }
  });
});

describe("issue title prefixes are members of the canonical table", () => {
  // setup-issue treats a title-format violation as a hard error, so a skill
  // handing over `[FEAT]` instead of `[FEATURE]` fails at issue-creation time —
  // in the branch whose whole job is filing the issue somewhere else.
  const rules = fs.readFileSync(
    path.join(SKILLS_DIR, "setup-issue", "deep-knowledge", "issue-rules.md"),
    "utf8",
  );
  const canonical = new Set([...rules.matchAll(/\|\s*`\[([A-Z]+)\]`\s*\|/g)].map(m => m[1]));
  // Documented placeholder for "whichever type applies".
  const PLACEHOLDERS = new Set(["TYPE"]);

  test("the canonical table itself is non-empty", () => {
    expect(canonical.size).toBeGreaterThan(3);
    expect(canonical.has("BUG")).toBe(true);
    expect(canonical.has("FEATURE")).toBe(true);
  });

  const targets = [];
  for (const skill of skillDirs()) {
    for (const rel of skillDocs(skill)) {
      targets.push([`skills/${skill}/${rel.join("/")}`, path.join(SKILLS_DIR, skill, ...rel)]);
    }
  }
  const dkRoot = path.join(PLUGIN_ROOT, "deep-knowledge");
  for (const f of fs.readdirSync(dkRoot).filter(f => f.endsWith(".md"))) {
    targets.push([`deep-knowledge/${f}`, path.join(dkRoot, f)]);
  }

  test.each(targets)("%s", (_label, file) => {
    const body = fs.readFileSync(file, "utf8");
    // An issue-title prefix in a handoff contract is always followed by a
    // placeholder for the title text — `[BUG] <short>`, `[CHORE] Capture …`.
    // That shape distinguishes it from log levels and unrelated bracket tags.
    const used = new Set(
      [...body.matchAll(/\[([A-Z]{3,})\]\s+(?:<[a-z-]+>|Capture\b)/g)].map(m => m[1]),
    );
    const bad = [...used].filter(p => !canonical.has(p) && !PLACEHOLDERS.has(p));
    expect(bad, `title prefixes not in issue-rules.md: ${bad.join(", ")}`).toEqual([]);
  });
});
