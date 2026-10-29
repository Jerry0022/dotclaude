import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repoKey, quotaKey, nextMonthResetUtc, readRecord, recordBlock, setDecision,
  revokeDecision, clearRecord, storePath, describeRecord,
  listDisabled, readDisabled, recordDisabled, setDisabledState, dropDisabled,
} from "./ci-quota.js";

let dir, file;
const NOW = Date.parse("2026-10-19T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-quota-")); file = join(dir, "q.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("repoKey / quotaKey / reset", () => {
  test("parses https and ssh remotes", () => {
    expect(repoKey("x", { remoteUrl: "https://github.com/Jerry0022/dotclaude.git" })).toBe("jerry0022/dotclaude");
    expect(repoKey("x", { remoteUrl: "git@github.com:Foo/Bar" })).toBe("foo/bar");
    expect(repoKey("x", { remoteUrl: "" })).toBeNull();
  });
  test("the store key is the account: every repo of an owner shares it", () => {
    expect(quotaKey("x", { remoteUrl: "https://github.com/Foo/App.git" })).toBe("foo");
    expect(quotaKey("x", { remoteUrl: "git@github.com:foo/web" })).toBe("foo");
    expect(quotaKey("x", { remoteUrl: "" })).toBeNull();
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
    expect(readRecord("o", { now: NOW, file })).toBeNull();
    recordBlock("o", { now: NOW, file });
    const rec = readRecord("o", { now: NOW, file });
    expect(rec.resetAt).toBe("2026-11-01T00:00:00.000Z");
    expect(rec.decision).toBeUndefined();
    expect(setDecision("o", "skip-checks", { now: NOW, file }).decision.value).toBe("skip-checks");
    // another session re-detecting keeps the decision
    recordBlock("o", { now: NOW + 1000, file });
    expect(readRecord("o", { now: NOW, file }).decision.value).toBe("skip-checks");
    expect(revokeDecision("o", { file })).toBe(true);
    expect(readRecord("o", { now: NOW, file }).decision).toBeUndefined();
    expect(readRecord("o", { now: NOW, file })).not.toBeNull();
  });
  test("decision is not stored without a recorded block, and must be valid", () => {
    expect(setDecision("o", "skip-checks", { now: NOW, file })).toBeNull();
    expect(existsSync(file)).toBe(false);
    recordBlock("o", { now: NOW, file });
    expect(() => setDecision("o", "yolo", { now: NOW, file })).toThrow();
  });
  test("expires at the reset date", () => {
    recordBlock("o", { now: NOW, file });
    expect(readRecord("o", { now: Date.parse("2026-11-01T00:00:00Z"), file })).toBeNull();
    expect(readRecord("o", { now: NOW, file })).toBeNull(); // removed
  });
  test("clearRecord drops it when checks run again; other accounts untouched", () => {
    recordBlock("o", { now: NOW, file });
    recordBlock("other", { now: NOW, file });
    expect(clearRecord("o", { file })).toBe(true);
    expect(readRecord("o", { now: NOW, file })).toBeNull();
    expect(readRecord("other", { now: NOW, file })).not.toBeNull();
  });
  test("a garbled resetAt expires instead of living forever", () => {
    writeFileSync(file, JSON.stringify({ repos: { o: { since: "x", resetAt: "not-a-date" } } }));
    expect(readRecord("o", { now: NOW, file })).toBeNull();
  });
  test("corrupt store reads as empty", () => {
    writeFileSync(file, "{nope");
    expect(readRecord("o", { now: NOW, file })).toBeNull();
    recordBlock("o", { now: NOW, file });
    expect(readRecord("o", { now: NOW, file })).not.toBeNull();
  });
});

