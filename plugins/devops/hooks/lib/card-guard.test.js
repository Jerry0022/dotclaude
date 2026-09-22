import { describe, test, expect } from "vitest";
import {
  lastAssistantText,
  lastAssistantTextLength,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  lastUserEntryIsNotification,
  decideAction,
  buildBlockReason,
  buildValidationReason,
  buildPendingReason,
  buildTitleStatusWordReason,
  buildResultLinesReason,
  buildPointsReason,
  buildDuplicateCardReason,
  extractCardTitle,
  titleStatusWordViolation,
  extractResultLines,
  resultLinesViolation,
  extractPoints,
  pointsViolation,
  cardLineCount,
  lineBudgetReport,
  cardSignature,
  isDuplicateNotificationCard,
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

  test("silent turn → pass + reset, regardless of work/card/substantial", () => {
    // Background ticks (cron git-sync, concept bridge poll, autonomous loop)
    // must never force a second card. Reset flags so the next real turn
    // starts from a clean slate.
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: false,
      substantial: true,
      silent: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("silent turn short-circuits before stop_hook_active check", () => {
    // Even if stop_hook_active somehow flips, silent should take precedence
    // and still pass cleanly.
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: true,
      substantial: false,
      silent: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decideAction — relay gate (#449): rendered is not the same as shown
// ---------------------------------------------------------------------------

describe("decideAction — relay gate", () => {
  const base = { workHappened: true, stopHookActive: false, substantial: false };

  test("flag set + marker in the last answer → pass", () => {
    const d = decideAction({ ...base, cardRendered: true, cardRelayed: true });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("flag set + marker missing → BLOCK with the never-relayed reason, keep flags", () => {
    const d = decideAction({ ...base, cardRendered: true, cardRelayed: false });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/never relayed/);
    expect(d.reason).toMatch(/VERBATIM/);
    expect(d.reason).toMatch(/LAST/);
  });

  test("transcript unreadable (cardRelayed undefined) → the flag alone passes", () => {
    const d = decideAction({ ...base, cardRendered: true });
    expect(d.action).toBe("pass");
  });

  test("stop_hook_active yields even when the card was never relayed", () => {
    const d = decideAction({ ...base, cardRendered: true, cardRelayed: false, stopHookActive: true });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("relay gate runs before the content gates", () => {
    const d = decideAction({
      ...base, cardRendered: true, cardRelayed: false,
      cardText: `### **${CARD_MARKER} Agents running ${CARD_MARKER}**`,
    });
    expect(d.reason).toMatch(/never relayed/);
  });

  test("a card rendered twice passes as long as the last answer carries a marker", () => {
    // The guard never compares payloads — the second render's markdown is the
    // one relayed, and its marker is all Gate 1b asks for.
    const transcript = jsonl(
      assistantMsg({ type: "tool_use", name: "mcp__plugin_devops_dotclaude-completion__render_completion_card", input: {} }),
      assistantMsg({ type: "tool_use", name: "mcp__plugin_devops_dotclaude-completion__render_completion_card", input: {} }),
      assistantMsg({ type: "text", text: `<!-- ${CARD_MARKER} Shipped v2 ${CARD_MARKER} -->` }),
    );
    const d = decideAction({ ...base, cardRendered: true, cardRelayed: lastAssistantContainsCard(transcript) });
    expect(d.action).toBe("pass");
  });

  test("render followed by a tool call and no relay → marker missing → BLOCK", () => {
    const transcript = jsonl(
      assistantMsg({ type: "tool_use", name: "mcp__plugin_devops_dotclaude-completion__render_completion_card", input: {} }),
      assistantMsg({ type: "tool_use", name: "mcp__plugin_devops_dotclaude-ship__ship_release", input: {} }),
      assistantMsg({ type: "text", text: "Released." }),
    );
    const d = decideAction({ ...base, cardRendered: true, cardRelayed: lastAssistantContainsCard(transcript) });
    expect(d.action).toBe("block");
  });
});

// ---------------------------------------------------------------------------
// decideAction — validation gate (V&V)
// ---------------------------------------------------------------------------

describe("decideAction — validation gate", () => {
  test("card rendered + validation pending + not attested → BLOCK (validation)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      validationPending: true,
      validationAttested: false,
    });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/Validation required/);
    expect(d.reason).toMatch(/validation/);
  });

  test("card rendered + validation pending + attested → pass", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      validationPending: true,
      validationAttested: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("no card yet → card gate wins over validation gate", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
      validationPending: true,
      validationAttested: false,
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/render_completion_card/);
    expect(d.reason).not.toMatch(/Validation required/);
  });

  test("validation pending but no active work/prose → pass (no spurious block)", () => {
    const d = decideAction({
      workHappened: false,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      validationPending: true,
      validationAttested: false,
    });
    expect(d.action).toBe("pass");
  });

  test("stop_hook_active yields the validation gate too (one-block, never wedge)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: true,
      substantial: false,
      validationPending: true,
      validationAttested: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("no validation pending → card-rendered turn passes (back-compat)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
    });
    expect(d.action).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// decideAction — pending gate (background work still running at turn end)
// ---------------------------------------------------------------------------

describe("decideAction — pending gate", () => {
  test("card rendered + open background work + not attested → BLOCK (pending)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      openTaskNames: ["devops:frontend"],
      pendingAttested: false,
    });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/STILL RUNNING/);
    expect(d.reason).toMatch(/devops:frontend/);
  });

  test("card rendered + open background work + attested → pass", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      openTaskNames: ["devops:frontend"],
      pendingAttested: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("nothing open → a card-rendered turn passes (back-compat)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      openTaskNames: [],
      pendingAttested: false,
    });
    expect(d.action).toBe("pass");
  });

  test("no card yet → card gate wins over pending gate", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
      openTaskNames: ["devops:qa"],
      pendingAttested: false,
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/render_completion_card/);
    expect(d.reason).not.toMatch(/STILL RUNNING/);
  });

  test("validation gate is checked before the pending gate", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      validationPending: true,
      validationAttested: false,
      openTaskNames: ["devops:qa"],
      pendingAttested: false,
    });
    expect(d.reason).toMatch(/Validation required/);
  });

  test("fires without other work — launching an agent is itself the work", () => {
    const d = decideAction({
      workHappened: false,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      openTaskNames: ["devops:qa"],
      pendingAttested: false,
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/STILL RUNNING/);
  });

  test("stop_hook_active yields the pending gate too (one-block, never wedge)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: true,
      substantial: false,
      openTaskNames: ["devops:qa"],
      pendingAttested: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("a silent turn never fires the pending gate", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      silent: true,
      openTaskNames: ["devops:qa"],
      pendingAttested: false,
    });
    expect(d.action).toBe("pass");
  });
});

