import { describe, test, expect } from "vitest";
import { detectInlineSkillMentions } from "./prompt.skill.enforce.js";

const KNOWN = [
  "run-agents",
  "promote",
  "concept",
  "fix",
  "tune-harden",
  "tune-polish",
  "ship",
];

describe("detectInlineSkillMentions — inline /devops-* references (#235)", () => {
  test("the incident case: command with trailing prose in one message", () => {
    expect(
      detectInlineSkillMentions(
        "/concept lass uns das machen und dann direkt umsetzen",
        KNOWN,
      ),
    ).toEqual(["concept"]);
  });

  test("mention mid-sentence", () => {
    expect(
      detectInlineSkillMentions("wir könnten danach /tune-harden laufen lassen", KNOWN),
    ).toEqual(["tune-harden"]);
  });

  test("multiple mentions, deduplicated, in order of first appearance", () => {
    expect(
      detectInlineSkillMentions(
        "erst /ship, dann nochmal /ship und zum Schluss /tune-polish",
        KNOWN,
      ),
    ).toEqual(["ship", "tune-polish"]);
  });

  test("adjacent punctuation does not break detection", () => {
    expect(detectInlineSkillMentions("(siehe /fix)", KNOWN)).toEqual(["fix"]);
    expect(detectInlineSkillMentions("nutze /promote.", KNOWN)).toEqual(["promote"]);
  });

  test("a mention inside quotes or code is discussion, not an invocation", () => {
    expect(detectInlineSkillMentions('"/ship" wäre gut', KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("der Hook sagt `/concept` zuerst", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("„/fix“ steht in der Doku", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("```\n/tune-harden\n```", KNOWN)).toEqual([]);
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
        "<command-name>concept</command-name> args… /tune-harden too",
        KNOWN,
      ),
    ).toEqual([]);
  });

  test("case-insensitive, normalized to lowercase", () => {
    expect(detectInlineSkillMentions("Bitte /Ship ausführen", KNOWN)).toEqual([
      "ship",
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
    "<<autonomous-loop>> /concept",
    "AUTONOMOUS_RESUME: /tune-harden",
    "RUN_BACKLOG_AUTOSTART: /fix",
    "Silently run /ship checks",
    '<scheduled-task name="x">/concept</scheduled-task>',
  ])("%s → no mentions", (msg) => {
    expect(detectInlineSkillMentions(msg, KNOWN)).toEqual([]);
  });
});
