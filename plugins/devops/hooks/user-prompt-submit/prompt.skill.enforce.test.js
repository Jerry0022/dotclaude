import { describe, test, expect } from "vitest";
import { detectInlineSkillMentions } from "./prompt.skill.enforce.js";

const KNOWN = [
  "devops-run-agents",
  "devops-commit",
  "devops-concept",
  "devops-fix",
  "devops-tune-harden",
  "devops-tune-polish",
  "devops-ship",
];

describe("detectInlineSkillMentions — inline /devops-* references (#235)", () => {
  test("the incident case: command with trailing prose in one message", () => {
    expect(
      detectInlineSkillMentions(
        "/devops-concept lass uns das machen und dann direkt umsetzen",
        KNOWN,
      ),
    ).toEqual(["devops-concept"]);
  });

  test("mention mid-sentence", () => {
    expect(
      detectInlineSkillMentions("wir könnten danach /devops-tune-harden laufen lassen", KNOWN),
    ).toEqual(["devops-tune-harden"]);
  });

  test("multiple mentions, deduplicated, in order of first appearance", () => {
    expect(
      detectInlineSkillMentions(
        "erst /devops-ship, dann nochmal /devops-ship und zum Schluss /devops-tune-polish",
        KNOWN,
      ),
    ).toEqual(["devops-ship", "devops-tune-polish"]);
  });

  test("adjacent punctuation does not break detection", () => {
    expect(detectInlineSkillMentions("(siehe /devops-fix)", KNOWN)).toEqual(["devops-fix"]);
    expect(detectInlineSkillMentions("nutze /devops-commit.", KNOWN)).toEqual(["devops-commit"]);
    expect(detectInlineSkillMentions('"/devops-ship" wäre gut', KNOWN)).toEqual(["devops-ship"]);
  });

  test("unknown skill names are dropped", () => {
    expect(detectInlineSkillMentions("/devops-doesnotexist bitte", KNOWN)).toEqual([]);
  });

  test("path-like strings are not mentions (no word/path prefix before the slash)", () => {
    expect(detectInlineSkillMentions("schau in docs/devops-guide.md nach", KNOWN)).toEqual([]);
    expect(detectInlineSkillMentions("plugins/devops-ship/SKILL.md", KNOWN)).toEqual([]);
  });

  test("already-expanded slash command (<command-name> tag) is skipped entirely", () => {
    expect(
      detectInlineSkillMentions(
        "<command-name>devops-concept</command-name> args… /devops-tune-harden too",
        KNOWN,
      ),
    ).toEqual([]);
  });

  test("case-insensitive, normalized to lowercase", () => {
    expect(detectInlineSkillMentions("Bitte /Devops-Ship ausführen", KNOWN)).toEqual([
      "devops-ship",
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