describe("buildPendingReason", () => {
  test("names each open item and the pending field", () => {
    const r = buildPendingReason(["devops:frontend", "npm test"]);
    expect(r).toMatch(/devops:frontend/);
    expect(r).toMatch(/npm test/);
    expect(r).toMatch(/pending/);
    expect(r).toMatch(/render_completion_card/);
    expect(r).toMatch(/VERBATIM|LAST/);
  });

  test("forbids putting an internal agentId in the card", () => {
    expect(buildPendingReason(["devops:qa"])).toMatch(/NEVER put an internal agentId/);
  });

  test("tells the model not to fake pending to get past the gate", () => {
    expect(buildPendingReason(["devops:qa"])).toMatch(/do not declare it pending/);
  });
});

describe("buildValidationReason", () => {
  test("names the validation field and the re-render instruction", () => {
    const r = buildValidationReason();
    expect(r).toMatch(/validation/);
    expect(r).toMatch(/render_completion_card/);
    expect(r).toMatch(/met.*partial.*unmet|requirement/);
    expect(r).toMatch(/VERBATIM|LAST/);
  });
});

// ---------------------------------------------------------------------------
// lastAssistantContainsCard — backup detection via card marker
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Card content gates (design § 5.1 - § 5.4)
// ---------------------------------------------------------------------------

