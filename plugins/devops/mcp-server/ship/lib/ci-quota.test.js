import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repoKey, nextMonthResetUtc, readRecord, recordBlock, setDecision,
  revokeDecision, clearRecord, storePath, describeRecord, DECISION_TTL_MS,
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
  test("a garbled resetAt expires instead of living forever", () => {
    writeFileSync(file, JSON.stringify({ repos: { "o/r": { since: "x", resetAt: "not-a-date" } } }));
    expect(readRecord("o/r", { now: NOW, file })).toBeNull();
  });
  test("corrupt store reads as empty", () => {
    writeFileSync(file, "{nope");
    expect(readRecord("o/r", { now: NOW, file })).toBeNull();
    recordBlock("o/r", { now: NOW, file });
    expect(readRecord("o/r", { now: NOW, file })).not.toBeNull();
  });
});

describe("A2: the user's answer is valid 7 days per project, across sessions", () => {
  const DAY = 24 * 60 * 60 * 1000;
  test("decision applies within 7 days and is gone after (ask again)", () => {
    recordBlock("o/r", { now: NOW, file });
    const set = setDecision("o/r", "skip-checks", { now: NOW, file });
    expect(set.decision.expiresAt).toBe(new Date(NOW + DECISION_TTL_MS).toISOString());
    expect(readRecord("o/r", { now: NOW + 6 * DAY, file }).decision.value).toBe("skip-checks");
    const later = readRecord("o/r", { now: NOW + 7 * DAY + 1, file });
    expect(later).not.toBeNull(); // the block itself is still active (resets Nov 1)
    expect(later.decision).toBeUndefined();
    expect(describeRecord(later).decision).toBeNull();
  });
  test("the answer survives the block clearing and a new block within 7 days", () => {
    recordBlock("o/r", { now: NOW, file });
    setDecision("o/r", "wait", { now: NOW, file });
    clearRecord("o/r", { file });
    expect(readRecord("o/r", { now: NOW + DAY, file })).toBeNull();
    expect(recordBlock("o/r", { now: NOW + 2 * DAY, file }).decision.value).toBe("wait");
    expect(recordBlock("o/x", { now: NOW + 2 * DAY, file }).decision).toBeUndefined(); // per project
  });
  test("a pre-TTL store with the decision inside the record is migrated, its age counted", () => {
    writeFileSync(file, JSON.stringify({ version: 1, repos: { "o/r": {
      detectedAt: new Date(NOW).toISOString(), resetAt: "2026-11-01T00:00:00.000Z",
      decision: { value: "skip-checks", decidedAt: new Date(NOW).toISOString() },
    } } }));
    expect(readRecord("o/r", { now: NOW + DAY, file }).decision.value).toBe("skip-checks");
    expect(readRecord("o/r", { now: NOW + 8 * DAY, file }).decision).toBeUndefined();
  });
});
