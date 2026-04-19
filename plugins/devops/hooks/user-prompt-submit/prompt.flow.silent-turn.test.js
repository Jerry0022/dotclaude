import { describe, test, expect } from "vitest";
import { isSilent } from "./prompt.flow.silent-turn.js";

describe("isSilent — silent-turn prompt detector", () => {
  test("git-sync cron prompt (starts with 'Silently run via Bash')", () => {
    expect(
      isSilent('Silently run via Bash: node "C:/Users/.../scripts/git-sync.js". If output contains ⚠…'),
    ).toBe(true);
  });

  test("concept bridge cron prompt (starts with 'Silently run both steps')", () => {
    expect(
      isSilent(
        "Silently run both steps for the concept bridge on port 8734:\n(1) Heartbeat POST:\n  Bash: curl -s …",
      ),
    ).toBe(true);
  });

  test("alt phrasing 'Run silently' is detected", () => {
    expect(isSilent("Run silently: curl -s -X POST http://localhost:8734/heartbeat > /dev/null")).toBe(true);
  });

  test("autonomous-loop sentinel is detected", () => {
    expect(isSilent("<<autonomous-loop>>")).toBe(true);
  });

  test("autonomous-loop-dynamic sentinel is detected", () => {
    expect(isSilent("<<autonomous-loop-dynamic>>")).toBe(true);
  });

  test("leading whitespace does not defeat the pattern", () => {
    expect(isSilent("   Silently run something")).toBe(true);
    expect(isSilent("\n\nRun silently: ping")).toBe(true);
  });

  test("case-insensitive match", () => {
    expect(isSilent("silently run Bash: whatever")).toBe(true);
    expect(isSilent("RUN SILENTLY: curl")).toBe(true);
  });

  test("real user prompt is NOT silent", () => {
    expect(isSilent("Bitte fix den Bug in foo.ts")).toBe(false);
    expect(isSilent("Please run the tests and tell me what fails")).toBe(false);
  });

  test("prompt merely mentioning 'silently' in the middle is NOT silent", () => {
    // Anchor is at line start — we must not match user prose that happens to
    // contain the word elsewhere.
    expect(isSilent("I noticed the script runs silently in the background")).toBe(false);
  });

  test("empty / non-string input → false", () => {
    expect(isSilent("")).toBe(false);
    expect(isSilent(null)).toBe(false);
    expect(isSilent(undefined)).toBe(false);
    expect(isSilent(42)).toBe(false);
  });
});