function sampleCard({ title = "Filter dialog moved to settings", resultLines = [
  "› Settings now has a Filter tab with drag & drop",
  "› Old dialog route still works",
], heading = "## 📦 Shippen?", points = [] } = {}) {
  return [
    `### **${CARD_MARKER} ${title} ${CARD_MARKER}**`,
    ...resultLines,
    "✓ 3/3 Anforderungen  ✓ 47 Tests grün  ✓ 4 Live-Checks ok",
    "5h ▰▰▰▰▰▰▰│▱▱▱▱▱▱ 3 h 12 m",
    "✓ commit → ✓ push → ✓ PR #42 → ✓ merge   main · v0.8.3 · Build a3f9b21",
    heading,
    ...points,
  ].join("\n");
}

describe("extractCardTitle", () => {
  test("extracts the title between the two markers", () => {
    expect(extractCardTitle(sampleCard())).toBe("Filter dialog moved to settings");
  });

  test("returns null when no card marker present", () => {
    expect(extractCardTitle("plain text")).toBeNull();
  });

  test("returns null for empty/missing input", () => {
    expect(extractCardTitle("")).toBeNull();
    expect(extractCardTitle(null)).toBeNull();
  });
});

describe("titleStatusWordViolation", () => {
  test.each([
    ["3 agents running", "3 agents"],
    ["Agenten laufen noch", "laufen"],
    ["wartet auf Antwort", "wartet"],
    ["still pending", "pending"],
    ["noch nicht fertig", "noch nicht"],
    ["3 Agenten arbeiten", "3 Agenten"],
  ])("flags status word in %s", (title, expected) => {
    expect(titleStatusWordViolation(title)).toBe(expected);
  });

  test("clean outcome title passes", () => {
    expect(titleStatusWordViolation("Filter dialog moved to settings")).toBeNull();
  });

  test("null/empty title passes", () => {
    expect(titleStatusWordViolation(null)).toBeNull();
    expect(titleStatusWordViolation("")).toBeNull();
  });
});

describe("extractResultLines / resultLinesViolation", () => {
  test("extracts each › line, marker stripped", () => {
    const lines = extractResultLines(sampleCard());
    expect(lines).toEqual([
      "Settings now has a Filter tab with drag & drop",
      "Old dialog route still works",
    ]);
  });

  test("no lines → empty array, no violation", () => {
    expect(extractResultLines("no markers here")).toEqual([]);
    expect(resultLinesViolation([])).toBeNull();
  });

  test("more than 3 result lines → violation", () => {
    const v = resultLinesViolation(["a", "b", "c", "d"]);
    expect(v).toMatch(/4 result lines/);
    expect(v).toMatch(/max 3/);
  });

  test("a line whose first token is a file path → violation", () => {
    const v = resultLinesViolation(["mcp-server/index.js → refactored"]);
    expect(v).toMatch(/file\/hook/);
  });

  test("a line whose first token is a hook-name prefix → violation", () => {
    expect(resultLinesViolation(["stop.flow.guard now blocks duplicates"])).toMatch(/file\/hook/);
    expect(resultLinesViolation(["post.flow.completion updated"])).toMatch(/file\/hook/);
    expect(resultLinesViolation(["prompt.flow.title-work sets the icon"])).toMatch(/file\/hook/);
    expect(resultLinesViolation(["ss.tokens.scan runs first"])).toMatch(/file\/hook/);
  });

  test("a user-facing effect line passes", () => {
    expect(resultLinesViolation(["Settings now has a Filter tab"])).toBeNull();
  });

  test("code span at the END of a line is fine (design § 2.2)", () => {
    expect(resultLinesViolation(["The flag now steht as `stale`"])).toBeNull();
  });
});

