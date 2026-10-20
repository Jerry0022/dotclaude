import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isQuestion, turnAnswerState, shouldAskForAnswer, buildAnswerMissingReason } = require("./card-guard-answer.js");

// #757 safety net: only a card-less turn whose question got no visible answer.
const jsonl = (...entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
const user = (content) => ({ type: "user", message: { role: "user", content } });
const asst = (...content) => ({ type: "assistant", message: { role: "assistant", content } });
const text = (t) => ({ type: "text", text: t });
const tool = (name = "Bash") => ({ type: "tool_use", id: "t1", name, input: {} });
const result = () => user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]);

describe("isQuestion", () => {
  test.each(["Warum blockt der Hook?", "wie geht das", "What is X", "Ist das so? Danke"])("%s → question", (q) => {
    expect(isQuestion(q)).toBe(true);
  });
  test.each([
    "Erkläre mir den Hook", "erklär mir das", "bitte erklären wie das geht", "Zeig mir den Ablauf",
    "Explain the flow", "please show me the diff", "Walk me through the pipeline", "ERKLÄR das",
  ])("%s → explanation request counts as question", (q) => {
    expect(isQuestion(q)).toBe(true);
  });
  test.each(["Die Erklärung steht im Doc", "unexplained errors", "showmeta", "run `explain` now", "Fix den Bug"])(
    "%s → no explanation request", (q) => {
      expect(isQuestion(q)).toBe(false);
    });
  test.each(["Fix den Bug", "Do the ship", "Ist erledigt", "run `a?b`", "", "<task-notification>x?</task-notification>"])("%s → no question", (q) => {
    expect(isQuestion(q)).toBe(false);
  });
});

describe("turnAnswerState", () => {
  test("answer text after the last tool call → not missing", () => {
    const t = jsonl(user("Warum?"), asst(tool()), result(), asst(text("Weil X.")));
    expect(turnAnswerState(t)).toEqual({ question: true, answerMissing: false });
  });
  test("text only BEFORE a further tool call → missing", () => {
    const t = jsonl(user("Warum?"), asst(text("Weil X.")), asst(tool()), result());
    expect(turnAnswerState(t).answerMissing).toBe(true);
  });
  test("empty final text → missing; thinking blocks are skipped", () => {
    expect(turnAnswerState(jsonl(user("Warum?"), asst(text("  ")))).answerMissing).toBe(true);
    const t = jsonl(user("Warum?"), asst(text("Weil X.")), asst({ type: "thinking", thinking: "…" }));
    expect(turnAnswerState(t).answerMissing).toBe(false);
  });
  test("an earlier turn's answer does not count for this one", () => {
    const t = jsonl(user("a?"), asst(text("A.")), user("Warum b?"), asst(tool()), result());
    expect(turnAnswerState(t)).toEqual({ question: true, answerMissing: true });
  });
  test("prompt outside the tail / no transcript → never blocks", () => {
    expect(turnAnswerState(jsonl(asst(tool()), result()))).toEqual({ question: false, answerMissing: false });
    expect(turnAnswerState("")).toEqual({ question: false, answerMissing: false });
  });
});

describe("shouldAskForAnswer", () => {
  const lost = jsonl(user("Warum blockt das?"), asst(text("Weil X.")), asst(tool()), result());
  const base = { cardRendered: false, stopHookActive: false, alreadyAsked: false, transcript: lost };
  test("card-less turn with a lost answer → ask once", () => {
    expect(shouldAskForAnswer(base)).toBe(true);
  });
  test("never with a card, a retry stop, an earlier ask, silent or exempt turns", () => {
    expect(shouldAskForAnswer({ ...base, cardRendered: true })).toBe(false);
    expect(shouldAskForAnswer({ ...base, stopHookActive: true })).toBe(false);
    expect(shouldAskForAnswer({ ...base, alreadyAsked: true })).toBe(false);
    expect(shouldAskForAnswer({ ...base, silent: true })).toBe(false);
    expect(shouldAskForAnswer({ ...base, exempt: true })).toBe(false);
  });
  test("no question → no ask", () => {
    const t = jsonl(user("Fix den Bug"), asst(tool()), result());
    expect(shouldAskForAnswer({ ...base, transcript: t })).toBe(false);
  });
  test("reason asks for plain text, no card", () => {
    expect(buildAnswerMissingReason()).toMatch(/plain text/);
  });
});
