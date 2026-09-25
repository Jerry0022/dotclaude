import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  GUIDE_ACTIVE_TTL_MS,
  guideActiveFilePath,
  markGuideActive,
  clearGuideActive,
  isGuideActive,
} from "./guide-active-state.js";

// Fixtures live under node_modules/ (gitignored) inside the repo, matching
// web-guide.test.js's convention for temp dirs.
const TMP_ROOT = path.join(process.cwd(), "node_modules", ".guide-active-state-test-tmp");
const tmpDirs = [];
function makeTmpDir() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, "guide-active-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

describe("guide-active-state", () => {
  test("isGuideActive is false with no marker", () => {
    const dir = makeTmpDir();
    expect(isGuideActive(dir)).toBe(false);
  });

  test("markGuideActive then isGuideActive is true", () => {
    const dir = makeTmpDir();
    const file = markGuideActive(dir);
    expect(file).toBe(guideActiveFilePath(dir));
    expect(fs.existsSync(file)).toBe(true);
    expect(isGuideActive(dir)).toBe(true);
  });

  // #526: a crashed guide (tab closed, process killed) must not disable the
  // card gate forever — the marker expires after GUIDE_ACTIVE_TTL_MS.
  test("a marker older than the TTL is no longer active", () => {
    const dir = makeTmpDir();
    const now = Date.now();
    markGuideActive(dir, now - GUIDE_ACTIVE_TTL_MS - 1);
    expect(isGuideActive(dir, now)).toBe(false);
  });

  test("a marker exactly at the TTL boundary is still active", () => {
    const dir = makeTmpDir();
    const now = Date.now();
    markGuideActive(dir, now - GUIDE_ACTIVE_TTL_MS);
    expect(isGuideActive(dir, now)).toBe(true);
  });

  test("clearGuideActive removes the marker", () => {
    const dir = makeTmpDir();
    markGuideActive(dir);
    clearGuideActive(dir);
    expect(isGuideActive(dir)).toBe(false);
  });

  test("clearGuideActive on a never-created marker does not throw", () => {
    const dir = makeTmpDir();
    expect(() => clearGuideActive(dir)).not.toThrow();
  });

  test("a corrupt marker file is treated as inactive, never throws", () => {
    const dir = makeTmpDir();
    const file = guideActiveFilePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect(isGuideActive(dir)).toBe(false);
  });

  test("a marker missing ts is treated as inactive", () => {
    const dir = makeTmpDir();
    const file = guideActiveFilePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ foo: "bar" }));
    expect(isGuideActive(dir)).toBe(false);
  });
});
