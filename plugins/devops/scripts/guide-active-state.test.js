import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  GUIDE_ACTIVE_TTL_MS,
  guideActiveFilePath,
  markGuideActive,
  clearGuideActive,
  readGuideToken,
  touchGuideToken,
  isGuideActive,
  recordGuideStep,
  hasValueField,
  getGuideStatus,
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

  test("the marker carries a channel token that survives refreshes and expiry, and dies with clear (AUD-C007, deep check)", () => {
    const dir = makeTmpDir();
    const now = Date.now();
    markGuideActive(dir, now);
    const token = readGuideToken(dir, now);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    markGuideActive(dir, now + 1000);
    expect(readGuideToken(dir, now + 1000)).toBe(token);
    // A guide resumed after a long pause still reaches the overlay in the page:
    // the token outlives the "active" TTL (no tab reload that loses the site form).
    expect(readGuideToken(dir, now + 1000 + GUIDE_ACTIVE_TTL_MS + 1)).toBe(token);
    expect(isGuideActive(dir, now + 1000 + GUIDE_ACTIVE_TTL_MS + 1)).toBe(false);
    markGuideActive(dir, now + 1000 + GUIDE_ACTIVE_TTL_MS + 1);
    expect(readGuideToken(dir, now + 1000 + GUIDE_ACTIVE_TTL_MS + 1)).toBe(token);
    clearGuideActive(dir);
    expect(readGuideToken(dir)).toBeNull();
  });

  test("clearGuideActive throws when the marker cannot be removed (AUD-C061)", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(guideActiveFilePath(dir), { recursive: true });
    expect(() => clearGuideActive(dir)).toThrow();
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

  // Finding 6: a guide running longer than one marker TTL inside a single
  // turn must not drop its channel token — `payload step`/`payload wait`
  // touch (refresh) the marker on every call via touchGuideToken(), keeping
  // the SAME token, not minting a new one.
  describe("touchGuideToken (Finding 6)", () => {
    test("a marker older than the TTL, but refreshed by step/wait before it expires, keeps its token", () => {
      const dir = makeTmpDir();
      const now = Date.now();
      markGuideActive(dir, now);
      const token = readGuideToken(dir, now);
      expect(token).toMatch(/^[0-9a-f]{32}$/);

      // Simulate a long-running guide: touch (refresh) the marker repeatedly,
      // each time just under the TTL boundary from the last write — the
      // marker would otherwise expire (and the token drop) between turns.
      let t = now;
      for (let i = 0; i < 3; i++) {
        t += GUIDE_ACTIVE_TTL_MS - 1000;
        expect(touchGuideToken(dir, t)).toBe(token);
      }
      // Well past the marker's original write, but each touch kept it alive.
      expect(t).toBeGreaterThan(now + GUIDE_ACTIVE_TTL_MS);
      expect(readGuideToken(dir, t)).toBe(token);
    });

    test("touchGuideToken returns null without a marker, and revives an expired marker with its own token", () => {
      const dir = makeTmpDir();
      expect(touchGuideToken(dir)).toBeNull();
      expect(fs.existsSync(guideActiveFilePath(dir))).toBe(false);

      const now = Date.now();
      markGuideActive(dir, now - GUIDE_ACTIVE_TTL_MS - 1); // already expired
      const token = readGuideToken(dir, now);
      expect(touchGuideToken(dir, now)).toBe(token);
      expect(isGuideActive(dir, now)).toBe(true);
    });

    test("a stray touchGuideToken call never mints a new token, only extends the existing one", () => {
      const dir = makeTmpDir();
      const now = Date.now();
      markGuideActive(dir, now);
      const token = readGuideToken(dir, now);
      touchGuideToken(dir, now + 1000);
      touchGuideToken(dir, now + 2000);
      expect(readGuideToken(dir, now + 2000)).toBe(token);
    });
  });

  // Finding 6: `guide active` (markGuideActive) run twice in a row — e.g. a
  // resumed turn re-arming the marker — keeps the same token rather than
  // rotating it, so an in-flight step/wait call's already-baked token stays
  // valid.
  test("guide active (markGuideActive) called twice keeps the token", () => {
    const dir = makeTmpDir();
    const now = Date.now();
    markGuideActive(dir, now);
    const token = readGuideToken(dir, now);
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    markGuideActive(dir, now + 500);
    expect(readGuideToken(dir, now + 500)).toBe(token);

    markGuideActive(dir, now + 1000);
    expect(readGuideToken(dir, now + 1000)).toBe(token);
  });

  test("markGuideActive leaves no .tmp file behind on success", () => {
    const dir = makeTmpDir();
    markGuideActive(dir);
    const files = fs.readdirSync(path.dirname(guideActiveFilePath(dir)));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  test("markGuideActive removes its own temp file when the rename fails, and rethrows", () => {
    const dir = makeTmpDir();
    const file = guideActiveFilePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const realRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === file) {
        const err = new Error("EPERM: operation not permitted, rename");
        err.code = "EPERM";
        throw err;
      }
      return realRename(from, to);
    };
    try {
      expect(() => markGuideActive(dir)).toThrow(/EPERM/);
    } finally {
      fs.renameSync = realRename;
    }
    const leftover = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".tmp"));
    expect(leftover).toEqual([]);
  });

  test("two concurrent markGuideActive calls use different temp names (no shared .tmp race)", () => {
    const dir = makeTmpDir();
    const file = guideActiveFilePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const seen = new Set();
    const realWrite = fs.writeFileSync;
    fs.writeFileSync = (p, ...rest) => {
      if (typeof p === "string" && p.includes(".tmp")) seen.add(p);
      return realWrite(p, ...rest);
    };
    try {
      markGuideActive(dir);
      markGuideActive(dir);
    } finally {
      fs.writeFileSync = realWrite;
    }
    expect(seen.size).toBe(2);
  });

  // Resume support (payload step / guide status).
  describe("hasValueField", () => {
    test("false for a step without any value key", () => {
      expect(hasValueField({ id: "1", title: "t", text: "x" })).toBe(false);
    });

    test("true for a top-level value key", () => {
      expect(hasValueField({ id: "1", value: "x" })).toBe(true);
    });

    test("true for a nested value key (e.g. copy[].value)", () => {
      expect(hasValueField({ id: "1", copy: [{ label: "l", value: "x" }] })).toBe(true);
    });

    test("false for non-object/array leaves", () => {
      expect(hasValueField("x")).toBe(false);
      expect(hasValueField(42)).toBe(false);
      expect(hasValueField(null)).toBe(false);
      expect(hasValueField(undefined)).toBe(false);
    });
  });

  describe("recordGuideStep", () => {
    test("does nothing without an existing marker (no resurrection)", () => {
      const dir = makeTmpDir();
      const result = recordGuideStep(dir, { id: "1" });
      expect(result).toBeNull();
      expect(fs.existsSync(guideActiveFilePath(dir))).toBe(false);
    });

    test("records the step and its ts when a marker exists", () => {
      const dir = makeTmpDir();
      const now = Date.now();
      markGuideActive(dir, now);
      const step = { id: "1", index: 1, total: 3, title: "t", text: "x" };
      const result = recordGuideStep(dir, step, now + 10);
      expect(result).toBe(guideActiveFilePath(dir));
      const data = JSON.parse(fs.readFileSync(guideActiveFilePath(dir), "utf8"));
      expect(data.lastStep).toEqual(step);
      expect(data.lastStepTs).toBe(now + 10);
      expect(data.token).toBe(readGuideToken(dir));
    });

    test("refuses to persist a step carrying a value field anywhere", () => {
      const dir = makeTmpDir();
      markGuideActive(dir);
      const step = { id: "1", copy: [{ value: "x" }] };
      expect(recordGuideStep(dir, step)).toBeNull();
      const data = JSON.parse(fs.readFileSync(guideActiveFilePath(dir), "utf8"));
      expect(data.lastStep).toBeUndefined();
    });

    test("refuses to persist a step whose JSON is too large", () => {
      const dir = makeTmpDir();
      markGuideActive(dir);
      const step = { id: "1", text: "x".repeat(5000) };
      expect(recordGuideStep(dir, step)).toBeNull();
    });

    test("markGuideActive preserves the recorded lastStep on a plain refresh", () => {
      const dir = makeTmpDir();
      const now = Date.now();
      markGuideActive(dir, now);
      const step = { id: "1", title: "t" };
      recordGuideStep(dir, step, now + 10);
      markGuideActive(dir, now + 20);
      const data = JSON.parse(fs.readFileSync(guideActiveFilePath(dir), "utf8"));
      expect(data.lastStep).toEqual(step);
    });
  });

  describe("getGuideStatus", () => {
    test("inactive with no marker", () => {
      const dir = makeTmpDir();
      expect(getGuideStatus(dir)).toEqual({ active: false, ageMinutes: null, lastStep: null });
    });

    test("active with a fresh marker, never returns the token", () => {
      const dir = makeTmpDir();
      const now = Date.now();
      markGuideActive(dir, now);
      const status = getGuideStatus(dir, now + 60000);
      expect(status.active).toBe(true);
      expect(status.ageMinutes).toBe(1);
      expect(status.lastStep).toBeNull();
      expect(JSON.stringify(status)).not.toMatch(/[0-9a-f]{32}/);
    });

    test("inactive once past the TTL, but still reports the last step", () => {
      const dir = makeTmpDir();
      const now = Date.now();
      markGuideActive(dir, now);
      const step = { id: "1" };
      recordGuideStep(dir, step, now);
      const status = getGuideStatus(dir, now + GUIDE_ACTIVE_TTL_MS + 1);
      expect(status.active).toBe(false);
      expect(status.lastStep).toEqual(step);
    });
  });
});