describe("extractPoints / pointsViolation", () => {
  test("extracts numbered points after the decision heading", () => {
    const card = sampleCard({ points: ["1. first step", "2. second step"] });
    expect(extractPoints(card)).toEqual(["1. first step", "2. second step"]);
  });

  test("no heading, no points → empty array", () => {
    expect(extractPoints("no heading here")).toEqual([]);
  });

  test("≤ 3 points → no violation", () => {
    expect(pointsViolation(["1. a", "2. b", "3. c"], "## 📦 Shippen?")).toBeNull();
  });

  test("> 3 points without '+N weitere' in heading → violation", () => {
    const v = pointsViolation(["1. a", "2. b", "3. c", "4. d"], "## 📦 Shippen?");
    expect(v).toMatch(/4 points/);
    expect(v).toMatch(/max 3/);
  });

  test("> 3 points WITH '+N weitere' in heading → no violation", () => {
    expect(
      pointsViolation(["1. a", "2. b", "3. c", "4. d"], "## 📦 Shippen? +1 weitere"),
    ).toBeNull();
  });
});

describe("cardLineCount / lineBudgetReport", () => {
  test("counts non-blank lines only", () => {
    expect(cardLineCount("a\n\nb\n \nc")).toBe(3);
  });

  test("empty input → 0", () => {
    expect(cardLineCount("")).toBe(0);
    expect(cardLineCount(null)).toBe(0);
  });

  test("terminal default budget is 24 rows", () => {
    const r = lineBudgetReport(sampleCard());
    expect(r.limit).toBe(24);
    expect(r.overflow).toBe(false);
  });

  test("desktop budget is 14 rows and flags overflow past it", () => {
    const bigCard = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const r = lineBudgetReport(bigCard, { desktop: true });
    expect(r.limit).toBe(14);
    expect(r.count).toBe(20);
    expect(r.overflow).toBe(true);
  });
});

describe("cardSignature / isDuplicateNotificationCard", () => {
  test("same heading + build-id + evidence → same signature", () => {
    const a = cardSignature(sampleCard());
    const b = cardSignature(sampleCard());
    expect(a).toBe(b);
    expect(isDuplicateNotificationCard(a, b)).toBe(true);
  });

  test("different heading → different signature", () => {
    const a = cardSignature(sampleCard());
    const b = cardSignature(sampleCard({ heading: "## ⏳ Noch nicht fertig — warte" }));
    expect(a).not.toBe(b);
    expect(isDuplicateNotificationCard(a, b)).toBe(false);
  });

  test("no prior signature → never a duplicate", () => {
    expect(isDuplicateNotificationCard(null, cardSignature(sampleCard()))).toBe(false);
  });

  test("card text with none of the tracked fields → null signature", () => {
    expect(cardSignature("plain prose, no card")).toBeNull();
  });

  // Desktop (§ 4): the markdown is the ✨ title line alone, the body lives in
  // the widget — the title is then the field to compare on.
  test("a Desktop title-only card signs on its title", () => {
    const a = cardSignature(`&nbsp;\n\n---\n\n### **${CARD_MARKER} Sanduhr nur Fallback ${CARD_MARKER}**\n\n---`);
    const b = cardSignature(`&nbsp;\n\n---\n\n### **${CARD_MARKER} Sanduhr nur Fallback ${CARD_MARKER}**\n\n---`);
    const c = cardSignature(`&nbsp;\n\n---\n\n### **${CARD_MARKER} Etwas anderes ${CARD_MARKER}**\n\n---`);
    expect(a).toBe(JSON.stringify({ title: "Sanduhr nur Fallback" }));
    expect(isDuplicateNotificationCard(a, b)).toBe(true);
    // #443: the Desktop marker is an HTML comment now — same signature, same
    // duplicate verdict, and identical to the older visible title line.
    const d = cardSignature(`<!-- ${CARD_MARKER} Sanduhr nur Fallback ${CARD_MARKER} -->`);
    expect(d).toBe(JSON.stringify({ title: "Sanduhr nur Fallback" }));
    expect(isDuplicateNotificationCard(a, d)).toBe(true);
    expect(isDuplicateNotificationCard(d, cardSignature(`<!-- ${CARD_MARKER} Etwas anderes ${CARD_MARKER} -->`))).toBe(false);
    expect(isDuplicateNotificationCard(a, c)).toBe(false);
  });
});

