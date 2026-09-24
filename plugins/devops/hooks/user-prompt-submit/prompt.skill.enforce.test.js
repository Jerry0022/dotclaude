import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectInlineSkillMentions, listPluginSkills, run } from "./prompt.skill.enforce.js";

const KNOWN = [
  "auto-agents",
  "auto-concept",
  "auto-fix",
  "auto-harden",
  "auto-polish",
  "do-ship",
  "do-run",
];

describe("detectInlineSkillMentions — inline /devops-* references (#235)", () => {
  test("the incident case: command with trailing prose in one message", () => {
    expect(
      detectInlineSkillMentions(
        "/auto-concept lass uns das machen und dann direkt umsetzen",
        KNOWN,
      ),
    ).toEqual(["auto-concept"]);
  });

  test("mention mid-sentence", () => {
    expect(
      detectInlineSkillMentions("wir könnten danach /auto-harden laufen lassen", KNOWN),
    ).toEqual(["auto-harden"]);
  });

  test("multiple mentions, deduplicated, in order of first appearance", () => {
    expect(
      detectInlineSkillMentions(
        "erst /do-ship, dann nochmal /do-ship und zum Schluss /auto-polish",
        KNOWN,
      ),
    ).toEqual(["do-ship", "auto-polish"]);
  });

  test("adjacent punctuation does not break detection", () => {
    expect(detectInlineSkillMentions("(siehe /auto-fix)", KNOWN)).toEqual(["auto-fix"]);
    expect(detectInlineSkillMentions("nutze /do-run.", KNOWN)).toEqual(["do-run"]);
  });

  test("a mention inside quotes or code is discussion, not an invocation", () => {
    expect(detectInlineSkillMentions('"/do-ship" wäre gut', KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("der Hook sagt `/auto-concept` zuerst", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("„/fix“ steht in der Doku", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("```\n/auto-harden\n```", KNOWN)).toEqual([]);
  });

  test("unknown skill names are dropped", () => {
    expect(detectInlineSkillMentions("/devops-doesnotexist bitte", KNOWN)).toEqual([]);
  });

  test("path-like strings are not mentions (no word/path prefix before the slash)", () => {
    expect(detectInlineSkillMentions("schau in docs/devops-guide.md nach", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("plugins/ship/SKILL.md", KNOWN)).toEqual([]);
  });

  test("already-expanded slash command (<command-name> tag) is skipped entirely", () => {
    expect(
      detectInlineSkillMentions(
        "<command-name>concept</command-name> args… /auto-harden too",
        KNOWN,
      ),
    ).toEqual([]);
  });

  test("case-insensitive, normalized to lowercase", () => {
    expect(detectInlineSkillMentions("Bitte /Do-Ship ausführen", KNOWN)).toEqual([
      "do-ship",
    ]);
  });

  test("no mentions → empty list", () => {
    expect(detectInlineSkillMentions("Bitte fix den Bug in foo.ts", KNOWN)).toEqual([]);
  });

  test("empty / non-string input → empty list", () => {
    expect(detectInlineSkillMentions("", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions(null, KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions(undefined, KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions(42, KNOWN)).toEqual([]);
  });
});

describe("detectInlineSkillMentions — machine prompts (R1)", () => {
  test.each([
    "<<autonomous-loop>> /auto-concept",
    "AUTONOMOUS_RESUME: /auto-harden",
    "RUN_BACKLOG_AUTOSTART: /auto-fix",
    "Silently run /do-ship checks",
    '<scheduled-task name="x">/auto-concept</scheduled-task>',
  ])("%s → no mentions", (msg) => {
    expect(detectInlineSkillMentions(msg, KNOWN)).toEqual([]);
  });
});

describe("PR 3 retired skills — never mandated by the hook", () => {
  const RETIRED = ["setup-readme", "auto-graph", "auto-usage", "claude-strict"];

  test("they are not skill directories any more, so no inline mention counts", () => {
    const skills = listPluginSkills();
    for (const n of RETIRED) expect(skills).not.toContain(n);
    expect(detectInlineSkillMentions("/claude-strict on und /auto-graph, /auto-usage, /setup-readme", skills)).toEqual([]);
  });

  test.each([
    "/claude-strict on",
    "bitte /claude-strict mach den Rand dünner",
    "mach das mit /setup-readme",
    "/auto-usage",
    "/auto-graph und dann knowledge graph erklären",
    "create a readme and refresh usage",
  ])("run(%j) emits no Skill mandate for a retired name", (prompt) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "enforce-retired-"));
    try {
      const out = run({ prompt, cwd, session_id: "vitest-retired" });
      for (const n of RETIRED) expect(out).not.toContain(`Skill("${n}")`);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
