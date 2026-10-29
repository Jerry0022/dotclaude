import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateVersionFiles, verifyVersionFiles } from "./version.js";

// Project-declared version files (#941): bumped with the built-in files and
// checked by version-consistent. Real files in a temp npm project.

let dir;
const TS = "src/app/version.ts";
const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vf941-"));
  write("package.json", JSON.stringify({ name: "app", version: "0.86.0" }, null, 2) + "\n");
  write("CHANGELOG.md", "# Changelog\n"); // the built-in check requires the file
  write(TS, "export const APP_VERSION = '0.86.0';\nexport const OTHER = '9.9.9';\n");
  write("app.json", JSON.stringify({ expo: { version: "0.86.0" } }, null, 2) + "\n");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const DECLARED = [
  { path: TS, pattern: "APP_VERSION = '([^']+)'" },
  { path: "app.json", key: "expo.version" },
];

describe("declared version files (#941)", () => {
  test("bump writes a pattern file and a JSON key; nothing else in the file moves", () => {
    const res = updateVersionFiles("0.86.0", "0.86.1", dir, DECLARED);
    expect(res).toEqual(expect.arrayContaining([
      { file: TS, updated: true, declared: true },
      { file: "app.json", updated: true, declared: true },
    ]));
    expect(read(TS)).toBe("export const APP_VERSION = '0.86.1';\nexport const OTHER = '9.9.9';\n");
    expect(JSON.parse(read("app.json")).expo.version).toBe("0.86.1");
    expect(verifyVersionFiles("0.86.1", dir, DECLARED)).toEqual({ consistent: true, mismatches: [] });
  });

  test("a declared file left behind fails version-consistent", () => {
    updateVersionFiles("0.86.0", "0.86.1", dir); // without the declaration: the #941 symptom
    const v = verifyVersionFiles("0.86.1", dir, DECLARED);
    expect(v.consistent).toBe(false);
    expect(v.mismatches).toEqual(expect.arrayContaining([
      { file: TS, expected: "0.86.1", found: "0.86.0" },
      { file: "app.json", expected: "0.86.1", found: "0.86.0" },
    ]));
  });

  test("missing file, unmatched pattern or a path outside the project → mismatch, never a silent skip", () => {
    const v = verifyVersionFiles("0.86.0", dir, [
      { path: "nope.ts", pattern: "V = '([^']+)'" },
      { path: TS, pattern: "NOT_THERE = '([^']+)'" },
      { path: "../outside.json", key: "version" },
    ]);
    expect(v.mismatches.map((m) => m.found)).toEqual(["(not found)", "(pattern not found)", "(path outside the project)"]);
  });

  test("a project file whose name starts with '..' is inside the project", () => {
    write("..gen/version.json", JSON.stringify({ version: "0.86.0" }));
    expect(verifyVersionFiles("0.86.0", dir, [{ path: "..gen/version.json", key: "version" }]).consistent).toBe(true);
  });

  test("the capture group is replaced at its own offset, not at an earlier identical text", () => {
    write("build.txt", "0.86.0 built as v0.86.0\n");
    updateVersionFiles("0.86.0", "0.86.1", dir, [{ path: "build.txt", pattern: "0\\.86\\.0 built as v(\\d+\\.\\d+\\.\\d+)" }]);
    expect(read("build.txt")).toBe("0.86.0 built as v0.86.1\n");
  });

  test("without declared files the behaviour is unchanged", () => {
    updateVersionFiles("0.86.0", "0.86.1", dir);
    expect(read(TS)).toContain("'0.86.0'");
    expect(verifyVersionFiles("0.86.1", dir).consistent).toBe(true);
  });
});