describe("lastUserEntryIsNotification", () => {
  test("true when the last user entry carries <task-notification>", () => {
    const tx = jsonl(
      assistantMsg({ type: "text", text: "earlier turn" }),
      { type: "user", message: { role: "user", content: "<task-notification><task-id>1</task-id></task-notification>" } },
    );
    expect(lastUserEntryIsNotification(tx)).toBe(true);
  });

  test("false for an ordinary user prompt", () => {
    const tx = jsonl(userMsg("please fix the bug"));
    expect(lastUserEntryIsNotification(tx)).toBe(false);
  });

  test("false for empty/missing transcript", () => {
    expect(lastUserEntryIsNotification("")).toBe(false);
    expect(lastUserEntryIsNotification(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideAction — card content gates (design § 5.1 - § 5.3)
// ---------------------------------------------------------------------------

describe("decideAction — card content gates", () => {
  test("title status word → BLOCK once", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard({ title: "Agents still running" }),
    });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/status word/);
    expect(d.reason).toMatch(/running/);
  });

  test("too many result lines → BLOCK once", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard({ resultLines: ["› a", "› b", "› c", "› d"] }),
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/Result lines/);
  });

  test("result line naming a file as subject → BLOCK once", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard({ resultLines: ["› budget.js → Refresh-Zyklus"] }),
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/file\/hook/);
  });

  test("too many points without '+N weitere' → BLOCK once", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard({ points: ["1. a", "2. b", "3. c", "4. d"] }),
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/Decision points/);
  });

  test("clean card passes with no cardText-driven block", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard(),
    });
    expect(d.action).toBe("pass");
  });

  test("no cardText provided → content gates skipped (back-compat)", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
    });
    expect(d.action).toBe("pass");
  });

  test("content gate is checked before the validation gate", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard({ title: "still pending" }),
      validationPending: true,
      validationAttested: false,
    });
    expect(d.reason).toMatch(/status word/);
  });

  test("stop_hook_active yields the content gate too", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: true,
      substantial: false,
      cardText: sampleCard({ title: "still pending" }),
    });
    expect(d.action).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// decideAction — notification-turn exemption + duplicate gate (design § 5.5)
// ---------------------------------------------------------------------------

describe("decideAction — notification turn", () => {
  test("no card obligation when nothing changed", () => {
    const d = decideAction({
      workHappened: false,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
      notificationTurn: true,
      treeClean: true,
      shipped: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
    expect(d.exempt).toBe("notification-no-change");
  });

  test("something shipped on a notification turn still owes the card gate", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
      notificationTurn: true,
      treeClean: false,
      shipped: true,
    });
    expect(d.action).toBe("block");
  });

  test("second identical card on a notification turn → BLOCK once", () => {
    const card = sampleCard();
    const prevSig = cardSignature(card);
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      notificationTurn: true,
      cardText: card,
      prevCardSignature: prevSig,
    });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/Duplicate card/);
  });

  test("a DIFFERENT card on a notification turn passes and reports its new signature", () => {
    const prevSig = cardSignature(sampleCard({ heading: "## ⏳ Noch nicht fertig" }));
    const card = sampleCard();
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      notificationTurn: true,
      cardText: card,
      prevCardSignature: prevSig,
    });
    expect(d.action).toBe("pass");
    expect(d.newCardSignature).toBe(cardSignature(card));
  });

  test("not a notification turn → duplicate gate never fires", () => {
    const card = sampleCard();
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      notificationTurn: false,
      cardText: card,
      prevCardSignature: cardSignature(card),
    });
    expect(d.action).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// decideAction — line-budget report (design § 2.4 / § 5.4)