describe("the user's answer holds for the whole quota period, per account", () => {
  test("decision applies until the reset — weeks later too — and the next period asks again", () => {
    recordBlock("o", { now: NOW, file });
    const set = setDecision("o", "skip-checks", { now: NOW, file });
    expect(set.decision.validUntil).toBe("2026-11-01T00:00:00.000Z");
    expect(set.decision.expiresAt).toBe("2026-11-01T00:00:00.000Z");
    expect(readRecord("o", { now: NOW + 12 * DAY, file }).decision.value).toBe("skip-checks");
    // next period: a fresh block carries no answer
    const nov = Date.parse("2026-11-03T10:00:00Z");
    expect(recordBlock("o", { now: nov, file }).decision).toBeUndefined();
    expect(describeRecord(readRecord("o", { now: nov, file })).decision).toBeNull();
  });
  test("the answer survives the block clearing and a new block in the same period", () => {
    recordBlock("o", { now: NOW, file });
    setDecision("o", "wait", { now: NOW, file });
    clearRecord("o", { file });
    expect(readRecord("o", { now: NOW + DAY, file })).toBeNull();
    expect(recordBlock("o", { now: NOW + 9 * DAY, file }).decision.value).toBe("wait");
    expect(recordBlock("x", { now: NOW + 9 * DAY, file }).decision).toBeUndefined(); // per account
  });
  test("a pre-TTL store with the decision inside the record is migrated", () => {
    writeFileSync(file, JSON.stringify({ version: 1, repos: { o: {
      detectedAt: new Date(NOW).toISOString(), resetAt: "2026-11-01T00:00:00.000Z",
      decision: { value: "skip-checks", decidedAt: new Date(NOW).toISOString() },
    } } }));
    expect(readRecord("o", { now: NOW + 10 * DAY, file }).decision.value).toBe("skip-checks");
  });
  test("a per-repo store folds into the account; an answer without validUntil lasts its month", () => {
    writeFileSync(file, JSON.stringify({ version: 1,
      repos: {
        "o/app": { detectedAt: "2026-10-20T12:00:00.000Z", resetAt: "2026-11-01T00:00:00.000Z" },
        "o/web": { detectedAt: "2026-10-18T12:00:00.000Z", resetAt: "2026-11-01T00:00:00.000Z" },
      },
      decisions: { "o/app": { value: "skip-checks", decidedAt: "2026-10-21T14:52:17.159Z" } },
    }));
    const rec = readRecord("o", { now: Date.parse("2026-10-29T10:00:00Z"), file });
    expect(rec.detectedAt).toBe("2026-10-18T12:00:00.000Z");
    expect(rec.decision.value).toBe("skip-checks");
    expect(rec.decision.expiresAt).toBe("2026-11-01T00:00:00.000Z");
    recordBlock("o", { now: Date.parse("2026-10-29T10:00:00Z"), file });
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).repos)).toEqual(["o"]);
  });
});

describe("disabledWorkflows records (#949)", () => {
  const ids = [{ id: 1, name: "Test", path: ".github/workflows/test.yml" }];
  test("old stores read as empty and keep their other data", () => {
    writeFileSync(file, JSON.stringify({ version: 1, repos: { o: { detectedAt: "x", resetAt: "2026-11-01T00:00:00.000Z" } } }));
    expect(listDisabled({ file })).toEqual({});
    expect(readRecord("o", { now: NOW, file })).not.toBeNull();
  });
  test("lifecycle: write-ahead, merge, state flip, drop", () => {
    expect(recordDisabled("o/r", { ids, until: "2026-11-01T00:00:00.000Z", now: NOW, file }).state).toBe("pending-disable");
    expect(readDisabled("o/r", { file }).ids).toEqual(ids);
    recordDisabled("o/r", { ids: [...ids, { id: 2, name: "B", path: "b" }], now: NOW + 1, file });
    expect(readDisabled("o/r", { file }).ids.map(i => i.id)).toEqual([1, 2]);
    expect(readDisabled("o/r", { file }).disabledAt).toBe(new Date(NOW).toISOString());
    expect(setDisabledState("o/r", "disabled", { file }).state).toBe("disabled");
    expect(() => setDisabledState("o/r", "bogus", { file })).toThrow();
    expect(dropDisabled("o/r", { file })).toBe(true);
    expect(readDisabled("o/r", { file })).toBeNull();
    expect(dropDisabled("o/r", { file })).toBe(false);
  });
  test("block, decision and probe writes keep the records (another session rewrites the file)", () => {
    recordDisabled("o/r", { ids, now: NOW, file });
    recordBlock("o", { now: NOW, file });
    setDecision("o", "skip-checks", { now: NOW, file });
    clearRecord("o", { file });
    revokeDecision("o", { file });
    expect(readDisabled("o/r", { file }).ids).toEqual(ids);
  });
});
