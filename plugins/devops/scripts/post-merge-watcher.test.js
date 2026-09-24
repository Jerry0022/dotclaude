import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

// The ship extension dir was renamed ship → do-ship (skill restructure PR 2).
// /do-ship passes `--verify-config <cwd>/.claude/skills/do-ship/reference.md`;
// a consumer that still has only the old `ship/` dir must keep its verify.
const require = createRequire(import.meta.url);
const { resolveVerifyConfigPath } = require("./post-merge-watcher.js");

describe("resolveVerifyConfigPath (extension fallback)", () => {
  test("the new do-ship path wins when it exists", () => {
    const p = "/repo/.claude/skills/do-ship/reference.md";
    expect(resolveVerifyConfigPath(p, () => true)).toBe(p);
  });

  test("falls back to the pre-PR-2 ship dir (posix)", () => {
    const p = "/repo/.claude/skills/do-ship/reference.md";
    const exists = (x) => x === "/repo/.claude/skills/ship/reference.md";
    expect(resolveVerifyConfigPath(p, exists)).toBe("/repo/.claude/skills/ship/reference.md");
  });

  test("falls back to the pre-PR-2 ship dir (windows separators)", () => {
    const p = "C:\\repo\\.claude\\skills\\do-ship\\reference.md";
    const exists = (x) => x === "C:\\repo\\.claude\\skills\\ship\\reference.md";
    expect(resolveVerifyConfigPath(p, exists)).toBe("C:\\repo\\.claude\\skills\\ship\\reference.md");
  });

  test("neither exists → the given path is kept (parse returns null later)", () => {
    const p = "/repo/.claude/skills/do-ship/reference.md";
    expect(resolveVerifyConfigPath(p, () => false)).toBe(p);
  });

  test("no path → null", () => {
    expect(resolveVerifyConfigPath(null)).toBeNull();
  });
});
