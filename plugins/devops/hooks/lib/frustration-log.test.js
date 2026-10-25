import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { appendVerdict, formatLine, logPath, MAX_LINES } = require("./frustration-log.js");
const { isSessionFlagged, writeState, readState, EXPIRY_MS } = require("./frustration-state.js");

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "frus-log-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("frustration-log", () => {
  test("default path is under ~/.claude", () => {
    expect(logPath({ home: "/h" })).toBe(path.join("/h", ".claude", "devops-frustration.log"));
  });

  test("line carries markers only, no free text", () => {
    const line = formatLine({ sessionId: "abcdef123456", verdict: "suggest", rounds: 3, score: 6.5, signals: ["T1s", "T2", "my secret prompt!"], nowMs: 0 });
    expect(line).toMatch(/^1970-01-01T00:00:00.000Z abcdef12 suggest rounds=3 score=6.5 signals=T1s,T2,mysecretprompt$/);
  });

  test("rotation runs on every append and keeps the newest lines", () => {
    const file = path.join(dir, "sub", "f.log");
    for (let i = 0; i < MAX_LINES + 25; i += 1) appendVerdict({ sessionId: "s", verdict: "band", rounds: i, score: 3, signals: [] }, { file });
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(MAX_LINES);
    expect(lines[lines.length - 1]).toContain(`rounds=${MAX_LINES + 24}`);
    expect(lines[0]).toContain("rounds=25");
  });

  test("unwritable target does not throw", () => {
    const blocker = path.join(dir, "file");
    fs.writeFileSync(blocker, "x");
    expect(appendVerdict({ verdict: "x" }, { file: path.join(blocker, "nested", "f.log") })).toBe(false);
  });
});

describe("frustration-state", () => {
  const flaggedState = (updatedAt) => ({ target: [], rounds: 4, score: 8, tokenSets: [], userPrompts: 4, snoozed: false, offer: null, updatedAt });

  test("flagged within 2 h, gone after", () => {
    const file = path.join(dir, "st");
    const now = 1_000_000_000_000;
    writeState("S", flaggedState(now), { file });
    expect(isSessionFlagged("S", { file, nowMs: now + 60_000 })).toBe(true);
    expect(isSessionFlagged("S", { file, nowMs: now + EXPIRY_MS + 1 })).toBe(false);
    expect(readState("S", { file, nowMs: now + EXPIRY_MS + 1 })).toBeNull();
  });

  test("missing or corrupt state is not flagged", () => {
    const file = path.join(dir, "bad");
    expect(isSessionFlagged("S", { file })).toBe(false);
    fs.writeFileSync(file, "{nope");
    expect(isSessionFlagged("S", { file })).toBe(false);
    expect(isSessionFlagged("", {})).toBe(false);
  });
});
