import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { issueRefs, maskNonProse } = require("./issue-refs.js");

const NONE = { track: [], ask: [] };

/** The task-chip prompt of 2026-09-26, cut to its issue numbers. */
const CHIP_PROMPT = [
  "Bug in the dotclaude devops plugin (repo: this checkout, plugin at plugins/devops/).",
  "",
  'prompt.issue.detect.js treats EVERY `#N` in a user prompt as "User explicitly referenced issue #N".',
  "",
  "Observed 2026-09-26: a prompt that described a bug and quoted four issue numbers as an EXAMPLE " +
    "(\"… got '[issue-status] Tracked issues this session: #530, #409, #431, #469'\") was treated " +
    'as work on those four issues — "In Progress" instruction on the prompt.',
  "",
  "`lib/non-user-prompt.js` (`isNonUserPrompt`) already excludes background-agent reports (#473) but not this case.",
  "",
  'Candidates: an issue number in a command-like phrase ("fix #12", "work on #12", "Issue #12", ' +
    '"mach #12", "closes #12") versus numbers inside quotes. Prefer "ask instead of assert" ' +
    '(the implicit branch path already asks "Arbeitest du an Issue #N?").',
].join("\n");

describe("issueRefs — numbers that are no reference", () => {
  test("the 2026-09-26 chip prompt tracks and asks nothing", () => {
    expect(issueRefs(CHIP_PROMPT)).toEqual(NONE);
  });

  test.each([
    ["inline code", "the hook printed `#530` again"],
    ["fenced code", "log:\n```\nfix #12\n```\nwhat now?"],
    ["an unterminated fence", "log:\n```\nfix #12"],
    ["double quotes", 'it said "fix #12" twice'],
    ["single quotes", "it said 'fix #12' twice"],
    ["German quotes", "da stand „fix #12“ drin"],
    ["curly quotes", "it said “fix #12” twice"],
    ["guillemets", "da stand »fix #12« drin"],
    ["round brackets", "reports are excluded already (#473)"],
    ["square brackets", "see [fix #12] above"],
    ["a blockquote line", "> fix #12\nwhat does this mean?"],
    ["a tagged log line", "[issue-status] Tracked issues this session: #530\nwhy?"],
    ["a timestamped log line", "2026-09-26T06:41:44Z fix #12 failed\nwhy?"],
    ["a hook output line", "UserPromptSubmit hook success: User explicitly referenced issue #530.\nwhy?"],
    ["a list of three, even behind a verb", "fix #1, #2 and #3"],
    ["a range of six, even behind a verb", "implementiere #19–#24 und ship"],
    ["a pull request", "PR #471 failed CI"],
    ["a pull request to merge", "merge #439 and #447 und ship alles!"],
    ["a pull request to merge, verb-final", "#490 bitte mergen"],
    ["a milestone", "Meilenstein #14 fertig machen"],
    ["an item of another list", "Punkt #2 bitte umsetzen"],
    ["an attempt", "DIAG 3 retry #3 try 3"],
    ["a colour, a URL fragment, a cross-repo ref", "colour #fff, page#12, owner/repo#12"],
  ])("%s", (_label, prompt) => {
    expect(issueRefs(prompt)).toEqual(NONE);
  });

  test("masking keeps the prose around the span", () => {
    expect(maskNonProse('fix "#12" now')).toMatch(/^fix .*now$/);
    expect(maskNonProse('fix "#12" now')).not.toContain("#12");
  });
});

describe("issueRefs — a request to work on the issue is tracked", () => {
  test.each([
    ["fix #12", ["12"]],
    ["Fixes #12", ["12"]],
    ["closes #12", ["12"]],
    ["please work on #12 next", ["12"]],
    ["fix the issue #12", ["12"]],
    ["arbeite an #12 weiter", ["12"]],
    ["mach Issue #12 fertig", ["12"]],
    ["kümmere dich um #12", ["12"]],
    ["kannst du #12 bitte umsetzen?", ["12"]],
    ["#12", ["12"]],
    ["Issue #12: das Dropdown flackert", ["12"]],
    ["Issue 12 bitte", ["12"]],
    ["fix #12 and #13", ["12", "13"]],
    ["fix #12-#13", ["12", "13"]],
    ["fix #12 — #40 is only the log", ["12"]],
  ])("%s", (prompt, track) => {
    expect(issueRefs(prompt)).toEqual({ track, ask: [] });
  });
});

describe("issueRefs — a number only mentioned is asked about", () => {
  test.each([
    ["Der Bug aus #12 ist zurück", ["12"]],
    ["this was fixed in #12", ["12"]],
    ["#12 und #13 sind Duplikate", ["12", "13"]],
    ["don't close it yet, #12 isn't done", ["12"]],
  ])("%s", (prompt, ask) => {
    expect(issueRefs(prompt)).toEqual({ track: [], ask });
  });

  test("three numbers only mentioned cite issues, they choose none — nothing to ask", () => {
    expect(issueRefs("since #473 we skip reports; #474 did the same, and so did #475")).toEqual(NONE);
  });
});
