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

describe("rerouteUserChecks (#643)", () => {
  test("detects verification activities in DE and EN", () => {
    for (const s of ["Sichtprüfung im echten Holodeck", "Manueller Test auf dem Handy", "visual check of the dialog", "Browser-Test der Seite", "manual verification by the user"]) {
      expect(vg.isVerificationActivity(s)).toBe(true);
    }
    for (const s of ["Merken pro Account", "Skip by tap or voice", "Dark mode toggle"]) {
      expect(vg.isVerificationActivity(s)).toBe(false);
    }
  });

  test("moves a not-met user-waiting check to userFinalTest and marks it met", () => {
    const params = { variant: "ready", validation: [
      { requirement: "Sichtprüfung im Browser", status: "partial", waitsOn: "user", evidence: "Login nötig" },
      { requirement: "Merken pro Account", status: "partial", waitsOn: "user", evidence: "localStorage" },
    ] };
    const { moved } = vg.rerouteUserChecks(params);
    expect(moved).toEqual(["Sichtprüfung im Browser"]);
    expect(params.validation[0]).toMatchObject({ status: "met", rerouted: "userTest" });
    expect(params.validation[0].waitsOn).toBeUndefined();
    expect(params.validation[1].status).toBe("partial");
    expect(params.userFinalTest).toEqual(["Sichtprüfung im Browser"]);
    expect(vg.classify(params.validation).waiting.user).toBe(1);
  });

  test("a test card gets it in userTest, without duplicates", () => {
    const params = { variant: "test", userTest: ["sichtprüfung im browser"], validation: [
      { requirement: "Sichtprüfung im Browser", status: "unmet", waitsOn: "user", evidence: "x" },
    ] };
    vg.rerouteUserChecks(params);
    expect(params.userTest).toEqual(["sichtprüfung im browser"]);
    expect(params.userFinalTest).toBeUndefined();
  });

  test("leaves met items, other waits and own gaps alone", () => {
    const params = { variant: "ready", validation: [
      { requirement: "Visual check passes", status: "met", evidence: "ok" },
      { requirement: "Manual test after deploy", status: "partial", waitsOn: "deploy", evidence: "restart" },
      { requirement: "Browser test", status: "partial", evidence: "todo" },
    ] };
    const { moved } = vg.rerouteUserChecks(params);
    expect(moved).toEqual([]);
    expect(params.userFinalTest).toBeUndefined();
  });
});
