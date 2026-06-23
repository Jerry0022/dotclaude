import { describe, test, expect } from "vitest";
import { checkTool, which } from "./check-tool.js";

// `node` is guaranteed on PATH (the test runner is node itself); a long random
// name is guaranteed absent. That makes detection deterministic without the
// real target tool (graphify) installed.
const ABSENT = "definitely-not-a-real-binary-xyz-9000";

describe("which — PATH resolution", () => {
  test("resolves a known binary (node) to an absolute path", () => {
    const p = which("node");
    expect(p).toBeTruthy();
    expect(path_isAbsolute(p)).toBe(true);
  });

  test("returns null for a binary that does not exist", () => {
    expect(which(ABSENT)).toBeNull();
  });

  test.each([
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["non-string", 42],
  ])("returns null for invalid input (%s)", (_label, input) => {
    expect(which(input)).toBeNull();
  });
});

describe("checkTool — availability probe", () => {
  test("reports installed:true with a path for node", () => {
    const r = checkTool("node");
    expect(r.installed).toBe(true);
    expect(r.path).toBeTruthy();
  });

  test("reports installed:false and no path for a missing tool", () => {
    expect(checkTool(ABSENT)).toEqual({ installed: false });
  });

  test("captures version when versionArgs probe succeeds", () => {
    const r = checkTool("node", { versionArgs: ["--version"] });
    expect(r.installed).toBe(true);
    expect(r.version).toMatch(/^v?\d+\./);
  });

  test("missing tool with versionArgs still returns installed:false", () => {
    const r = checkTool(ABSENT, { versionArgs: ["--version"] });
    expect(r.installed).toBe(false);
    expect(r.version).toBeUndefined();
  });

  test("no version key when versionArgs omitted", () => {
    const r = checkTool("node");
    expect(r).not.toHaveProperty("version");
  });
});

// Tiny local helper so the test has no import beyond the unit under test.
function path_isAbsolute(p) {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
}
