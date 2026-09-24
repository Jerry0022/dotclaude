import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Enforces the `layer` / `invokes` / `triggers` frontmatter contract
// (docs/superpowers/specs/2026-09-24-skill-restructure-design.md): calls go
// strictly to a higher layer number (so a cycle is impossible by construction),
// every `invokes` entry names a real skill, and every quoted trigger phrase in
// a skill's description survives — verbatim — in its `triggers:` frontmatter.
// `layer` / `invokes` govern devops→devops calls only; the harness ignores
// them at runtime, this test IS the enforcement (CONVENTIONS.md → skill
// frontmatter fields).

const require = createRequire(import.meta.url);
const { loadAllSkills } = require("../hooks/lib/skill-meta.js");

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(PLUGIN_ROOT, "skills");

const ALL_SKILLS = loadAllSkills(SKILLS_DIR);
const SKILL_NAMES = Object.keys(ALL_SKILLS);

describe("skill frontmatter: layer / invokes present", () => {
  test("discovers skills", () => {
    expect(SKILL_NAMES.length).toBeGreaterThan(0);
  });

  test.each(SKILL_NAMES)("%s declares layer, invokes, triggers", (name) => {
    const meta = ALL_SKILLS[name];
    expect(typeof meta.layer, `${name}: layer must be a number`).toBe("number");
    expect(Number.isInteger(meta.layer), `${name}: layer must be an integer`).toBe(true);
    expect(Array.isArray(meta.invokes), `${name}: invokes must be an array`).toBe(true);
    expect(typeof meta.triggers, `${name}: triggers must be an object`).toBe("object");
  });
});

describe("skill graph: invokes edges point at real skills", () => {
  const edges = [];
  for (const [name, meta] of Object.entries(ALL_SKILLS)) {
    for (const callee of meta.invokes) edges.push([name, callee]);
  }

  test.each(edges)("%s → %s: callee exists", (_caller, callee) => {
    expect(SKILL_NAMES, `unknown skill named in invokes: ${callee}`).toContain(callee);
  });
});

describe("skill graph: every edge goes to a strictly greater layer", () => {
  const edges = [];
  for (const [name, meta] of Object.entries(ALL_SKILLS)) {
    for (const callee of meta.invokes) edges.push([name, callee]);
  }

  test.each(edges)("layer(%s) < layer(%s)", (caller, callee) => {
    const callerLayer = ALL_SKILLS[caller].layer;
    const calleeMeta = ALL_SKILLS[callee];
    expect(calleeMeta, `${callee} (invoked by ${caller}) has no frontmatter meta`).toBeTruthy();
    expect(
      callerLayer,
      `${caller} (layer ${callerLayer}) → ${callee} (layer ${calleeMeta.layer}) violates the layer rule`,
    ).toBeLessThan(calleeMeta.layer);
  });
});

describe("skill graph: no cycle", () => {
  test("depth-first search finds no cycle in the invokes graph", () => {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map(SKILL_NAMES.map((n) => [n, WHITE]));
    const stack = [];
    let cyclePath = null;

    function visit(node) {
      if (cyclePath) return;
      color.set(node, GRAY);
      stack.push(node);
      for (const callee of ALL_SKILLS[node]?.invokes ?? []) {
        if (!ALL_SKILLS[callee]) continue; // reported by the "callee exists" suite
        if (color.get(callee) === GRAY) {
          const start = stack.indexOf(callee);
          cyclePath = stack.slice(start).concat(callee);
          return;
        }
        if (color.get(callee) === WHITE) {
          visit(callee);
          if (cyclePath) return;
        }
      }
      stack.pop();
      color.set(node, BLACK);
    }

    for (const name of SKILL_NAMES) {
      if (color.get(name) === WHITE) visit(name);
      if (cyclePath) break;
    }

    expect(cyclePath, `cycle found: ${cyclePath?.join(" → ")}`).toBeNull();
  });
});

