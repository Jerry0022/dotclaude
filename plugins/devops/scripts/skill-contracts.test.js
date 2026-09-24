import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Extension dirs of the pre-PR-2 names stay valid as FALLBACKS (a consumer
// extension written before the rename keeps working), so a Step 0 / prose ref
// to an old name is legitimate — but only for the skill that owns it now.
const { canonicalSkillName, retiredSkill } = require("../hooks/lib/skill-names.js");

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

/**
 * Every markdown file belonging to a skill — SKILL.md, reference.md, any other
 * top-level doc, plus the sibling deep-knowledge dir. Enumerating only SKILL.md
 * left reference.md invisible to all three assertions, which is exactly where a
 * stale path survives unnoticed. Mode files of a folding skill
 * (`modes/<mode>.md`, `modes/<mode>/*.md`, `modes/<mode>/deep-knowledge/*.md`)
 * belong to it too.
 */
function skillDocs(skill) {
  const dir = path.join(SKILLS_DIR, skill);
  const mdIn = (...rel) => {
    const abs = path.join(dir, ...rel);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".md"))
      .map(e => [...rel, e.name]);
  };
  const docs = [...mdIn(), ...mdIn("deep-knowledge")];
  const modesDir = path.join(dir, "modes");
  if (fs.existsSync(modesDir)) {
    docs.push(...mdIn("modes"));
    for (const e of fs.readdirSync(modesDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
      docs.push(...mdIn("modes", e.name), ...mdIn("modes", e.name, "deep-knowledge"));
    }
  }
  return docs;
}

// A skill that owns a sibling deep-knowledge/ dir makes the bare prefix
// `deep-knowledge/x.md` ambiguous: it reads as the sibling, while the
// plugin-level file of that name lives elsewhere. The reader follows a path
// that does not exist and routes from memory instead. Skills without a sibling
// dir have only one possible referent, so bare refs stay unambiguous there.
const PLUGIN_DK_DIR = path.join(PLUGIN_ROOT, "deep-knowledge");

// Filenames that appear as `deep-knowledge/x.md` but name a file a CONSUMER
// project is told to create — not a doc that exists here. Keyed per filename,
// not per skill, so the rest of that skill's refs stay checked.
// One entry per exemption, each with the reason.
//
// Currently empty: the extraction targets that needed exempting
// (architecture.md, api.md, setup.md) moved out of skills/ and into
// deep-knowledge/content-conventions.md, which this assertion does not scan.
// The mechanism stays because the next skill proposing a consumer-side path
// will need it — an unexplained bare ref is otherwise indistinguishable from
// a typo.
const EXEMPT_DK_REF_FILES = new Map([]);

