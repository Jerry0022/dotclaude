import { describe, test, expect } from "vitest";
import { z } from "zod";
import { matchIssuesShape, resolveCwd } from "./matching.js";

describe("match_issues contract", () => {
  const schema = z.object(matchIssuesShape);

  test("rejects negative / out-of-range bounds", () => {
    expect(schema.safeParse({ query: "x", max_results: -1 }).success).toBe(false);
    expect(schema.safeParse({ query: "x", max_results: 0 }).success).toBe(false);
    expect(schema.safeParse({ query: "x", threshold: 2 }).success).toBe(false);
    expect(schema.safeParse({ query: "x", threshold: -0.1 }).success).toBe(false);
    expect(schema.parse({ query: "x" })).toMatchObject({ max_results: 3, threshold: 0.25 });
  });

  test("resolveCwd: explicit arg beats CLAUDE_PROJECT_DIR, none is undefined", () => {
    expect(resolveCwd("/a", { CLAUDE_PROJECT_DIR: "/b" })).toBe("/a");
    expect(resolveCwd(undefined, { CLAUDE_PROJECT_DIR: "/b" })).toBe("/b");
    expect(resolveCwd(" ", {})).toBeUndefined();
  });
});
