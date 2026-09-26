import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { issueRefs, maskNonProse, hashRefs } = require("./issue-refs.js");

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
    // Decided 2026-09-26: a lone bracketed number stays a citation too.
    ["a lone number in round brackets", "(#42)"],
    ["square brackets", "see [fix #12] above"],
    ["a blockquote line", "> fix #12\nwhat does this mean?"],
    ["a tagged log line", "[issue-status] Tracked issues this session: #530\nwhy?"],
    ["a timestamped log line", "2026-09-26T06:41:44Z fix #12 failed\nwhy?"],
    ["a hook output line", "UserPromptSubmit hook success: User explicitly referenced issue #530.\nwhy?"],
    ["a list of three without a work verb", "see #1, #2 and #3 for the history"],
    ["a range of six without a work verb", "die Reihe #19–#24 ist alt"],
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

// 2026-09-26: a prompt about card colours ("COLOR.watermark #7d84a8", "green
// #8fae8f") was read as issues #7 and #8 — the old `#(\d+)` stopped at the
// first letter. An all-digit colour needs the `:` and leading-zero rules.
describe("issueRefs — a hex colour is no issue", () => {
  test.each([
    "#7d84a8",
    "#8fae8f",
    "#e0a0a0",
    "&#123;",
    "color:#123abc",
    "color:#123456",
    "fill:#333",
    "#000080",
    "fix the border #007700",
    "The pipeline line keeps the dim COLOR.watermark #7d84a8; green #8fae8f, red #e0a0a0",
  ])("%s", (prompt) => {
    expect(issueRefs(prompt)).toEqual(NONE);
  });

  test("a real reference beside a colour still counts", () => {
    expect(issueRefs("fix #42 — its border is #7d84a8")).toEqual({ track: ["42"], ask: [] });
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
    ["Issue #42", ["42"]],
    ["issue 42", ["42"]],
    ["#42.", ["42"]],
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

// AUD-011 (2026-09-26): digit-only hex colours still read as issues after
// #546/#554 — "fix the #333 text colour" and "setze #999 als Rahmenfarbe"
// set #333/#999 In Progress, "color: #123456;" asked about #123456.
describe("AUD-011: a digit-only hex colour beside a colour word is no issue", () => {
  test.each([
    "fix the #333 text colour",
    "setze #999 als Rahmenfarbe",
    "color: #123456;",
    "background: #1234",
    "border-top-color: #333",
    "--accent: #12345678",
    "mach die Textfarbe #555 dunkler",
  ])("%s", (prompt) => {
    expect(issueRefs(prompt)).toEqual(NONE);
  });

  test.each([
    ["Issue 42", ["42"]],
    ["Issue #42 bitte umsetzen", ["42"]],
    ["fix #12", ["12"]],
    ["closes #540", ["540"]],
    ["fix #333", ["333"]],
    ["fix: #999 border, closes #540", ["540"]],
    ["fix #540, then set the border to #333", ["540"]],
    ["im Rahmen von #540 umsetzen", ["540"]],
  ])("%s still tracks %j", (prompt, track) => {
    expect(issueRefs(prompt)).toEqual({ track, ask: [] });
  });

  test("a colour word in the next clause does not claim the number", () => {
    expect(issueRefs("Der Bug aus #540, die Farbe passt")).toEqual({ track: [], ask: ["540"] });
  });

  test("hashRefs is the one shared reading", () => {
    expect(hashRefs("fix: #999 border, closes #540").map(r => r.n)).toEqual(["540"]);
    expect(hashRefs("#12 Card colour #7d84a8 fails AA").map(r => r.n)).toEqual(["12"]);
    expect(hashRefs(undefined)).toEqual([]);
  });
});

// Red-team R3: AUD-011's 20-character colour reach lost real 3-digit issue
// numbers. The colour word must sit right beside the value now, and a close
// keyword, work verb or issue/ticket directly before `#N` beats it.
describe("R3: a colour word nearby does not swallow a real issue number", () => {
  test.each([
    ["fix the border bug #412", ["412"]],
    ["#540 fill the TOC", ["540"]],
    ["fix #412 — background image missing", ["412"]],
    ["fix #412 – background image missing", ["412"]],
    ["fix #412 - background image missing", ["412"]],
    ["Closes #412 border radius", ["412"]],
    ["fix: #412", ["412"]],
    ["fix: #412 — border radius", ["412"]],
    ["mach Issue #412 fertig, Rahmenfarbe passt nicht", ["412"]],
    ["the background task from #412: fix it", []],
  ])("%s tracks %j", (prompt, track) => {
    expect(issueRefs(prompt).track).toEqual(track);
  });

  test("a hyphenated word before a colon is prose, not a CSS property (harden)", () => {
    for (const [text, n] of [["Follow-up: #540", "540"], ["Re-test: #1234", "1234"], ["Sub-task: #512 please", "512"]]) {
      expect(hashRefs(text).map((r) => r.n), text).toEqual([n]);
    }
    for (const text of ["border-top-color: #333", "box-shadow: #333", "text-decoration-color: #999", "--accent: #333"]) {
      expect(hashRefs(text), text).toEqual([]);
    }
  });

  test("#412 after a colon that opens prose is no colour", () => {
    expect(hashRefs("Hintergrund: siehe #412").map(r => r.n)).toEqual(["412"]);
    expect(hashRefs("background: #412 image missing").map(r => r.n)).toEqual([]);
  });

  test.each([
    "fix the #333 text colour",
    "setze #999 als Rahmenfarbe",
    "color: #123456;",
    "border-top-color: #333",
    "set the border to #333",
    "the #999 border",
  ])("AUD-011 colour still a colour: %s", (prompt) => {
    expect(hashRefs(prompt)).toEqual([]);
  });

  test("the keyword-colon boundary", () => {
    // "keyword: #N" + a colour word beside → colour; without the colon → issue.
    expect(hashRefs("fix: #999 border, closes #540").map(r => r.n)).toEqual(["540"]);
    expect(hashRefs("fix #999 border").map(r => r.n)).toEqual(["999"]);
    expect(hashRefs("fix: #999, the border").map(r => r.n)).toEqual(["999"]);
  });
});

// AUD-011 / redteam R5: a list of 3+ was dropped before the work verb was
// looked at — "fix #12, #13 and #14" and "arbeite #19–#24 ab" tracked nothing.
describe("AUD-011 R5: a list led by a work verb tracks every number", () => {
  test.each([
    ["fix #12, #13 and #14", ["12", "13", "14"]],
    ["fix #1, #2 and #3", ["1", "2", "3"]],
    ["arbeite #19–#24 ab", ["19", "20", "21", "22", "23", "24"]],
    ["implementiere #19–#24 und ship", ["19", "20", "21", "22", "23", "24"]],
  ])("%s", (prompt, track) => {
    expect(issueRefs(prompt)).toEqual({ track, ask: [] });
  });

  test("a list without a work verb stays dropped (the #546 chip case)", () => {
    expect(issueRefs("Tracked issues this session: #530, #409, #431, #469")).toEqual(NONE);
    expect(issueRefs('it printed "[issue-status] Tracked issues this session: #530, #409, #431, #469"')).toEqual(NONE);
  });
});
