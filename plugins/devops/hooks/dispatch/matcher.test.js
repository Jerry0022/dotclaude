import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { matches, queryFor, unionMatcher } = require("./matcher.js");

describe("Claude Code matcher semantics", () => {
  test("no matcher, empty or * matches everything", () => {
    for (const m of [undefined, "", "*"]) expect(matches("Bash", m)).toBe(true);
  });
  test("plain names are exact, split on |", () => {
    expect(matches("Bash", "Bash|PowerShell")).toBe(true);
    expect(matches("BashOutput", "Bash|PowerShell")).toBe(false);
    expect(matches("Agent", "Agent")).toBe(true);
    // "mcp__plugin_devops_" has only word characters → exact, matches no real tool
    expect(matches("mcp__plugin_devops_dotclaude-ship__ship_release", "mcp__plugin_devops_")).toBe(false);
  });
  test("legacy aliases: exact Task matches Agent; regex sees the legacy name too", () => {
    expect(matches("Agent", "Task")).toBe(true);
    expect(matches("Agent", "^Task$")).toBe(true);
  });
  test("anything else is an unanchored RegExp", () => {
    expect(matches("BashOutput", "Bash|PowerShell|mcp__.*github.*__(issue_write)")).toBe(true);
    expect(matches("mcp__github__issue_write", "Bash|PowerShell|mcp__.*github.*__(issue_write|create_issue)")).toBe(true);
    expect(matches("Read", "mcp__.*__merge_pull_request")).toBe(false);
  });
  test("an invalid RegExp matches nothing", () => {
    expect(matches("Bash", "Bash(")).toBe(false);
  });
  test("events without a match field match every module", () => {
    expect(queryFor("UserPromptSubmit", { tool_name: "x" })).toBeUndefined();
    expect(matches(undefined, "Bash")).toBe(true);
    expect(queryFor("PreToolUse", { tool_name: "Bash" })).toBe("Bash");
    expect(queryFor("SessionStart", { source: "resume" })).toBe("resume");
    expect(queryFor("SubagentStop", { agent_type: "core" })).toBe("core");
  });
  test("unionMatcher: omitted when any module matches all, else every matcher joined", () => {
    expect(unionMatcher(["Bash", undefined])).toBeUndefined();
    expect(unionMatcher(["Bash|PowerShell", "Edit", "Bash|PowerShell"])).toBe("Bash|PowerShell|Edit");
  });
});