// ---------------------------------------------------------------------------

describe("decideAction — line-budget report", () => {
  test("overflow is reported as a warning on an otherwise passing turn, never blocks", () => {
    const bigCard = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: bigCard,
    });
    expect(d.action).toBe("pass");
    expect(d.warning).toMatch(/30 lines/);
    expect(d.warning).toMatch(/budget is 24/);
  });

  test("under budget → no warning", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: true,
      stopHookActive: false,
      substantial: false,
      cardText: sampleCard(),
    });
    expect(d.warning).toBeUndefined();
  });
});

describe("buildTitleStatusWordReason / buildResultLinesReason / buildPointsReason / buildDuplicateCardReason", () => {
  test("title reason names the offending word and the re-render instruction", () => {
    const r = buildTitleStatusWordReason("running");
    expect(r).toMatch(/running/);
    expect(r).toMatch(/render_completion_card/);
    expect(r).toMatch(/VERBATIM/);
  });

  test("result-lines reason carries the detail and re-render instruction", () => {
    const r = buildResultLinesReason("4 result lines — max 3");
    expect(r).toMatch(/4 result lines/);
    expect(r).toMatch(/render_completion_card/);
  });

  test("points reason carries the detail and re-render instruction", () => {
    const r = buildPointsReason("4 points — max 3");
    expect(r).toMatch(/4 points/);
    expect(r).toMatch(/render_completion_card/);
  });

  test("duplicate-card reason explains the notification-turn silence rule", () => {
    const r = buildDuplicateCardReason();
    expect(r).toMatch(/notification turn/);
    expect(r).toMatch(/nothing changed/);
  });
});

describe("lastAssistantContainsCard", () => {
  test("returns true when last assistant text contains ✨✨✨ marker", () => {
    const tx = jsonl(
      assistantMsg({ type: "text", text: `## ${CARD_MARKER} Task done ${CARD_MARKER}` }),
    );
    expect(lastAssistantContainsCard(tx)).toBe(true);
  });

  // #443: on Desktop the card markdown is the marker inside an HTML comment —
  // invisible in the rendered turn, present in the transcript the hook reads.
  test("returns true for the Desktop marker comment, and the title is still extracted", () => {
    const text = `<!-- ${CARD_MARKER} Sanduhr nur Fallback ${CARD_MARKER} -->`;
    const tx = jsonl(assistantMsg({ type: "text", text }));
    expect(lastAssistantContainsCard(tx)).toBe(true);
    expect(extractCardTitle(text)).toBe("Sanduhr nur Fallback");
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

  // A session whose MCP servers never connected (CONNECT_TIMEOUT under load)
  // used to end with no card at all: the tool is absent, ToolSearch cannot load
  // it, the gate blocks once and then yields. The reason must name the offline
  // renderer so that session still produces a card.
  test("names the offline renderer under the given plugin root", () => {
    const r = buildBlockReason("C:\\Users\\x\\.claude\\plugins\\cache\\dotclaude\\devops\\0.1.0");
    expect(r).toMatch(/CONNECT_TIMEOUT/);
    expect(r).toContain(
      'node "C:/Users/x/.claude/plugins/cache/dotclaude/devops/0.1.0/mcp-server/index.js" --render-card',
    );
  });

  test("falls back to the env placeholder when no plugin root is known", () => {
    const r = buildBlockReason();
    expect(r).toContain('node "$CLAUDE_PLUGIN_ROOT/mcp-server/index.js" --render-card');
  });

  test("decideAction threads the plugin root into the card block reason", () => {
    const d = decideAction({
      workHappened: true,
      cardRendered: false,
      stopHookActive: false,
      substantial: false,
      pluginRoot: "/opt/devops",
    });
    expect(d.action).toBe("block");
    expect(d.reason).toContain('node "/opt/devops/mcp-server/index.js" --render-card');
  });
});
