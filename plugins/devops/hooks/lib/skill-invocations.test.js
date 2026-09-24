import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  invokedSkillsInTranscript,
  skillInvokedThisTurn,
  lastUserPromptText,
  normalizeSkillName,
  isPromptEntry,
  turnAssistantTexts,
} = require("./skill-invocations.js");

const line = (e) => JSON.stringify(e);
const user = (text) => line({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const toolResult = () => line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });
const skill = (name, toolName = "Skill") =>
  line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: toolName, input: { skill: name, args: "x" } }] } });

describe("invokedSkillsInTranscript", () => {
  test("collects namespaced and bare skill names from the raw JSONL", () => {
    const t = [user("a"), skill("devops:auto-concept"), user("b"), skill("auto-fix")].join("\n");
    expect([...invokedSkillsInTranscript(t)].sort()).toEqual(["auto-concept", "auto-fix"]);
  });

  test("a pre-PR-2 name also counts as its new name (session straddling the update)", () => {
    const t = [user("a"), skill("devops:ship"), user("b"), skill("fix"), skill("devops:run-backlog")].join("\n");
    const got = invokedSkillsInTranscript(t);
    for (const n of ["ship", "do-ship", "fix", "auto-fix", "run-backlog", "do-run"]) expect(got.has(n), n).toBe(true);
  });

  test("connector-namespaced Skill tool counts", () => {
    expect(invokedSkillsInTranscript(skill("devops:do-ship", "mcp__x__Skill")).has("do-ship")).toBe(true);
  });

  test("empty / non-string → empty set", () => {
    expect(invokedSkillsInTranscript("").size).toBe(0);
    expect(invokedSkillsInTranscript(null).size).toBe(0);
  });
});

describe("skillInvokedThisTurn", () => {
  const isFix = (_i, name) => name === "auto-fix";

  test("true when this turn invoked it, tool results do not end the turn", () => {
    expect(skillInvokedThisTurn([user("go"), skill("devops:auto-fix"), toolResult()].join("\n"), isFix)).toBe(true);
  });

  test("false when it ran in an earlier turn", () => {
    expect(skillInvokedThisTurn([skill("fix"), user("next")].join("\n"), isFix)).toBe(false);
  });

  test("malformed lines and a throwing predicate are tolerated", () => {
    const t = ["{bad", "null", "42", user("go"), skill("fix")].join("\n");
    expect(skillInvokedThisTurn(t, () => { throw new Error("x"); })).toBe(false);
  });
});

describe("lastUserPromptText", () => {
  test("returns the turn's opening prompt, skipping tool results and meta entries", () => {
    const meta = line({ type: "user", isMeta: true, message: { role: "user", content: "skill body" } });
    const t = [user("first"), user("Silently run poll"), skill("x"), meta, toolResult()].join("\n");
    expect(lastUserPromptText(t)).toBe("Silently run poll");
  });

  test("string content form", () => {
    expect(lastUserPromptText(line({ type: "user", message: { content: "plain" } }))).toBe("plain");
  });

  test("nothing usable → ''", () => {
    expect(lastUserPromptText("")).toBe("");
    expect(lastUserPromptText("{bad\n")).toBe("");
  });
});

describe("helpers", () => {
  test("normalizeSkillName strips the namespace and lowercases", () => {
    expect(normalizeSkillName("devops:Concept")).toBe("concept");
    expect(normalizeSkillName(5)).toBe("");
  });

  test("isPromptEntry tolerates null", () => {
    expect(isPromptEntry(null)).toBe(false);
  });
});

describe("slash-started skills (R5)", () => {
  const cmd = (name) => user(`<command-message>x</command-message>\n<command-name>${name}</command-name>\n<command-args>go</command-args>`);
  const cmdString = (name) => line({ type: "user", message: { role: "user", content: `<command-name>${name}</command-name>` } });

  test.each([
    ["/devops:auto-concept", "auto-concept"],
    ["/auto-concept", "auto-concept"],
    ["devops:tune-rethink", "do-run"],
    ["/fix", "auto-fix"],
    ["/devops:ship", "do-ship"],
  ])("invokedSkillsInTranscript collects <command-name>%s</command-name>", (raw, name) => {
    expect(invokedSkillsInTranscript([cmd(raw), user("later")].join("\n")).has(name)).toBe(true);
    expect(invokedSkillsInTranscript(cmdString(raw)).has(name)).toBe(true);
  });

  test("skillInvokedThisTurn counts a slash command that opened the turn", () => {
    const isIssue = (_i, name) => name === "auto-issue";
    expect(skillInvokedThisTurn([cmd("/devops:auto-issue"), toolResult()].join("\n"), isIssue)).toBe(true);
    expect(skillInvokedThisTurn([cmd("/auto-issue")].join("\n"), isIssue)).toBe(true);
  });

  test("… but not one from an earlier turn", () => {
    const isIssue = (_i, name) => name === "auto-issue";
    expect(skillInvokedThisTurn([cmd("/devops:auto-issue"), user("next")].join("\n"), isIssue)).toBe(false);
  });

  test("the predicate receives the raw name as input.skill", () => {
    let seen = null;
    skillInvokedThisTurn(cmd("/devops:auto-guide"), (input) => { seen = input; return false; });
    expect(seen).toEqual({ skill: "devops:auto-guide" });
  });
});

describe("turnAssistantTexts (R8)", () => {
  const say = (text) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });

  test("every assistant text entry of the current turn, oldest first", () => {
    const t = [user("old"), say("old answer"), user("go"), say("a"), skill("x"), toolResult(), say("b")].join("\n");
    expect(turnAssistantTexts(t)).toEqual(["a", "b"]);
  });

  test("tool-only entries and meta entries do not end or pollute the turn", () => {
    const meta = line({ type: "user", isMeta: true, message: { role: "user", content: "skill body" } });
    const t = [user("go"), say("a"), meta, say("b")].join("\n");
    expect(turnAssistantTexts(t)).toEqual(["a", "b"]);
  });

  test("empty / garbage → []", () => {
    expect(turnAssistantTexts("")).toEqual([]);
    expect(turnAssistantTexts("{bad\nnull\n")).toEqual([]);
  });
});
