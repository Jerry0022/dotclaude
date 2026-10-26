import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeCiQuota, classifyRuns } from "./ci-quota-probe.js";
import { readRecord, recordBlock, readProbe } from "./ci-quota.js";

const BILLING = [{ annotation_level: "failure", message: "The job was not started because recent account payments have failed or your spending limit needs to be increased." }];
const REAL = [{ annotation_level: "failure", message: "Process completed with exit code 1." }];

/** A fake `gh api` over one run with the given conclusion and annotations. */
function fakeApi({ status = "completed", conclusion = "failure", annotations = BILLING, created = "2026-10-26T10:00:00Z", jobs } = {}) {
  return (p) => {
    if (p.includes("/actions/runs?")) return { workflow_runs: [{ id: 1, status, conclusion, created_at: created }] };
    if (p.endsWith("/jobs")) return { jobs: jobs || [{ id: 11, status, conclusion, steps: [] }] };
    if (p.endsWith("/annotations")) return annotations;
    throw new Error(`unexpected ${p}`);
  };
}

let dir;
let file;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cqp-")); file = join(dir, "q.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("early CI-quota probe", () => {
  test("a billing-blocked run → exhausted, block recorded (ship_build then runs the full suite)", () => {
    const res = probeCiQuota("/repo", { key: "acct", file, api: fakeApi() });
    expect(res.status).toBe("exhausted");
    expect(res.recorded).toBe(true);
    expect(readRecord("acct", { file })).not.toBeNull();
  });

  test("healthy runs → no block; a newer healthy run clears an older block", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(probeCiQuota("/repo", { key: "a1", file, now, api: fakeApi({ conclusion: "success" }) }).status).toBe("healthy");
    expect(readRecord("a1", { file, now })).toBeNull();

    recordBlock("a2", { file, now: Date.parse("2026-10-26T09:00:00Z") });
    const res = probeCiQuota("/repo", { key: "a2", file, now, api: fakeApi({ conclusion: "failure", annotations: REAL }) });
    expect(res.status).toBe("healthy");
    expect(res.cleared).toBe(true);
    expect(readRecord("a2", { file, now })).toBeNull();
  });

  test("a healthy run OLDER than the block never clears it", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    recordBlock("a3", { file, now: Date.parse("2026-10-26T11:00:00Z") });
    probeCiQuota("/repo", { key: "a3", file, now, api: fakeApi({ conclusion: "success", created: "2026-10-26T10:00:00Z" }) });
    expect(readRecord("a3", { file, now })).not.toBeNull();
  });

  test("REGRESSION (review): an unreadable annotation fetch is unknown and never clears a block", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    recordBlock("a5", { file, now: Date.parse("2026-10-26T09:00:00Z") });
    const api = (p) => {
      if (p.endsWith("/annotations")) throw new Error("HTTP 502");
      return fakeApi()(p);
    };
    const res = probeCiQuota("/repo", { key: "a5", file, now, api });
    expect(res.status).toBe("unknown");
    expect(res.cleared).toBeUndefined();
    expect(readRecord("a5", { file, now })).not.toBeNull();
  });

  test.each(["skipped", "neutral", "stale", "action_required"])(
    "REGRESSION (review): a %s run proves nothing — no healthy verdict, the block stays",
    (conclusion) => {
      const now = Date.parse("2026-10-26T12:00:00Z");
      recordBlock("a6", { file, now: Date.parse("2026-10-26T09:00:00Z") });
      const res = probeCiQuota("/repo", { key: "a6", file, now, force: true, api: fakeApi({ conclusion }) });
      expect(res.status).toBe("unknown");
      expect(readRecord("a6", { file, now })).not.toBeNull();
    },
  );

  test("probe errors → unknown, no block", () => {
    const res = probeCiQuota("/repo", { key: "a4", file, api: () => { throw new Error("gh: not found"); } });
    expect(res.status).toBe("unknown");
    expect(readRecord("a4", { file })).toBeNull();
    expect(probeCiQuota("/repo", { key: null, file }).status).toBe("unknown");
  });

  test("the verdict is cached ~10 min; force bypasses the cache", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    probeCiQuota("/repo", { key: "a5", file, now, api: fakeApi({ conclusion: "success" }) });
    expect(readProbe("a5", { file, now }).status).toBe("healthy");
    const cached = probeCiQuota("/repo", { key: "a5", file, now: now + 60_000, api: fakeApi() });
    expect(cached).toMatchObject({ status: "healthy", cached: true });
    expect(probeCiQuota("/repo", { key: "a5", file, now: now + 60_000, force: true, api: fakeApi() }).status).toBe("exhausted");
    expect(readProbe("a5", { file, now: now + 11 * 60_000 })).toBeNull();
  });

  test("queued runs say nothing; an in-progress job is healthy", () => {
    expect(classifyRuns(fakeApi({ status: "queued", jobs: [{ id: 1, status: "queued", steps: [] }] })).status).toBe("unknown");
    expect(classifyRuns(fakeApi({ status: "in_progress", jobs: [{ id: 1, status: "in_progress", steps: [{ status: "in_progress" }] }] })).status).toBe("healthy");
  });
});
