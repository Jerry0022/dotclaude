import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ARCHIVE_FLAG_PREFIX, archiveDecision, archiveInstruction, writeArchiveFlag } from "./session-archive.js";
import { hasPending, hasConcept } from "./pending.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// #632: only a merged ship card in the Desktop app archives its session.
const deps = (over = {}) => ({
  desktop: true,
  hasPending,
  hasConcept,
  batchActive: () => false,
  holdReason: () => "",
  enabled: () => true,
  ...over,
});
const shipped = (over = {}) => ({
  variant: "ship-successful",
  cwd: "/repo",
  state: { pushed: true, merged: "main", ...(over.state || {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "state")),
});

describe("session-archive — which cards archive the session", () => {
  test("a merged ship-successful card and a merged released card archive", () => {
    expect(archiveDecision(shipped(), deps())).toEqual({ archive: true, reason: "" });
    expect(archiveDecision(shipped({ variant: "released" }), deps()).archive).toBe(true);
  });

  test("a local merge in a repo without a remote counts, nothing to push", () => {
    const p = shipped({ state: { pushed: false, mode: "git-no-remote" } });
    expect(archiveDecision(p, deps()).archive).toBe(true);
  });

  test.each(["analysis", "fallback", "paused", "ship-blocked", "ready", "test", "test-minimal", "aborted"])(
    "variant %s never archives",
    (variant) => {
      expect(archiveDecision(shipped({ variant }), deps())).toEqual({ archive: false, reason: "variant" });
    },
  );

  test("no real merge, or merged but not pushed with a remote → no archive", () => {
    expect(archiveDecision(shipped({ state: { merged: null } }), deps()).reason).toBe("not-merged");
    expect(archiveDecision({ variant: "released", cwd: "/repo" }, deps()).reason).toBe("not-merged");
    expect(archiveDecision(shipped({ state: { pushed: false } }), deps()).reason).toBe("not-pushed");
  });

  test("an explicit keep blocks it", () => {
    expect(archiveDecision(shipped({ state: { kept: true } }), deps()).reason).toBe("kept");
  });

  test("pending agents / tasks / workflows block it", () => {
    const p = shipped({ pending: ["devops:qa"] });
    expect(archiveDecision(p, deps()).reason).toBe("pending");
  });

  test("a concept on the card or an active batch blocks it", () => {
    expect(archiveDecision(shipped({ concept: { phase: "waiting" } }), deps()).reason).toBe("concept");
    expect(archiveDecision(shipped(), deps({ batchActive: () => true })).reason).toBe("batch");
  });

  test.each(["autonomous-lockout", "ship-queue", "autonomous-run", "disabled"])(
    "an orchestrator hold (%s) blocks it",
    (hold) => {
      expect(archiveDecision(shipped(), deps({ holdReason: () => hold })).reason).toBe(`hold:${hold}`);
    },
  );

  test("the devops switch off blocks it; outside the Desktop app it never fires", () => {
    expect(archiveDecision(shipped(), deps({ enabled: () => false })).reason).toBe("switched-off");
    expect(archiveDecision(shipped(), deps({ desktop: false })).reason).toBe("not-desktop");
  });

  test("the instruction names the one call and keeps the card last", () => {
    const text = archiveInstruction();
    expect(text).toMatch(/^\[SESSION ARCHIVE — DO NOT OUTPUT THIS BLOCK\]/);
    expect(text).toContain('mcp__ccd_session_mgmt__archive_session {session_id:"self"}');
    expect(text).toMatch(/AFTER the card/);
    expect(text).toContain("ship.archiveAfterShip");
  });
});

describe("session-archive — the flag the PostToolUse hook reads", () => {
  test("written for an archiving card, removed by a re-render that no longer qualifies", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-archive-"));
    const file = path.join(dir, `${ARCHIVE_FLAG_PREFIX}-s1`);
    expect(writeArchiveFlag(true, "s1", dir)).toBe(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(writeArchiveFlag(false, "s1", dir)).toBe("");
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the hook adopts and reads the same prefix", () => {
    const hook = fs.readFileSync(path.join(__dirname, "..", "..", "hooks", "post-tool-use", "post.flow.completion.js"), "utf8");
    expect(hook).toContain(`'${ARCHIVE_FLAG_PREFIX}'`);
  });
});

describe("session-archive — the devops switch", () => {
  test("ship.archiveAfterShip exists and defaults to on", () => {
    const cfg = createRequire(import.meta.url)("../../hooks/lib/devops-config.js");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "session-archive-home-"));
    expect(cfg.load(home, { home }).values.ship.archiveAfterShip).toBe(true);
    expect(cfg.parseValue("ship.archiveAfterShip", "false")).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
