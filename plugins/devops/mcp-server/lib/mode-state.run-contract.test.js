import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRunContractLine, hookRequire } from "./mode-state.js";
import * as RC from "../../hooks/lib/run-contract.js";

// `readRunContractLine` is a pure read of the do-run run-contract state
// (spec `2026-09-24-run-contract-design.md` § J) — no git, every failure
// swallowed to null, so a card can never die on a missing or corrupt
// `.claude/run-contract.json`. Fixtures go through the lib's own `arm` /
// `record` so the on-disk shape never drifts from what the hooks write.

let cwd;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mode-state-run-contract-")); });
afterEach(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ } });

describe("readRunContractLine", () => {
  test("no contract at all → null", () => {
    expect(readRunContractLine(cwd)).toBeNull();
  });

  test("no cwd → null", () => {
    expect(readRunContractLine(undefined)).toBeNull();
  });

  test("an active backlog contract renders the card line, de and en", () => {
    RC.arm(cwd, {
      mode: "backlog", flow: "autonomous", ship: "auto", strict: false,
      passes: ["harden", "polish"], presence: true, items: ["483"],
    });
    RC.record(cwd, { k: "agent", type: "general-purpose" });
    RC.record(cwd, { k: "skill", name: "auto-agents", args: "" });
    RC.record(cwd, { k: "edit" });

    const de = readRunContractLine(cwd, "de");
    expect(de).toMatch(/^🧾 Run · Backlog · Autonom · Ship auto/);
    expect(de).toContain("auto-agents ✓");

    const en = readRunContractLine(cwd, "en");
    expect(en).toMatch(/^🧾 Run · Backlog · Autonomous · Ship auto/);
  });

  test("a corrupt run-contract.json → null, never throws", () => {
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude", "run-contract.json"), "{not json", "utf8");
    expect(() => readRunContractLine(cwd)).not.toThrow();
    expect(readRunContractLine(cwd)).toBeNull();
  });

  test("a contract closed just now still renders (15-minute card grace)", () => {
    RC.arm(cwd, { mode: "prompt", flow: "interactive", ship: "manual" });
    RC.record(cwd, { k: "edit" });
    RC.close(cwd, "done");
    expect(readRunContractLine(cwd)).toMatch(/^🧾 Run · Prompt/);
  });
});

describe("hookRequire", () => {
  test("H-G: resolves under hooks/ and throws for a missing module (every call site swallows this to null)", () => {
    expect(() => hookRequire("lib", "does-not-exist.js")).toThrow();
  });

  test("H-G: resolves a real hook module the same way the three call sites do", () => {
    expect(typeof hookRequire("lib", "run-contract.js").summaryForCard).toBe("function");
  });
});