describe("bare deep-knowledge/ refs resolve", () => {
  test("every exemption states why it is not a broken reference", () => {
    for (const [file, reason] of EXEMPT_DK_REF_FILES) {
      expect(reason.length, `exemption "${file}" needs a written reason`).toBeGreaterThan(40);
    }
  });

  test.each(skillDirs())("%s", skill => {
    const unresolved = [];

    for (const rel of skillDocs(skill)) {
      // A mode's own docs (modes/<mode>/…) resolve against modes/<mode>/deep-knowledge/.
      const base = rel[0] === "modes" && rel.length > 2 ? path.join(SKILLS_DIR, skill, "modes", rel[1]) : path.join(SKILLS_DIR, skill);
      const ownsSibling = fs.existsSync(path.join(base, "deep-knowledge"));
      const body = withoutCodeFences(
        fs.readFileSync(path.join(SKILLS_DIR, skill, ...rel), "utf8"),
      );
      // Only bare `deep-knowledge/<file>.md`. A ref carrying an explicit root
      // ({PLUGIN_ROOT}/, plugins/devops/, skills/<name>/) is unambiguous, so
      // the preceding character must not be part of a longer path.
      for (const m of body.matchAll(/(^|[\s(`"])deep-knowledge\/([A-Za-z0-9._-]+\.md)/g)) {
        const file = m[2];
        if (EXEMPT_DK_REF_FILES.has(file)) continue;
        // With a sibling dir the bare prefix means the sibling — it must exist
        // there. Without one there is only one possible referent, the
        // plugin-level dir — but a typo there is just as dead, only silent.
        const target = ownsSibling
          ? path.join(base, "deep-knowledge", file)
          : path.join(PLUGIN_DK_DIR, file);
        if (!fs.existsSync(target)) {
          unresolved.push(`${rel.join("/")} → deep-knowledge/${file} (${ownsSibling ? "sibling" : "plugin-level"})`);
        }
      }
    }

    expect(
      unresolved,
      "bare deep-knowledge/ ref does not resolve — a sibling dir makes it mean the sibling; qualify plugin-level refs with {PLUGIN_ROOT}/",
    ).toEqual([]);
  });
});

describe("{PLUGIN_ROOT}-qualified refs resolve", () => {
  // The fix for ambiguous bare refs tells authors to write
  // `{PLUGIN_ROOT}/deep-knowledge/x.md` — a form no assertion checked, so a
  // typo in the recommended spelling stayed as silent as the defect it fixed.
  const targets = [];
  for (const skill of skillDirs()) {
    for (const rel of skillDocs(skill)) {
      targets.push([`skills/${skill}/${rel.join("/")}`, path.join(SKILLS_DIR, skill, ...rel)]);
    }
  }
  for (const f of fs.readdirSync(PLUGIN_DK_DIR).filter(f => f.endsWith(".md"))) {
    targets.push([`deep-knowledge/${f}`, path.join(PLUGIN_DK_DIR, f)]);
  }

  test.each(targets)("%s", (_label, file) => {
    const body = withoutCodeFences(fs.readFileSync(file, "utf8"));
    const unresolved = [];
    // Both spellings of "rooted at the plugin dir".
    for (const m of body.matchAll(
      /(?:\{PLUGIN_ROOT\}|\$\{CLAUDE_PLUGIN_ROOT\}|plugins\/devops)\/([A-Za-z0-9._\-/]+\.md)/g,
    )) {
      if (!fs.existsSync(path.join(PLUGIN_ROOT, m[1]))) unresolved.push(m[1]);
    }
    expect([...new Set(unresolved)], "qualified ref names a file that does not exist").toEqual([]);
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
      proseFiles.push([`skills/${skill}/${rel.join("/")}`, path.join(SKILLS_DIR, skill, ...rel), skill]);
    }
  }
  for (const [dir, label] of [["deep-knowledge", "deep-knowledge"], ["agents", "agents"]]) {
    const abs = path.join(PLUGIN_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter(f => f.endsWith(".md"))) {
      proseFiles.push([`${label}/${f}`, path.join(abs, f), null]);
    }
  }

  test.each(proseFiles)("%s", (_label, file, owner) => {
    const body = withoutCodeFences(fs.readFileSync(file, "utf8"));
    const unknown = [];
    for (const m of body.matchAll(/\.claude\/skills\/([A-Za-z0-9._-]+)\//g)) {
      const dir = m[1];
      if (dir.startsWith("{") || dir.startsWith("<")) continue; // placeholder
      if (EXEMPT_EXTENSION_DIRS.has(dir)) continue;
      // A PR-3 retired skill's old dir is legitimate in the doc that replaced
      // it (it says what happens to such an extension) and in auto-extend,
      // which explains retired names to the user.
      const retired = retiredSkill(dir);
      if (retired && (path.basename(file) === retired.doc || owner === "auto-extend")) continue;
      // An old name is a legitimate fallback dir — in the docs of the skill
      // that owns it now, or in plugin-level prose that says so on the line.
      const legacyOwner = canonicalSkillName(dir);
      if (!SKILL_NAMES.has(dir) && legacyOwner !== dir && SKILL_NAMES.has(legacyOwner)) {
        const lineText = body.slice(body.lastIndexOf("\n", m.index) + 1, body.indexOf("\n", m.index));
        if (owner === legacyOwner || /pre-PR-2|fallback/i.test(lineText)) continue;
      }
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
      // The new name, or a pre-PR-2 name of this very skill (fallback dir).
      const ok = dir === name || canonicalSkillName(dir) === name;
      expect(ok, `Step 0 global extension dir ${dir} must be the frontmatter name ${name} or one of its pre-PR-2 names`).toBe(true);
    }
  });
});

describe("issue title prefixes are members of the canonical table", () => {
  // auto-issue treats a title-format violation as a hard error, so a skill
  // handing over `[FEAT]` instead of `[FEATURE]` fails at issue-creation time —
  // in the branch whose whole job is filing the issue somewhere else.
  const rules = fs.readFileSync(
    path.join(SKILLS_DIR, "auto-issue", "deep-knowledge", "issue-rules.md"),
    "utf8",
  );
  const canonical = new Set([...rules.matchAll(/\|\s*`\[([A-Z]+)\]`\s*\|/g)].map(m => m[1]));
  // Documented placeholder for "whichever type applies".
  const PLACEHOLDERS = new Set(["TYPE"]);
  // Bracket tags that are log levels or callouts, never issue-title prefixes.
  const NOT_TITLE_PREFIXES = new Set([
    "INFO", "WARN", "WARNING", "ERROR", "DEBUG", "TRACE", "FATAL",
    "NOTE", "TIP", "TODO", "CCD",
  ]);
  // `[PREFIX] ` followed by the title: a placeholder, or any word. Matching a
  // word shape (`[A-Z][a-z]`) instead missed `[FEAT] API …` and `[FEAT] fix …`.
  const TITLE_PREFIX_SHAPE = /\[([A-Z]{3,})\]\s+(?:<[^>]+>|[A-Za-z][A-Za-z-]*\b)/g;

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
    const body = withoutCodeFences(fs.readFileSync(file, "utf8"));
    // An issue-title prefix is followed by the title itself: a placeholder
    // (`[BUG] <short summary>`) or real title text (`[CHORE] Capture learning`).
    // Log levels and callouts are excluded by name, not by shape — relying on
    // the shape alone left `[FEAT] Fix the crash` invisible.
    const used = new Set([...body.matchAll(TITLE_PREFIX_SHAPE)].map(m => m[1]));
    const bad = [...used].filter(
      p => !canonical.has(p) && !PLACEHOLDERS.has(p) && !NOT_TITLE_PREFIXES.has(p),
    );
    expect(bad, `title prefixes not in issue-rules.md: ${bad.join(", ")}`).toEqual([]);
  });

  test("the assertion catches real violations and spares log levels", () => {
    // Negative fixtures. Earlier shapes let each of these through in turn:
    // requiring `<lowercase-hyphen>` missed a multi-word placeholder, and
    // requiring `[A-Z][a-z]` missed an acronym or a lowercase word.
    const violating = [
      "Hand over `[FEAT] Fix the crash` to the issue skill.",
      "title: `[FEAT] <short summary>`",
      "`[FEAT] API rate limiting`",
      "`[FEAT] fix the crash`",
    ];
    const innocent = ["- [INFO] <detail> is written to the log", "[WARN] Disk almost full"];

    for (const text of violating) {
      const found = [...text.matchAll(new RegExp(TITLE_PREFIX_SHAPE))].map(m => m[1]);
      expect(found, `missed a bad prefix in: ${text}`).toContain("FEAT");
    }
    expect(canonical.has("FEAT")).toBe(false);

    for (const text of innocent) {
      const hits = [...text.matchAll(new RegExp(TITLE_PREFIX_SHAPE))]
        .map(m => m[1])
        .filter(p => !NOT_TITLE_PREFIXES.has(p));
      expect(hits, `false positive in: ${text}`).toEqual([]);
    }
  });
});
