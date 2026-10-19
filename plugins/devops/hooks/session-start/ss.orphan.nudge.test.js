import { describe, test, expect } from "vitest";
import { buildNudge } from "./ss.orphan.nudge.js";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const report = (repos, generatedAt = "2026-10-19T06:00:00Z") => ({ generatedAt, repos });
const risk = (dirty = 0) => ({ kind: "branch", branch: "x", dirty });

describe("ss.orphan.nudge", () => {
  const repos = [{ path: "C:/r/app", atRisk: [risk(), risk(), risk(0), { kind: "worktree", dirty: 2 }, { kind: "worktree", dirty: 1 }] }];

  test("German line with both counts for the current repo", () => {
    expect(buildNudge({ cwd: "C:/r/app", report: report(repos), now: NOW }))
      .toBe("⚠ 3 ungelandete Branches / 2 Worktrees mit uncommitteter Arbeit → /auto-cleanup");
  });

  test("English line, worktree below the main checkout matches by prefix", () => {
    expect(buildNudge({ cwd: "C:\\r\\app\\.claude\\worktrees\\x", lang: "en", report: report(repos), now: NOW }))
      .toBe("⚠ 3 unlanded branches / 2 worktrees with uncommitted work → /auto-cleanup");
  });

  test("silent: unknown repo, nothing at risk, stale or missing report", () => {
    expect(buildNudge({ cwd: "C:/r/other", report: report(repos), now: NOW })).toBeNull();
    expect(buildNudge({ cwd: "C:/r/app", report: report([{ path: "C:/r/app", atRisk: [] }]), now: NOW })).toBeNull();
    expect(buildNudge({ cwd: "C:/r/app", report: report(repos, "2026-10-01T00:00:00Z"), now: NOW })).toBeNull();
    expect(buildNudge({ cwd: "C:/r/app", report: null, now: NOW })).toBeNull();
  });

  test("a prefix that is only a name prefix does not match (app vs app2)", () => {
    expect(buildNudge({ cwd: "C:/r/app2", report: report(repos), now: NOW })).toBeNull();
  });
});
