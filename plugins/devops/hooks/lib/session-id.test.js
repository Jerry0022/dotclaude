import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { sessionFile, readSessionFile, writeSessionFile } from "./session-id.js";

const TEST_PREFIX = "vitest-session-test";
const TEST_SESSION = "test-session-" + Date.now();
const cleanupFiles = [];

afterAll(() => {
  for (const f of cleanupFiles) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
  // Also clean any glob-matching test files
  const tmpdir = os.tmpdir();
  try {
    const files = fs.readdirSync(tmpdir).filter((f) => f.startsWith(TEST_PREFIX));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(tmpdir, f));
      } catch {}
    }
  } catch {}
});

// ---------------------------------------------------------------------------
// sessionFile — path construction
// ---------------------------------------------------------------------------

describe("sessionFile", () => {
  test("constructs path with prefix and session id", () => {
    const result = sessionFile(TEST_PREFIX, "abc-123");
    expect(result).toBe(path.join(os.tmpdir(), `${TEST_PREFIX}-abc-123`));
  });

  test("uses 'unknown' when session id is falsy", () => {
    expect(sessionFile(TEST_PREFIX, undefined)).toBe(
      path.join(os.tmpdir(), `${TEST_PREFIX}-unknown`),
    );
    expect(sessionFile(TEST_PREFIX, null)).toBe(
      path.join(os.tmpdir(), `${TEST_PREFIX}-unknown`),
    );
    expect(sessionFile(TEST_PREFIX, "")).toBe(
      path.join(os.tmpdir(), `${TEST_PREFIX}-unknown`),
    );
  });
});

// ---------------------------------------------------------------------------
// writeSessionFile + readSessionFile — round-trip I/O
// ---------------------------------------------------------------------------

describe("writeSessionFile + readSessionFile", () => {
  test("round-trip: write then read returns same content", () => {
    const filePath = sessionFile(TEST_PREFIX, TEST_SESSION);
    cleanupFiles.push(filePath, filePath + ".tmp");
    writeSessionFile(filePath, "hello-vitest");
    const result = readSessionFile(TEST_PREFIX, TEST_SESSION);
    expect(result).not.toBeNull();
    expect(result.content).toBe("hello-vitest");
    expect(result.filePath).toBe(filePath);
  });

  test("returns null for completely unknown prefix", () => {
    const uniquePrefix = "vitest-nonexistent-" + Date.now();
    const result = readSessionFile(uniquePrefix, "no-such-session");
    expect(result).toBeNull();
  });

  test("glob fallback finds file with different session id", () => {
    // Write with one session id, read with another — glob should find it
    const filePath = sessionFile(TEST_PREFIX, "glob-writer");
    cleanupFiles.push(filePath, filePath + ".tmp");
    writeSessionFile(filePath, "glob-content");

    const result = readSessionFile(TEST_PREFIX, "glob-reader");
    expect(result).not.toBeNull();
    expect(result.content).toBe("glob-content");
  });
});

// ---------------------------------------------------------------------------
// exact mode — enforcement flags must never read a foreign session's file (#290)
// ---------------------------------------------------------------------------

describe("readSessionFile — { exact: true }", () => {
  test("a foreign session's file is NOT returned", () => {
    const foreign = sessionFile(TEST_PREFIX, "exact-foreign-writer");
    cleanupFiles.push(foreign, foreign + ".tmp");
    writeSessionFile(foreign, "foreign-content");

    // Without exact: the glob fallback hands over the neighbour's state.
    expect(readSessionFile(TEST_PREFIX, "exact-reader").content).toBe("foreign-content");
    // With exact: this session has no file, so it gets nothing — and crucially
    // no `filePath` a gate could then unlink out from under the other session.
    expect(readSessionFile(TEST_PREFIX, "exact-reader", { exact: true })).toBeNull();
  });

  test("this session's own file is still returned", () => {
    const own = sessionFile(TEST_PREFIX, "exact-own");
    cleanupFiles.push(own, own + ".tmp");
    writeSessionFile(own, "own-content");

    const result = readSessionFile(TEST_PREFIX, "exact-own", { exact: true });
    expect(result).not.toBeNull();
    expect(result.content).toBe("own-content");
    expect(result.filePath).toBe(own);
  });

  test("only exact:true disables the fallback — other option shapes do not", () => {
    const foreign = sessionFile(TEST_PREFIX, "exact-shape-writer");
    cleanupFiles.push(foreign, foreign + ".tmp");
    writeSessionFile(foreign, "shape-content");

    for (const opts of [undefined, {}, { exact: false }, { exact: "yes" }]) {
      expect(readSessionFile(TEST_PREFIX, "exact-shape-reader", opts)).not.toBeNull();
    }
  });
});
