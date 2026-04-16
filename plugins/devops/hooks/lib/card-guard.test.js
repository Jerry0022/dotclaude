import { describe, test, expect } from "vitest";
import {
  lastAssistantText,
  lastAssistantTextLength,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  decideAction,
  buildBlockReason,
  SUBSTANTIAL_CHARS,
  CARD_MARKER,
} from "./card-guard.js";

// ---------------------------------------------------------------------------
// Helpers — build JSONL transcript fragments
// ---------------------------------------------------------------------------

function jsonl(...entries) {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

function assistantMsg(...blocks) {
  return {
    type: "assistant",
    message: { role: "assistant", content: blocks },
  };
}

function userMsg(text) {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

// ---------------------------------------------------------------------------
// lastAssistantTextLength
// ---------------------------------------------------------------------------

describe("lastAssistantTextLength", () => {
  test("returns 0 for empty / missing input", () => {
    expect(lastAssistantTextLength("")).toBe(0);
    expect(lastAssistantTextLength(null)).toBe(0);
    expect(lastAssistantTextLength(undefined)).toBe(0);
  });

  test("counts chars of text blocks in last assistant message", () => {
    const tx = jsonl(
      userMsg("hi"),
      assistantMsg({ type: "text", text: "hello world" }),
    );
    expect(lastAssistantTextLength(tx)).toBe("hello world".length);
  });

  test("ignores tool_use and tool_result blocks — text only", () => {
    const tx = jsonl(
      assistantMsg(
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
        { type: "text", text: "short answer" },
      ),
    );
    expect(lastAssistantTextLength(tx)).toBe("short answer".length);
  });

  test("sums multiple text blocks in the same message", () => {
    const tx = jsonl(
      assistantMsg(
        { type: "text", text: "alpha" },
        { type: "tool_use", id: "t1", name: "Read", input: {} },
        { type: "text", text: "beta" },
      ),
    );
    expect(lastAssistantTextLength(tx)).toBe("alphabeta".length);
  });

  test("picks the LAST assistant message, not earlier ones", () => {
    const tx = jsonl(
      assistantMsg({ type: "text", text: "first answer long text" }),
      userMsg("follow-up"),
      assistantMsg({ type: "text", text: "ok" }),
    );
    expect(lastAssistantTextLength(tx)).toBe(2);
  });

  test("skips malformed lines without throwing", () => {
    const tx = [
      "not json at all",
      JSON.stringify(userMsg("hi")),
      "{broken",
      JSON.stringify(assistantMsg({ type: "text", text: "valid" })),
    ].join("\n");
    expect(lastAssistantTextLength(tx)).toBe("valid".length);
  });

  test("handles assistant with no text blocks (tool-only turn)", () => {
    const tx = jsonl(
      assistantMsg({ type: "tool_use", id: "t1", name: "Bash", input: {} }),
    );
    expect(lastAssistantTextLength(tx)).toBe(0);
  });

  test("handles assistant with missing content array", () => {
    const tx = JSON.stringify({ type: "assistant", message: {} });
    expect(lastAssistantTextLength(tx)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isSubstantialAnswer
// ---------------------------------------------------------------------------

describe("isSubstantialAnswer", () => {
  test("short answer below threshold → false", () => {
    const tx = jsonl(assistantMsg({ type: "text", text: "kurz" }));
    expect(isSubstantialAnswer(tx)).toBe(false);
  });

  test("answer at/above threshold → true", () => {
    const big = "x".repeat(SUBSTANTIAL_CHARS);
    const tx = jsonl(assistantMsg({ type: "text", text: big }));
    expect(isSubstantialAnswer(tx)).toBe(true);
  });

  test("threshold is configurable", () => {
    const tx = jsonl(assistantMsg({ type: "text", text: "ten chars!" }));
    expect(isSubstantialAnswer(tx, 5)).toBe(true);
    expect(isSubstantialAnswer(tx, 50)).toBe(false);
  });

  test("empty transcript → false", () => {
    expect(isSubstantialAnswer("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideAction — decision matrix
// ---------------------------------------------------------------------------

describe("decideAction", () => {
  test("stop_hook_active short-circuits — always pass, reset flags", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: true,
      substantial: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("work happened + card rendered → pass, reset", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("work happened + no card → BLOCK, keep flags", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
    });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/render_completion_card/);
    expect(d.reason).toMatch(/VERBATIM/);
  });

  test("substantial prose + no card + no work → BLOCK", () => {
    const d = decideAction({
      workHappened: false,
      cardRendered: false,
      stopHookActive: false,
      substantial: true,
    });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
  });

  test("trivial chat only + no card + no work → pass", () => {
    const d = decideAction({
      workHappened: false,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("card already rendered short-circuits regardless of substantial", () => {
    const d = decideAction({
      workHappened: false,
      cardRendered: true,
      stopHookActive: false,
      substantial: true,
    });
    expect(d.action).toBe("pass");
  });

  test("loop-break: second fire (stop_hook_active) even with missing card", () => {
    // Defensive — if card flag somehow failed to write after Claude rendered,
    // we must not loop forever. stop_hook_active=true always passes.
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: true,
      substantial: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lastAssistantContainsCard — backup detection via card marker
// ---------------------------------------------------------------------------

describe("lastAssistantContainsCard", () => {
  test("returns true when last assistant text contains ✨✨✨ marker", () => {
    const tx = jsonl(
      assistantMsg({ type: "text", text: `## ${CARD_MARKER} Task done ${CARD_MARKER}` }),
    );
    expect(lastAssistantContainsCard(tx)).toBe(true);
  });

  test("returns false when no marker present", () => {
    const tx = jsonl(assistantMsg({ type: "text", text: "plain answer" }));
    expect(lastAssistantContainsCard(tx)).toBe(false);
  });

  test("returns false when marker is in an EARLIER assistant message", () => {
    const tx = jsonl(
      assistantMsg({ type: "text", text: `## ${CARD_MARKER} old card ${CARD_MARKER}` }),
      userMsg("follow-up"),
      assistantMsg({ type: "text", text: "new answer without card" }),
    );
    expect(lastAssistantContainsCard(tx)).toBe(false);
  });

  test("returns false for empty / missing transcript", () => {
    expect(lastAssistantContainsCard("")).toBe(false);
    expect(lastAssistantContainsCard(null)).toBe(false);
  });

  test("handles tool_use blocks + text with marker", () => {
    const tx = jsonl(
      assistantMsg(
        { type: "tool_use", id: "t1", name: "Bash", input: {} },
        { type: "text", text: `## ${CARD_MARKER} done ${CARD_MARKER}` },
      ),
    );
    expect(lastAssistantContainsCard(tx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lastAssistantText — concatenated text extraction
// ---------------------------------------------------------------------------

describe("lastAssistantText", () => {
  test("concatenates multiple text blocks", () => {
    const tx = jsonl(
      assistantMsg(
        { type: "text", text: "alpha" },
        { type: "text", text: "beta" },
      ),
    );
    expect(lastAssistantText(tx)).toBe("alphabeta");
  });

  test("returns '' when no assistant message", () => {
    const tx = jsonl(userMsg("just a user turn"));
    expect(lastAssistantText(tx)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildBlockReason — output contract
// ---------------------------------------------------------------------------

describe("buildBlockReason", () => {
  test("contains the MCP tool name and variant decision tree", () => {
    const r = buildBlockReason();
    expect(r).toMatch(/mcp__plugin_devops_dotclaude-completion__render_completion_card/);
    expect(r).toMatch(/ship-successful/);
    expect(r).toMatch(/ship-blocked/);
    expect(r).toMatch(/aborted/);
    expect(r).toMatch(/test-minimal/);
    expect(r).toMatch(/analysis/);
    expect(r).toMatch(/fallback/);
  });

  test("instructs VERBATIM relay of the tool result", () => {
    const r = buildBlockReason();
    expect(r).toMatch(/VERBATIM/);
    expect(r).toMatch(/LAST/);
  });
});