describe("trigger preservation: every quoted description-trigger phrase survives in triggers:", () => {
  // Pulls quoted phrases out of the "Triggers on: ..." / "Triggers: ..."
  // sentence in each skill's raw description text (from the SKILL.md source,
  // not the parsed/folded meta.description, so multi-line quoting artifacts
  // don't matter) and asserts each one appears verbatim in some triggers[lang].
  function extractDescriptionBlock(rawText) {
    const normalized = rawText.replace(/\r\n/g, "\n");
    const m = normalized.match(/\ndescription:\s*>-?\n([\s\S]*?)\n[A-Za-z0-9_-]+:/);
    if (m) return m[1];
    // Fallback: single-line `description: "..."` form (unused today, kept for safety).
    const m2 = normalized.match(/\ndescription:\s*(.+)\n/);
    return m2 ? m2[1] : "";
  }

  function extractTriggerPhrases(descriptionBlock) {
    const m = descriptionBlock.match(/Triggers?(?: on)?:\s*([\s\S]*)/i);
    if (!m) return [];
    // Stop at the first sentence that starts a new instruction ("Do NOT
    // trigger", "Also ...", explicit-only prose) — only quoted phrases up to
    // that point are the trigger list itself.
    // The source wraps long lines, so a quoted phrase can itself contain a
    // hard line break + indentation — fold it back to single spaces before
    // matching, the same way YAML folds a `>-` block scalar.
    const tail = m[1].replace(/\n\s*/g, " ");
    const phrases = [];
    for (const qm of tail.matchAll(/"([^"]+)"/g)) {
      phrases.push(qm[1]);
    }
    return phrases;
  }

  const cases = [];
  for (const name of SKILL_NAMES) {
    const raw = fs.readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const block = extractDescriptionBlock(raw);
    const phrases = extractTriggerPhrases(block);
    for (const phrase of phrases) cases.push([name, phrase]);
  }

  test("fixture sanity: at least one skill contributes trigger phrases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases)("%s: %j is preserved", (name, phrase) => {
    const meta = ALL_SKILLS[name];
    const allPhrases = Object.values(meta.triggers).flat();
    expect(
      allPhrases,
      `${name}: description trigger phrase "${phrase}" missing from triggers: frontmatter`,
    ).toContain(phrase);
  });
});

// ── Spec "Units" + "Call graph" (PR 2 of the skill restructure) ─────────────
// docs/superpowers/specs/2026-09-24-skill-restructure-design.md is the single
// source; this table mirrors it so a frontmatter edit that drifts from the
// approved design fails here. `visibility`: "menu" = user-invocable (default),
// "hidden" = `user-invocable: false`, "user-only" = `disable-model-invocation: true`.
const { RENAMED, FOLDED, FOLDED_TRIGGERS } = require("../hooks/lib/skill-names.js");

const UNITS = {
  "do-batch":      { layer: 0, visibility: "menu",      invokes: ["do-run", "auto-concept"] },
  "setup-cleanup": { layer: 0, visibility: "user-only", invokes: ["auto-concept", "do-ship"] },
  "setup-project": { layer: 0, visibility: "user-only", invokes: [] },
  "do-run":        { layer: 1, visibility: "menu",      invokes: ["auto-concept", "do-ship", "auto-harden", "auto-polish", "auto-agents", "auto-issue"] },
  "do-learn":      { layer: 1, visibility: "menu",      invokes: ["auto-issue"] },
  "auto-concept":  { layer: 2, visibility: "hidden",    invokes: ["do-ship", "auto-agents", "auto-issue"] },
  "auto-fix":      { layer: 2, visibility: "hidden",    invokes: ["auto-agents"] },
  "auto-guide":    { layer: 2, visibility: "hidden",    invokes: [] },
  "auto-extend":   { layer: 2, visibility: "hidden",    invokes: [] },
  "auto-update":   { layer: 2, visibility: "hidden",    invokes: [] },
  "do-ship":       { layer: 3, visibility: "menu",      invokes: ["auto-harden", "auto-polish"] },
  "auto-harden":   { layer: 4, visibility: "hidden",    invokes: ["auto-agents"] },
  "auto-polish":   { layer: 4, visibility: "hidden",    invokes: ["auto-agents"] },
  "auto-agents":   { layer: 5, visibility: "hidden",    invokes: [] },
  "auto-issue":    { layer: 5, visibility: "hidden",    invokes: [] },
};

