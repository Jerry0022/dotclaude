import { describe, test, expect } from "vitest";
import bs from "./burn-state.js";

const line = (o) => JSON.stringify(o);
const limitLine = (text, extra = {}) => line({
  type: "assistant", error: "rate_limit", isApiErrorMessage: true, timestamp: "2026-09-25T09:00:00.000Z",
  message: { model: "<synthetic>", content: [{ type: "text", text }] }, ...extra,
});
const normal = line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });
const user = line({ type: "user", message: { content: "weiter" } });

describe("limitEvidenceFromText — was the newest main-chain turn a limit stop?", () => {
  test("the real transcript shape (5-hour session limit)", () => {
    const e = bs.limitEvidenceFromText([normal, limitLine("You've hit your session limit · resets 10:50pm (Europe/Berlin)")].join("\n"));
    expect(e).toMatchObject({ limited: true, kind: "session", at: "2026-09-25T09:00:00.000Z" });
  });

  test("weekly limit and older phrasings", () => {
    expect(bs.limitEvidenceFromText(limitLine("You've hit your weekly limit · resets Mon 8am")).kind).toBe("weekly");
    expect(bs.limitEvidenceFromText(line({ type: "assistant", isApiErrorMessage: true, message: { content: [{ type: "text", text: "5-hour limit reached ∙ resets 3pm" }] } })).limited).toBe(true);
    expect(bs.limitEvidenceFromText(line({ type: "assistant", isApiErrorMessage: true, message: { content: [{ type: "text", text: "Claude AI usage limit reached|1727000000" }] } })).limited).toBe(true);
  });

  test("a normal answer after the stop makes it history", () => {
    expect(bs.limitEvidenceFromText([limitLine("You've hit your session limit"), user, normal].join("\n")).limited).toBe(false);
  });

  test("a sub-agent's limit line (sidechain) is not the session's stop", () => {
    expect(bs.limitEvidenceFromText([normal, limitLine("You've hit your session limit", { isSidechain: true })].join("\n")).limited).toBe(false);
  });

  test("other API errors and prose about limits are not limit stops", () => {
    expect(bs.limitEvidenceFromText(line({ type: "assistant", isApiErrorMessage: true, message: { content: [{ type: "text", text: "API Error: 500 overloaded" }] } })).limited).toBe(false);
    expect(bs.limitEvidenceFromText(line({ type: "assistant", message: { content: [{ type: "text", text: "If you hit your usage limit, wait." }] } })).limited).toBe(false);
    expect(bs.limitEvidenceFromText("")).toEqual({ limited: false });
    expect(bs.limitEvidence(undefined)).toEqual({ limited: false });
  });
});

describe("isOpenRun", () => {
  test("open while work is queued or in flight and the run is not finished", () => {
    expect(bs.isOpenRun({ status: "running", queue: [{}], inFlight: [] })).toBe(true);
    expect(bs.isOpenRun({ status: "paused", queue: [], inFlight: [{}] })).toBe(true);
    expect(bs.isOpenRun({ queue: [{}] })).toBe(true); // v1 state
    expect(bs.isOpenRun({ status: "finished", queue: [{}] })).toBe(false);
    expect(bs.isOpenRun({ status: "running", queue: [], inFlight: [] })).toBe(false);
    expect(bs.isOpenRun(null)).toBe(false);
  });
});
