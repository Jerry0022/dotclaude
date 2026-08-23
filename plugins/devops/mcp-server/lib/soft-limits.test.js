import { describe, it, expect } from "vitest";
import { clampText, clampList } from "./soft-limits.js";

describe("clampText", () => {
  it("passes a value that fits through untouched", () => {
    expect(clampText("fix(ship): short title", 70))
      .toEqual({ value: "fix(ship): short title", clamped: false, original: null });
  });

  it("passes a value exactly at the limit", () => {
    const exact = "x".repeat(70);
    expect(clampText(exact, 70)).toEqual({ value: exact, clamped: false, original: null });
  });

  it("clamps an over-long value to the limit instead of rejecting it", () => {
    const long = "fix(ship): a conventional commit subject that runs well past the seventy character budget";
    const r = clampText(long, 70);
    expect(r.clamped).toBe(true);
    expect(r.value.length).toBeLessThanOrEqual(70);
    expect(r.original).toBe(long);
  });

  it("cuts on a word boundary so the subject stays readable", () => {
    const long = "fix(ship): clamp over-long PR titles instead of crashing the whole pipeline";
    const r = clampText(long, 70);
    expect(r.value).toBe("fix(ship): clamp over-long PR titles instead of crashing the whole");
    expect(r.value.endsWith(" ")).toBe(false);
  });

  it("hard-cuts when no word boundary is close enough to the limit", () => {
    const r = clampText(`${"a".repeat(90)} tail`, 70);
    expect(r.value).toBe("a".repeat(70));
    expect(r.clamped).toBe(true);
  });

  it("appends no ellipsis — a commit subject must stay clean", () => {
    const r = clampText("feat(x): ".concat("word ".repeat(40)), 70);
    expect(r.value).not.toMatch(/[.…]{1,3}$/);
  });

  it("trims trailing separators left by the cut", () => {
    const r = clampText("fix(ship): clamp titles, verify tags, and never crash the pipeline again", 70);
    expect(r.value).not.toMatch(/[,\s-]$/);
  });

  it("treats a non-string as a pass-through rather than throwing", () => {
    expect(clampText(undefined, 70)).toEqual({ value: undefined, clamped: false, original: null });
  });
});

describe("clampList", () => {
  it("passes a list within budget untouched", () => {
    const list = [1, 2, 3];
    expect(clampList(list, 3)).toEqual({ value: list, clamped: false, dropped: 0 });
  });

  it("slices an over-long list and reports how many were dropped", () => {
    expect(clampList([1, 2, 3, 4, 5], 3)).toEqual({ value: [1, 2, 3], clamped: true, dropped: 2 });
  });

  it("treats a non-array as a pass-through", () => {
    expect(clampList(undefined, 3)).toEqual({ value: undefined, clamped: false, dropped: 0 });
  });
});

