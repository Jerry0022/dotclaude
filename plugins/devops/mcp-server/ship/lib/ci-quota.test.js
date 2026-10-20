import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repoKey, nextMonthResetUtc, readRecord, recordBlock, setDecision,
  revokeDecision, clearRecord, storePath,
} from "./ci-quota.js";

let dir, file;
const NOW = Date.parse("2026-10-19T10:00:00Z");
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-quota-")); file = join(dir, "q.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("repoKey / reset", () => {
  test("parses https and ssh remotes", () => {
    expect(repoKey("x", { remoteUrl: "https://github.com/Jerry0022/dotclaude.git" })).toBe("jerry0022/dotclaude");
    expect(repoKey("x", { remoteUrl: "git@github.com:Foo/Bar" })).toBe("foo/bar");
    expect(repoKey("x", { remoteUrl: "" })).toBeNull();
  });
  test("unknown reset is the 1st of next month UTC", () => {
    expect(nextMonthResetUtc(NOW)).toBe("2026-11-01T00:00:00.000Z");
    expect(nextMonthResetUtc(Date.parse("2026-12-31T23:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
  test("store path is injectable", () => {
    expect(storePath("/a/b.json")).toBe("/a/b.json");
  });
});

describe("store lifecycle", () => {
  test("record, share, decision, revoke", () => {
    expect(readRecord("o/r", { now: NOW, file })).toBeNull();
    recordBlock("o/r", { now: NOW, file });
    const rec = readRecord("o/r", { now: NOW, file });
    expect(rec.resetAt).toBe("2026-11-01T00:00:00.000Z");
    expect(rec.decision).toBeUndefined();
    expect(setDecision("o/r", "skip-checks", { now: NOW, file }).decision.value).toBe("skip-checks");
    // another session re-detecting keeps the decision
    recordBlock("o/r", { now: NOW + 1000, file });
    expect(readRecord("o/r", { now: NOW, file }).decision.value).toBe("skip-checks");
    expect(revokeDecision("o/r", { file })).toBe(true);
    expect(readRecord("o/r", { now: NOW, file }).decision).toBeUndefined();
    expect(readRecord("o/r", { now: NOW, file })).not.toBeNull();
  });
  test("decision is not stored without a recorded block, and must be valid", () => {
    expect(setDecision("o/r", "skip-checks", { now: NOW, file })).toBeNull();
    expect(existsSync(file)).toBe(false);
    recordBlock("o/r", { now: NOW, file });
    expect(() => setDecision("o/r", "yolo", { now: NOW, file })).toThrow();
  });
  test("expires at the reset date", () => {
    recordBlock("o/r", { now: NOW, file });
    expect(readRecord("o/r", { now: Date.parse("2026-11-01T00:00:00Z"), file })).toBeNull();
    expect(readRecord("o/r", { now: NOW, file })).toBeNull(); // removed
  });
  test("clearRecord drops it when checks run again; other repos untouched", () => {
    recordBlock("o/r", { now: NOW, file });
    recordBlock("o/other", { now: NOW, file });
    expect(clearRecord("o/r", { file })).toBe(true);
    expect(readRecord("o/r", { now: NOW, file })).toBeNull();
    expect(readRecord("o/other", { now: NOW, file })).not.toBeNull();
  });
  test("corrupt store reads as empty", () => {
    writeFileSync(file, "{nope");
    expect(readRecord("o/r", { now: NOW, file })).toBeNull();
    recordBlock("o/r", { now: NOW, file });
    expect(readRecord("o/r", { now: NOW, file })).not.toBeNull();
  });
});
