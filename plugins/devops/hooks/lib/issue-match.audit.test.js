import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const IM = createRequire(import.meta.url)("./issue-match.js");

describe("issue-match audit regressions", () => {
  const bugIssue = [{ number: 9, title: "Crash on startup", labels: ["type:bug"] }];

  test("label namespace prefix and short words no longer substring-match", () => {
    expect(IM.matchIssues(bugIssue, "debug typescript types", { threshold: 0.25 })).toEqual([]);
    expect(IM.matchIssues(bugIssue, "debugging", { threshold: 0.25 })).toEqual([]);
    // the real label word still matches
    expect(IM.matchIssues(bugIssue, "bug", { threshold: 0.25 })).toHaveLength(1);
  });

  test("long query word still matches inside a longer issue word", () => {
    const issues = [{ number: 1, title: "Debugging the loader", labels: [] }];
    expect(IM.matchIssues(issues, "debug", { threshold: 0.5 })).toHaveLength(1);
  });

  test("future timestamps are rejected", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-"));
    IM.writeCache("https://github.com/a/b", [{ number: 1, title: "x", labels: [] }], { dir, now: 10_000_000 });
    expect(IM.readCache("https://github.com/a/b", { dir, now: 1000 })).toBeNull();
  });

  test("titles are sanitized on write and read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-"));
    const evil = 'Fix "it"\n`rm -rf` ' + "x".repeat(500);
    IM.writeCache("https://github.com/a/b", [{ number: 1, title: evil, labels: [] }], { dir, now: 1000 });
    const [i] = IM.readCache("https://github.com/a/b", { dir, now: 1000 });
    expect(i.title).not.toMatch(/["`\n]/);
    expect(i.title.length).toBeLessThanOrEqual(200);
  });

  test("default cache dir is per user, not bare tmpdir", () => {
    expect(IM.defaultCacheDir()).not.toBe(os.tmpdir());
    expect(IM.cacheFile("https://github.com/a/b")).toContain(IM.defaultCacheDir());
  });
});
