import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildResumeInstruction, sentinelAgeMin } from "./ss.ship.resume.js";
import { SENTINEL_MAX_AGE_MS } from "../lib/ship-sentinel.js";

// A ship that is mid-pipeline when the context compacts (or the session is
// paused) must be re-entered from the REAL git/gh state, never from memory —
// re-running a landed step means a second PR or tag. The sentinel says a ship
// is running; this hook turns that into the one instruction that keeps it safe.
describe("ss.ship.resume", () => {
  let dir;
  const sentinel = (ts) => {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", ".ship-in-progress"), JSON.stringify({ ts, pid: 1 }));
  };
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-resume-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test("silent without a sentinel — the normal session start", () => {
    expect(buildResumeInstruction({ cwd: dir, source: "startup" })).toBeNull();
    expect(buildResumeInstruction({ cwd: dir, source: "compact" })).toBeNull();
    expect(buildResumeInstruction({ cwd: "", source: "compact" })).toBeNull();
  });

  test("an active sentinel after a compaction → verify-then-re-enter instruction", () => {
    sentinel(Date.now() - 7 * 60000);
    const out = buildResumeInstruction({ cwd: dir, source: "compact" });
    expect(out).toContain("[ss.ship.resume]");
    expect(out).toContain("just compacted");
    expect(out).toContain("7 min ago");
    expect(out).toContain("gh pr list");
    expect(out).toContain('Skill("devops:do-ship")');
    expect(out).toContain("Never create a second PR");
    expect(out).toContain("ship_cleanup({ keep: true");
  });

  test("resume and startup name their own trigger", () => {
    sentinel(Date.now());
    expect(buildResumeInstruction({ cwd: dir, source: "resume" })).toContain("just resumed");
    expect(buildResumeInstruction({ cwd: dir, source: "startup" })).toContain("just started");
  });

  test("a stale sentinel (crashed ship, aged out) is not a ship to resume", () => {
    sentinel(Date.now() - SENTINEL_MAX_AGE_MS - 1000);
    expect(buildResumeInstruction({ cwd: dir, source: "compact" })).toBeNull();
  });

  test("sentinelAgeMin reads the timestamp, null on garbage", () => {
    sentinel(Date.now() - 3 * 60000);
    expect(sentinelAgeMin(dir)).toBe(3);
    fs.writeFileSync(path.join(dir, ".claude", ".ship-in-progress"), "not json");
    expect(sentinelAgeMin(dir)).toBeNull();
  });
});
