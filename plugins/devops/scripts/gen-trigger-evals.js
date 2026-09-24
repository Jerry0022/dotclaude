#!/usr/bin/env node
// Generates plugins/devops/evals/triggers/<case>-<lang>/ directories from
// plugins/devops/evals/triggers/cases.json. Idempotent: rerunning with the
// same cases.json produces byte-identical output. Removes stale generated
// directories (any directory under evals/triggers/ that is not one of the
// current case ids) so cases.json stays the single source of truth.
//
// Usage: node plugins/devops/scripts/gen-trigger-evals.js [--check]
//   --check   exit 1 if the generated directories differ from cases.json,
//             without writing anything (used by the vitest sync test).

"use strict";

const fs = require("fs");
const path = require("path");

const TRIGGERS_DIR = path.join(__dirname, "..", "evals", "triggers");
const CASES_FILE = path.join(TRIGGERS_DIR, "cases.json");

// The exact nudge line `prompt.knowledge.dispatch` injects per prompt in a
// real session (pinned to plugins/devops/hooks by
// prompt.knowledge.dispatch.test.js). Delegation eval cases carry it because
// the eval runner fires no UserPromptSubmit hooks; trigger cases carry it for
// the same reason and for consistency with delegation/.
const DELEGATION_NUDGE =
  '[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel only for two analysis lenses (parallel implementers → offer) · Complex → offer the run-agents skill, never auto-start. Hard stop (request narrowed: "just/quick/nur/schnell/keine Agents") → Inline; hard go ("agents/full") → as designed.';

const SCAFFOLD = `#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
`;

function loadCases() {
  const raw = fs.readFileSync(CASES_FILE, "utf8");
  return JSON.parse(raw);
}

function skillMatchPattern(names) {
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return `"skill"\\s*:\\s*"(?:[\\w-]+:)?(?:${alt})"`;
}

/** Expands cases.json into { dirName -> { promptMd, caseYaml, scaffoldSh, graderMd } } */
function buildDirs(data) {
  const languages = data.languages || [];
  const dirs = new Map();

  for (const c of data.cases) {
    const grader = [
      "---",
      "type: tool_used",
      "tool: Skill",
      `input_match: '${skillMatchPattern(c.expectedSkillNames)}'`,
      "min: 1",
      "arm: with-only",
      "---",
      "",
    ].join("\n");

    const makeEntry = (dirName, promptText, tags) => {
      const frontmatter = [
        "---",
        "max_turns: 10",
        "allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash]",
        `tags: [${tags.join(", ")}]`,
        "env: { EVAL_DOTCLAUDE_BUDGET: free }",
        "---",
        "",
      ].join("\n");
      const body = `${promptText}\n\n${DELEGATION_NUDGE}\n`;
      dirs.set(dirName, {
        promptMd: frontmatter + "\n" + body,
        caseYaml: `schema_version: "1.1"\nname: ${dirName}\ncontext:\n  scaffold_script: scaffold.sh\n`,
        scaffoldSh: SCAFFOLD,
        graderMd: grader,
      });
    };

    if (c.languageIndependent) {
      makeEntry(c.id, c.prompt, ["trigger", `skill-${c.skill}`, "lang-independent"]);
      continue;
    }

    const langs = c.languages || languages;
    for (const lang of langs) {
      const text = c.translations[lang];
      if (!text) {
        throw new Error(`case ${c.id} is missing a translation for language "${lang}"`);
      }
      makeEntry(`${c.id}-${lang}`, text, ["trigger", `skill-${c.skill}`, `lang-${lang}`]);
    }
  }

  return dirs;
}

function existingGeneratedDirs() {
  if (!fs.existsSync(TRIGGERS_DIR)) return [];
  return fs
    .readdirSync(TRIGGERS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function readDirState(dirName) {
  const base = path.join(TRIGGERS_DIR, dirName);
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  return {
    promptMd: read(path.join(base, "prompt.md")),
    caseYaml: read(path.join(base, "case.yaml")),
    scaffoldSh: read(path.join(base, "scaffold.sh")),
    graderMd: read(path.join(base, "graders", "skill-invoked.md")),
  };
}

function writeDir(dirName, entry) {
  const base = path.join(TRIGGERS_DIR, dirName);
  fs.mkdirSync(path.join(base, "graders"), { recursive: true });
  fs.writeFileSync(path.join(base, "prompt.md"), entry.promptMd);
  fs.writeFileSync(path.join(base, "case.yaml"), entry.caseYaml);
  fs.writeFileSync(path.join(base, "scaffold.sh"), entry.scaffoldSh, { mode: 0o755 });
  fs.writeFileSync(path.join(base, "graders", "skill-invoked.md"), entry.graderMd);
}

function removeDir(dirName) {
  fs.rmSync(path.join(TRIGGERS_DIR, dirName), { recursive: true, force: true });
}

function statesEqual(a, b) {
  return (
    a.promptMd === b.promptMd &&
    a.caseYaml === b.caseYaml &&
    a.scaffoldSh === b.scaffoldSh &&
    a.graderMd === b.graderMd
  );
}

function run({ check }) {
  const data = loadCases();
  const wanted = buildDirs(data);
  const existing = new Set(existingGeneratedDirs());
  const wantedNames = new Set(wanted.keys());

  let changed = false;
  const diffs = [];

  for (const [name, entry] of wanted) {
    const current = existing.has(name) ? readDirState(name) : null;
    if (!current || !statesEqual(current, entry)) {
      changed = true;
      diffs.push(`${existing.has(name) ? "update" : "create"} ${name}`);
      if (!check) writeDir(name, entry);
    }
  }

  for (const name of existing) {
    if (!wantedNames.has(name)) {
      changed = true;
      diffs.push(`remove ${name}`);
      if (!check) removeDir(name);
    }
  }

  return { changed, diffs, wantedCount: wanted.size };
}

if (require.main === module) {
  const check = process.argv.includes("--check");
  const { changed, diffs, wantedCount } = run({ check });
  if (check) {
    if (changed) {
      console.error(`evals/triggers/ is out of sync with cases.json:\n${diffs.join("\n")}`);
      process.exit(1);
    }
    console.log(`evals/triggers/ is in sync (${wantedCount} cases).`);
  } else {
    console.log(`Generated ${wantedCount} trigger eval cases under ${TRIGGERS_DIR}.`);
    if (diffs.length) console.log(diffs.join("\n"));
  }
}

module.exports = { run, buildDirs, loadCases, TRIGGERS_DIR, CASES_FILE };
