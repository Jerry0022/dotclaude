import { describe, test, expect } from "vitest";
import { tokenize, scoreIssue } from "./matching.js";

// ---------------------------------------------------------------------------
// tokenize — text normalization
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  test("lowercases and splits on whitespace", () => {
    expect(tokenize("Hello World Test")).toEqual(["hello", "world", "test"]);
  });

  test("strips special characters", () => {
    expect(tokenize("fix: bug #123")).toEqual(["fix", "bug", "123"]);
  });

  test("filters words shorter than 3 chars", () => {
    expect(tokenize("a to do the big one")).toEqual(["the", "big", "one"]);
  });

  test("preserves German umlauts", () => {
    expect(tokenize("Über Größe")).toEqual(["über", "größe"]);
  });

  test("preserves hyphens in compound words", () => {
    expect(tokenize("video-filter feature")).toEqual([
      "video-filter",
      "feature",
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  test("returns empty array for noise-only input", () => {
    expect(tokenize("# @ ! ?")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scoreIssue — fuzzy matching confidence
// ---------------------------------------------------------------------------

describe("scoreIssue", () => {
  test("full match returns 1.0", () => {
    const issue = { title: "fix login bug", labels: [] };
    const tokens = tokenize("fix login bug");
    expect(scoreIssue(issue, tokens)).toBe(1);
  });

  test("no match returns 0", () => {
    const issue = { title: "fix login bug", labels: [] };
    const tokens = tokenize("deploy kubernetes cluster");
    expect(scoreIssue(issue, tokens)).toBe(0);
  });

  test("partial match returns fraction", () => {
    const issue = { title: "fix video filters", labels: ["enhancement"] };
    const tokens = tokenize("video settings page");
    const score = scoreIssue(issue, tokens);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  test("labels contribute to matching", () => {
    const issue = { title: "update readme", labels: ["documentation"] };
    const tokens = tokenize("documentation update");
    expect(scoreIssue(issue, tokens)).toBe(1);
  });

  test("substring matching works both directions", () => {
    const issue = { title: "authentication middleware", labels: [] };
    const tokens = tokenize("auth");
    // "auth" is a substring of "authentication"
    expect(scoreIssue(issue, tokens)).toBe(1);
  });

  test("returns 0 for empty query tokens", () => {
    const issue = { title: "something", labels: [] };
    expect(scoreIssue(issue, [])).toBe(0);
  });

  test("returns 0 for empty issue", () => {
    const issue = { title: "", labels: [] };
    const tokens = tokenize("some query");
    expect(scoreIssue(issue, tokens)).toBe(0);
  });
});