// PR 3 moves these out of skills/; until then they keep their PR-1 frontmatter.
const PR3_SKILLS = ["setup-readme", "auto-graph", "auto-usage", "claude-strict"];

const MODE_FILES = {
  "do-run": ["backlog", "autonomous", "burn", "rethink", "audit"],
  "do-ship": ["promote"],
};

function visibilityOf(meta) {
  if (meta.disableModelInvocation === true) return "user-only";
  if (meta.userInvocable === false) return "hidden";
  return "menu";
}

describe("spec Units table: the exact skill roster", () => {
  test("skills/ holds exactly the spec units plus the four PR-3 skills", () => {
    expect([...SKILL_NAMES].sort()).toEqual([...Object.keys(UNITS), ...PR3_SKILLS].sort());
  });

  test("no pre-PR-2 skill directory survives", () => {
    for (const oldName of [...Object.keys(RENAMED), ...Object.keys(FOLDED)]) {
      expect(SKILL_NAMES, `old skill dir still present: ${oldName}`).not.toContain(oldName);
    }
  });

  test.each(Object.keys(UNITS))("%s: frontmatter name equals its directory", (name) => {
    expect(ALL_SKILLS[name].name).toBe(name);
  });
});

describe("spec Units table: layer and visibility", () => {
  test.each(Object.entries(UNITS))("%s", (name, unit) => {
    const meta = ALL_SKILLS[name];
    expect(meta, `${name} missing`).toBeTruthy();
    expect(meta.layer, `${name} layer`).toBe(unit.layer);
    expect(visibilityOf(meta), `${name} visibility`).toBe(unit.visibility);
  });

  test("every auto-* unit is hidden from the slash menu", () => {
    for (const name of Object.keys(UNITS).filter((n) => n.startsWith("auto-"))) {
      expect(ALL_SKILLS[name].userInvocable, name).toBe(false);
    }
  });
});

describe("spec call graph: the exact invokes edges", () => {
  test.each(Object.entries(UNITS))("%s", (name, unit) => {
    expect([...ALL_SKILLS[name].invokes].sort()).toEqual([...unit.invokes].sort());
  });

  test.each(PR3_SKILLS)("%s (PR 3) invokes nothing", (name) => {
    expect(ALL_SKILLS[name].invokes).toEqual([]);
  });
});

describe("folded skills: mode files exist and the old triggers survive", () => {
  const modeCases = Object.entries(MODE_FILES).flatMap(([skill, modes]) => modes.map((m) => [skill, m]));

  test.each(modeCases)("%s/modes/%s.md exists and carries a body", (skill, mode) => {
    const file = path.join(SKILLS_DIR, skill, "modes", `${mode}.md`);
    expect(fs.existsSync(file), file).toBe(true);
    const body = fs.readFileSync(file, "utf8");
    expect(body.startsWith("---"), `${file} must not carry skill frontmatter (it is not a skill)`).toBe(false);
    expect(body.length).toBeGreaterThan(500);
  });

  test("every folded skill has a mode file in its owner", () => {
    for (const [oldName, fold] of Object.entries(FOLDED)) {
      expect(MODE_FILES[fold.skill], `${oldName} → ${fold.skill}`).toContain(fold.mode);
    }
  });

  test("the owner's SKILL.md points at every mode file", () => {
    for (const [skill, modes] of Object.entries(MODE_FILES)) {
      const body = fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      for (const mode of modes) expect(body, `${skill} → modes/${mode}.md`).toContain(`modes/${mode}.md`);
    }
  });

  const triggerCases = Object.entries(FOLDED_TRIGGERS).flatMap(([oldName, byLang]) =>
    Object.values(byLang).flat().map((phrase) => [oldName, FOLDED[oldName].skill, phrase]));

  test.each(triggerCases)("%s → %s keeps %j", (_old, owner, phrase) => {
    expect(Object.values(ALL_SKILLS[owner].triggers).flat()).toContain(phrase);
  });

  test("the snapshot is not empty", () => {
    expect(triggerCases.length).toBeGreaterThan(30);
  });
});
