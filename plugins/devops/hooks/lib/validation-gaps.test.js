import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const vg = createRequire(import.meta.url)("./validation-gaps.js");

describe("classify", () => {
  test("met counts, waiting items need evidence, the rest is an own gap", () => {
    const r = vg.classify([
      { requirement: "A", status: "met" },
      { requirement: "B", status: "partial", waitsOn: "user", evidence: "Anhören" },
      { requirement: "C", status: "partial", waitsOn: "user" },
      { requirement: "D", status: "unmet" },
      { requirement: "E" },
    ], { openTasks: 1 });
    expect(r.met).toBe(1);
    expect(r.waiting.user).toBe(1);
    expect(r.gaps.map(g => g.reason)).toEqual(["no-evidence", "open", "no-status"]);
  });

  test("delivered but only user-verifiable is met — no gap, nothing waiting (#631)", () => {
    const r = vg.classify([
      { requirement: "Skip by tap or voice", status: "met", evidence: "tap verified in tests; voice: user checks on the phone (userTest)" },
    ], { openTasks: 0 });
    expect(r.met).toBe(1);
    expect(r.waiting.user || 0).toBe(0);
    expect(r.gaps).toEqual([]);
  });

  test("pending is stale once no task is open, taken at its word when unknown", () => {
    const items = [{ requirement: "Review", status: "partial", waitsOn: "pending", evidence: "redteam" }];
    expect(vg.classify(items, { openTasks: 0 }).gaps[0].reason).toBe("pending-done");
    expect(vg.classify(items, { openTasks: null }).gaps).toEqual([]);
  });
});

describe("checkout copy for ship_release", () => {
  test("round trip, removal on an empty list, age limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-"));
    try {
      vg.writeRepoOpen("/repo/x", [{ requirement: "R", status: "partial" }], dir);
      expect(vg.readRepoOpen("/repo/x", { dir })).toHaveLength(1);
      expect(vg.readRepoOpen("/repo/x", { dir, now: Date.now() + vg.REPO_FLAG_MAX_AGE_MS + 1 })).toBeNull();
      vg.writeRepoOpen("/repo/x", [], dir);
      expect(vg.readRepoOpen("/repo/x", { dir })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform === "win32")("a Git-Bash path and a native path share one key", () => {
    const a = vg.repoFlagPath("/c/Users/me/proj");
    expect(vg.repoFlagPath("C:\\Users\\me\\proj\\")).toBe(a);
    expect(vg.repoFlagPath("c:/users/ME/proj")).toBe(a);
  });
});
