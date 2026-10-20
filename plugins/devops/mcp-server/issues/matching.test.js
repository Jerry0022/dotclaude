import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tokenize, scoreIssue, normalizeCwd, lruGet, MAX_CACHES } from "./matching.js";

describe("cache keys (normalizeCwd / lruGet)", () => {
  test("normalizeCwd: one key per real directory, null for missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-"));
    expect(normalizeCwd(dir + path.sep)).toBe(path.resolve(dir));
    expect(normalizeCwd(path.join(dir, "."))).toBe(path.resolve(dir));
    expect(normalizeCwd(path.join(dir, "nope"))).toBeNull();
    expect(normalizeCwd("")).toBeNull();
    expect(normalizeCwd(undefined)).toBeNull();
  });
  test("lruGet caps entries and evicts the least recently used", () => {
    const m = new Map();
    for (let i = 0; i < MAX_CACHES; i++) lruGet(m, `k${i}`, () => ({ i }));
    const first = lruGet(m, "k0", () => ({ fresh: true }));
    expect(first).toEqual({ i: 0 });
    lruGet(m, "new", () => ({}));
    expect(m.size).toBe(MAX_CACHES);
    expect(m.has("k0")).toBe(true);
    expect(m.has("k1")).toBe(false);
  });
});

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

  test("query word matches as substring of a longer issue word", () => {
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
