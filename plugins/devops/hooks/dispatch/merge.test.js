import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mergeResults } = require("./merge.js");

const r = (name, o = {}) => ({ name, code: 0, stdout: "", stderr: "", ...o });
const ctx = (event, text) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const json = (m) => JSON.parse(m.stdout);

// one test per row of the merge table in merge.js
describe("dispatcher merge table", () => {
  test("nothing written, all exit 0 → no output, exit 0", () => {
    expect(mergeResults("PreToolUse", [r("a"), r("b")])).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("exactly one module wrote/failed → its stdout, stderr and exit code verbatim", () => {
    const one = r("gate", { code: 2, stderr: "BLOCKED: no\n", stdout: "ignored" });
    expect(mergeResults("PreToolUse", [r("a"), one, r("b")])).toEqual({ code: 2, stdout: "ignored", stderr: "BLOCKED: no\n" });
    const exit1 = r("x", { code: 1, stderr: "boom\n" });
    expect(mergeResults("Stop", [exit1, r("y")])).toEqual({ code: 1, stdout: "", stderr: "boom\n" });
    const raw = '{"continue":false,"stopReason":"done"}';
    expect(mergeResults("PostToolUse", [r("a", { stdout: raw })]).stdout).toBe(raw);
  });

  test("several plain stdouts, no JSON → joined by newline, exit 0", () => {
    const m = mergeResults("UserPromptSubmit", [r("a", { stdout: "one\n" }), r("b"), r("c", { stdout: "two" })]);
    expect(m).toEqual({ code: 0, stdout: "one\ntwo\n", stderr: "" });
  });

  test("several additionalContext (+ plain on UserPromptSubmit) → one context, manifest order", () => {
    const m = mergeResults("UserPromptSubmit", [
      r("a", { stdout: ctx("UserPromptSubmit", "A") }),
      r("b", { stdout: "plain B" }),
      r("c", { stdout: ctx("UserPromptSubmit", "C") }),
    ]);
    expect(m.code).toBe(0);
    expect(json(m).hookSpecificOutput).toEqual({ hookEventName: "UserPromptSubmit", additionalContext: "A\n\nplain B\n\nC" });
    // plain stdout of PostToolUse is transcript-only and is not turned into context
    const p = mergeResults("PostToolUse", [r("a", { stdout: ctx("PostToolUse", "A") }), r("b", { stdout: "plain" })]);
    expect(json(p).hookSpecificOutput.additionalContext).toBe("A");
  });

  test("several systemMessage → joined by newline", () => {
    const m = mergeResults("Stop", [r("a", { stdout: '{"systemMessage":"x"}' }), r("b", { stdout: '{"systemMessage":"y"}' })]);
    expect(json(m)).toEqual({ systemMessage: "x\ny" });
  });

  test("any exit 2 → exit 2, every block text on stderr, JSON keeps only non-verdict fields", () => {
    const m = mergeResults("PreToolUse", [
      r("ctx", { stdout: ctx("PreToolUse", "note") }),
      r("gate1", { code: 2, stderr: "first block" }),
      r("gate2", { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "json deny" } }) }),
      r("asker", { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } }) }),
      r("msg", { stdout: '{"systemMessage":"heads up"}' }),
    ]);
    expect(m.code).toBe(2);
    expect(m.stderr).toBe("first block\n\njson deny\n");
    const out = json(m);
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput).toEqual({ hookEventName: "PreToolUse", additionalContext: "note" });
    expect(out.systemMessage).toBe("heads up");
  });

  test("exit 2 next to plain SessionStart context keeps the context as JSON", () => {
    const m = mergeResults("SessionStart", [r("a", { stdout: "ctx A" }), r("b", { code: 2, stderr: "warn" })]);
    expect(m.code).toBe(2);
    expect(m.stderr).toBe("warn\n");
    expect(json(m).hookSpecificOutput.additionalContext).toBe("ctx A");
  });

  test("JSON decision:block (no exit 2) → decision block, reasons joined", () => {
    const m = mergeResults("Stop", [
      r("a", { stdout: '{"decision":"block","reason":"card missing"}' }),
      r("b", { stdout: '{"decision":"block","reason":"handoff"}' }),
      r("c", { stdout: '{"systemMessage":"saved"}' }),
    ]);
    expect(m.code).toBe(0);
    expect(json(m)).toEqual({ decision: "block", reason: "card missing\n\nhandoff", systemMessage: "saved" });
  });

  test("PreToolUse permissionDecision mix → deny > defer > ask > allow", () => {
    const pd = (d, why, extra = {}) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d, permissionDecisionReason: why, ...extra } });
    const ask = mergeResults("PreToolUse", [r("a", { stdout: pd("allow", "ok", { updatedInput: { a: 1 } }) }), r("b", { stdout: pd("ask", "sure?", { updatedInput: { b: 2 } }) })]);
    expect(json(ask).hookSpecificOutput).toEqual({ hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "sure?", updatedInput: { b: 2 } });
    const deny = mergeResults("PreToolUse", [r("a", { stdout: pd("ask", "sure?") }), r("b", { stdout: pd("deny", "no") }), r("c", { stdout: pd("defer", "later") })]);
    expect(json(deny).hookSpecificOutput).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" });
    const defer = mergeResults("PreToolUse", [r("a", { stdout: pd("ask", "x") }), r("c", { stdout: pd("defer", "later") })]);
    expect(json(defer).hookSpecificOutput.permissionDecision).toBe("defer");
    const allow = mergeResults("PreToolUse", [r("a", { stdout: pd("allow", "a1") }), r("b", { stdout: pd("allow", "a2") })]);
    expect(json(allow).hookSpecificOutput.permissionDecisionReason).toBe("a1\n\na2");
    // a top-level decision:block in PreToolUse is a deny
    const legacy = mergeResults("PreToolUse", [r("a", { stdout: '{"decision":"block","reason":"legacy"}' }), r("b", { stdout: pd("allow", "fine") })]);
    expect(json(legacy).hookSpecificOutput).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "legacy" });
  });

  test("continue:false anywhere → continue false, stopReasons joined", () => {
    const m = mergeResults("PostToolUse", [r("a", { stdout: '{"continue":false,"stopReason":"card"}' }), r("b", { stdout: ctx("PostToolUse", "c") })]);
    expect(json(m)).toEqual({ continue: false, stopReason: "card", hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "c" } });
  });

  test("other hookSpecificOutput keys → booleans OR-ed, other values first wins", () => {
    const m = mergeResults("UserPromptSubmit", [
      r("a", { stdout: JSON.stringify({ decision: "block", reason: "noted", hookSpecificOutput: { hookEventName: "UserPromptSubmit", suppressOriginalPrompt: true, sessionTitle: "T1" } }) }),
      r("b", { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", suppressOriginalPrompt: false, sessionTitle: "T2", additionalContext: "x" } }) }),
    ]);
    const out = json(m);
    expect(out.decision).toBe("block");
    expect(out.hookSpecificOutput).toEqual({ hookEventName: "UserPromptSubmit", additionalContext: "x", suppressOriginalPrompt: true, sessionTitle: "T1" });
  });

  test("exit 1 + JSON → the JSON is merged", () => {
    const m = mergeResults("PostToolUse", [r("a", { code: 1, stdout: ctx("PostToolUse", "kept"), stderr: "warn" }), r("b", { stdout: ctx("PostToolUse", "b") })]);
    expect(m.code).toBe(0);
    expect(json(m).hookSpecificOutput.additionalContext).toBe("kept\n\nb");
    expect(m.stderr).toBe("warn\n");
  });

  test("exit 1 + plain stdout → stdout dropped, stderr kept", () => {
    const m = mergeResults("UserPromptSubmit", [r("a", { code: 1, stdout: "not context", stderr: "crash" }), r("b", { stdout: "ctx" })]);
    expect(m).toEqual({ code: 0, stdout: "ctx\n", stderr: "crash\n" });
  });

  test("timed out / skipped module → contributes nothing", () => {
    const m = mergeResults("PreToolUse", [r("slow", { timedOut: true, code: 1, stdout: "x", stderr: "y" }), r("skip", { skipped: true }), r("ok")]);
    expect(m).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("top-level decision:approve → PreToolUse allow; elsewhere kept as approve", () => {
    const pre = mergeResults("PreToolUse", [r("a", { stdout: '{"decision":"approve","reason":"fine"}' }), r("b", { stdout: ctx("PreToolUse", "c") })]);
    expect(json(pre).hookSpecificOutput.permissionDecision).toBe("allow");
    const other = mergeResults("PostToolUse", [r("a", { stdout: '{"decision":"approve"}' }), r("b", { stdout: ctx("PostToolUse", "c") })]);
    expect(json(other).decision).toBe("approve");
  });
});
