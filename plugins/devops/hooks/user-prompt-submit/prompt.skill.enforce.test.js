import { describe, test, expect } from "vitest";
import { detectInlineSkillMentions } from "./prompt.skill.enforce.js";

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
