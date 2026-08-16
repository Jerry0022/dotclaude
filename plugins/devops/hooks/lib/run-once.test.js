import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runOnce, releaseOnce } from "./run-once.js";

const TEST_HOOK = "vitest-runonce";
const TEST_SESSION = "test-" + Date.now();

function markerPath() {
  return path.join(os.tmpdir(), `dotclaude-${TEST_HOOK}-${TEST_SESSION}`);
}

afterEach(() => {
  try {
    fs.unlinkSync(markerPath());
  } catch {}
});

// ---------------------------------------------------------------------------
// runOnce — session-scoped execution guard
// ---------------------------------------------------------------------------

describe("runOnce", () => {
  test("first call returns true (should run)", () => {
    expect(runOnce(TEST_HOOK, TEST_SESSION)).toBe(true);
  });

  test("second call without cooldown returns false (already ran)", () => {
    runOnce(TEST_HOOK, TEST_SESSION);
    expect(runOnce(TEST_HOOK, TEST_SESSION)).toBe(false);
  });

  test("creates marker file on first run", () => {
    runOnce(TEST_HOOK, TEST_SESSION);
    expect(fs.existsSync(markerPath())).toBe(true);
  });

  test("with cooldown: second call within cooldown returns false", () => {
    runOnce(TEST_HOOK, TEST_SESSION, { cooldownMs: 60000 });
    expect(runOnce(TEST_HOOK, TEST_SESSION, { cooldownMs: 60000 })).toBe(false);
  });

  test("with cooldown: returns true after cooldown expires", () => {
    const marker = markerPath();
    fs.writeFileSync(marker, String(Date.now()));
    // Backdate mtime to 2 minutes ago
    const past = new Date(Date.now() - 120_000);
    fs.utimesSync(marker, past, past);
    expect(runOnce(TEST_HOOK, TEST_SESSION, { cooldownMs: 60000 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// releaseOnce — hand the token back when the guarded work never ran (#291)
// ---------------------------------------------------------------------------

describe("releaseOnce", () => {
  test("a released token lets the very next call run again", () => {
    expect(runOnce(TEST_HOOK, TEST_SESSION, { cooldownMs: 600_000 })).toBe(true);
    // Without the release this stays throttled for the full 10 minutes even
    // though the guarded work was declined and never ran.
    expect(runOnce(TEST_HOOK, TEST_SESSION, { cooldownMs: 600_000 })).toBe(false);

    expect(releaseOnce(TEST_HOOK, TEST_SESSION)).toBe(true);
    expect(runOnce(TEST_HOOK, TEST_SESSION, { cooldownMs: 600_000 })).toBe(true);
  });

  test("releasing restores the exact pre-runOnce state — no marker left", () => {
    runOnce(TEST_HOOK, TEST_SESSION);
    releaseOnce(TEST_HOOK, TEST_SESSION);
    expect(fs.existsSync(markerPath())).toBe(false);
  });

  test("releasing a token that was never taken is a no-op, not an error", () => {
    expect(() => releaseOnce(TEST_HOOK, "never-ran-" + Date.now())).not.toThrow();
    expect(releaseOnce(TEST_HOOK, "never-ran-" + Date.now())).toBe(false);
  });

  test("works for the strict once-per-session mode too", () => {
    expect(runOnce(TEST_HOOK, TEST_SESSION)).toBe(true);
    expect(runOnce(TEST_HOOK, TEST_SESSION)).toBe(false);
    releaseOnce(TEST_HOOK, TEST_SESSION);
    expect(runOnce(TEST_HOOK, TEST_SESSION)).toBe(true);
  });
});
