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

  // AUD-011: a card rendered with an EXPLICIT, genuinely different session
  // id must not show another session's contract.
  describe("AUD-011: session ownership", () => {
    test("a foreign session id → null", () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", "someone-else")).toBeNull();
    });

    test("the owning session id → renders the card", () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", "owner-session")).toMatch(/^🧾 Run · Prompt/);
    });
  });

  // R9: the model never sends the harness's real session id on
  // render_completion_card — it sends "self", a Desktop `local_…` id, or
  // nothing. None of the three can be a genuine foreign session's id, so
  // they must resolve to the owning session, not be hidden by AUD-011.
  describe("R9: self/local_/missing session markers resolve to the owner", () => {
    test("missing (null) session id + a header that stores one → still renders", () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", null)).toMatch(/^🧾 Run · Prompt/);
    });

    test('"self" (ccd_session convention) → renders', () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", "self")).toMatch(/^🧾 Run · Prompt/);
    });

    test("a Desktop local_… id → renders", () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", "local_abc123")).toMatch(/^🧾 Run · Prompt/);
    });

    test("a truly foreign session id still hides the line", () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", "some-other-real-session")).toBeNull();
    });
  });

  // RT2-Q4: the lenient path (no sessionId / "self" / local_…) used to accept
  // ANY stored sessionId, so a run-contract.json Desktop copied from the
  // main checkout into a fresh worktree rendered the OTHER worktree's run
  // line here too. The header now carries `root` (the work-tree root arm()
  // ran in); the lenient path hides the line when it does not match this
  // card's own cwd.
  describe("RT2-Q4: worktree-root guard on the lenient path", () => {
    function headerFile(dir) { return path.join(dir, ".claude", "run-contract.json"); }
    function rewriteHeader(dir, mutate) {
      const h = JSON.parse(fs.readFileSync(headerFile(dir), "utf8"));
      mutate(h);
      fs.writeFileSync(headerFile(dir), JSON.stringify(h));
    }

    test("a header copied from another worktree (different root) + \"self\" → hidden", () => {
      const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mode-state-other-root-"));
      try {
        RC.arm(cwd, { mode: "prompt", flow: "interactive" });
        RC.record(cwd, { k: "edit" });
        rewriteHeader(cwd, (h) => { h.root = otherRoot; });
        expect(readRunContractLine(cwd, "de", "self")).toBeNull();
        expect(readRunContractLine(cwd, "de", null)).toBeNull();
        expect(readRunContractLine(cwd, "de", "local_abc123")).toBeNull();
      } finally {
        try { fs.rmSync(otherRoot, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    });

    test("a header whose stored root matches this cwd + \"self\" → still renders", () => {
      RC.arm(cwd, { mode: "prompt", flow: "interactive" });
      RC.record(cwd, { k: "edit" });
      expect(readRunContractLine(cwd, "de", "self")).toMatch(/^🧾 Run · Prompt/);
    });

    test("a header without `root` (written before this change) → unchanged lenient behaviour", () => {
      RC.arm(cwd, { mode: "prompt", flow: "interactive" });
      RC.record(cwd, { k: "edit" });
      rewriteHeader(cwd, (h) => { delete h.root; });
      expect(readRunContractLine(cwd, "de", "self")).toMatch(/^🧾 Run · Prompt/);
    });

    test("a genuinely foreign session id (strict path) is unaffected by root", () => {
      RC.arm(cwd, { mode: "prompt", sessionId: "owner-session" });
      RC.record(cwd, { k: "edit" });
      // Strict path already hides this — root must not be what decides it.
      expect(readRunContractLine(cwd, "de", "some-other-real-session")).toBeNull();
    });
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
