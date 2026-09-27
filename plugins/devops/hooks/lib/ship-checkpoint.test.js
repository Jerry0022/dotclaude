import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import cp from "./ship-checkpoint.js";
import resume from "./ship-resume.js";

// A ship that dies half-way (usage limit, crash) must resume at the first step
// that did not finish — never repeat a bump, PR or tag, never re-ask a
// decision. The ship server records every step itself (recordShipStep).
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-cp-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const preflight = (branch = "feat/x") => cp.recordShipStep("ship_preflight", { cwd: root }, { ready: true, branch, base: "main" });

describe("ship-checkpoint — the ship server records every step", () => {
  test("preflight opens it, build/bump/release fill it, cleanup removes it", () => {
    preflight();
    expect(cp.nextStep(cp.openCheckpoint(root))).toBe("build");
    cp.recordShipStep("ship_build", { cwd: root }, { success: true, buildId: "abc123" });
    cp.recordShipStep("ship_version_bump", { cwd: root }, { success: true, bump: "minor", vOld: "1.0.0", vNew: "1.1.0" });
    const mid = cp.openCheckpoint(root);
    expect(mid.steps.bump).toEqual({ bump: "minor", vOld: "1.0.0", vNew: "1.1.0" });
    expect(cp.nextStep(mid)).toBe("release");
    expect(cp.describeCheckpoint(mid)).toBe("preflight ✓ · build ✓ · bump 1.0.0 → 1.1.0 ✓ · release ← next");
    cp.recordShipStep("ship_release", { cwd: root }, { success: true, commit: "25fbcf0", pr: { number: 42, url: "u" }, merged: "main", tag: "alpha/v1.1.0" });
    const done = cp.openCheckpoint(root);
    expect(done.steps.release).toMatchObject({ pr: 42, merged: "main", tag: "alpha/v1.1.0" });
    expect(cp.nextStep(done)).toBe("cleanup");
    cp.recordShipStep("ship_cleanup", { cwd: root }, { success: true });
    expect(cp.readCheckpoint(root)).toBeNull();
  });

  test("a release that failed after the PR keeps the PR, is not done, and names the error", () => {
    preflight();
    cp.recordShipStep("ship_release", { cwd: root }, { success: false, commit: "abc", pr: { number: 7 }, error: "checks timed out" });
    const c = cp.openCheckpoint(root);
    expect(c.steps.release).toEqual({ commit: "abc", pr: 7 });
    expect(cp.nextStep(c)).toBe("build");
    expect(c.lastError).toMatchObject({ tool: "ship_release", error: "checks timed out" });
  });

  test("a failed build or an untouched bump records nothing; buildIdOnly is no build", () => {
    preflight();
    cp.recordShipStep("ship_build", { cwd: root }, { success: false });
    cp.recordShipStep("ship_build", { cwd: root, buildIdOnly: true }, { success: true, buildId: "x" });
    cp.recordShipStep("ship_version_bump", { cwd: root }, { success: false, vNew: "2.0.0", filesUpdated: [] });
    expect(cp.openCheckpoint(root).steps).toEqual({ preflight: true });
  });

  test("a bump that rewrote files but failed verification counts as landed — never bumped twice", () => {
    // Observed in the e2e sandbox (2026-09-27): package.json at 1.2.0, the
    // CHANGELOG still at 1.1.0 → success:false. Bumping again would ship 1.3.0.
    preflight();
    cp.recordShipStep("ship_version_bump", { cwd: root }, {
      success: false, bump: "minor", vOld: "1.1.0", vNew: "1.2.0", verified: false,
      filesUpdated: [{ file: "package.json", updated: true }],
      mismatches: [{ file: "CHANGELOG.md", expected: "1.2.0", found: "1.1.0" }],
    });
    const c = cp.openCheckpoint(root);
    expect(c.steps.bump).toMatchObject({ vNew: "1.2.0", verified: false, mismatches: [{ file: "CHANGELOG.md" }] });
    expect(cp.nextStep(c)).toBe("build");
    expect(cp.describeCheckpoint(c)).toContain("bump 1.1.0 → 1.2.0 ✓");
  });

  test("a resumed preflight keeps the landed steps — it never resets the ship", () => {
    preflight();
    cp.recordShipStep("ship_version_bump", { cwd: root }, { success: true, bump: "patch", vOld: "1.0.0", vNew: "1.0.1" });
    preflight();
    expect(cp.openCheckpoint(root).steps.bump.vNew).toBe("1.0.1");
  });

  test("another branch starts a fresh checkpoint", () => {
    preflight("feat/a");
    cp.recordShipStep("ship_version_bump", { cwd: root }, { success: true, vOld: "1", vNew: "2" });
    preflight("feat/b");
    const c = cp.openCheckpoint(root);
    expect(c.branch).toBe("feat/b");
    expect(c.steps).toEqual({ preflight: true });
  });

  test("steps without a preflight in this ship are not tracked; a failed cleanup keeps it", () => {
    cp.recordShipStep("ship_build", { cwd: root }, { success: true });
    expect(cp.readCheckpoint(root)).toBeNull();
    preflight();
    cp.recordShipStep("ship_cleanup", { cwd: root }, { success: false });
    expect(cp.openCheckpoint(root)).not.toBeNull();
  });

  test("a copy in another work tree (Desktop seeds .claude/) or an old one is not open", () => {
    preflight();
    const data = cp.readCheckpoint(root);
    cp.writeCheckpoint(root, { ...data, root: path.join(root, "..", "elsewhere") });
    expect(cp.openCheckpoint(root)).toBeNull();
    cp.writeCheckpoint(root, { ...data });
    expect(cp.openCheckpoint(root, { now: Date.now() + cp.MAX_AGE_MS + 1000 })).toBeNull();
    expect(cp.openCheckpoint(root, { branch: "other" })).toBeNull();
    expect(cp.openCheckpoint(root, { branch: "feat/x" })).not.toBeNull();
  });

  test("brief and decisions persist for the resumed run; the first brief wins", () => {
    preflight();
    expect(cp.setBrief(root, "Intent: X")).toBe(true);
    cp.setBrief(root, "Intent: Y");
    expect(cp.addDecision(root, "Bump?", "minor")).toBe(true);
    const c = cp.openCheckpoint(root);
    expect(c.brief).toBe("Intent: X");
    expect(c.delegated).toBe(true);
    expect(c.decisions).toEqual([{ question: "Bump?", answer: "minor" }]);
    cp.setBrief(root, "Intent: Z", { replace: true });
    expect(cp.openCheckpoint(root).brief).toBe("Intent: Z");
  });

  test("never throws — not even on garbage input", () => {
    expect(() => cp.recordShipStep("ship_build", null, null)).not.toThrow();
    expect(() => cp.recordShipStep("ship_build", { cwd: root }, "x")).not.toThrow();
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(cp.checkpointPath(root), "{not json");
    expect(cp.openCheckpoint(root)).toBeNull();
  });
});

describe("ship-resume — which prompt picks the ship up", () => {
  test("continuations, affirmations and ship prompts resume an open ship", () => {
    preflight();
    for (const p of ["weiter", "mach weiter", "Weitermachen bitte", "continue", "Continue from where you left off.", "resume", "ja", "ship", "/do-ship", "fortsetzen"]) {
      expect(resume.shipResumeFor(p, root), p).not.toBeNull();
    }
    expect(resume.shipResumeFor("weiter", root).next).toBe("build");
  });

  test("new work does not resume it, and nothing resumes without a checkpoint", () => {
    preflight();
    for (const p of ["erklär mir den Fehler in der Karte", "weiter so, aber jetzt bau mir ein neues Feature mit vielen Details und Tests für die Suche", ""]) {
      expect(resume.shipResumeFor(p, root), p).toBeNull();
    }
    cp.clearCheckpoint(root);
    expect(resume.shipResumeFor("weiter", root)).toBeNull();
  });
});
