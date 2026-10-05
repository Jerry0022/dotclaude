import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { ARCHIVE_FLAG_PREFIX, archiveDecision, archiveInstruction, writeArchiveFlag } from "./session-archive.js";
import { hasPending, hasConcept } from "./pending.js";

// #632: only a merged ship card in the Desktop app archives its session.
const deps = (over = {}) => ({
  desktop: true,
  hasPending,
  hasConcept,
  batchActive: () => false,
  holdReason: () => "",
  enabled: () => true,
  treeClean: () => true,
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

  test("open points or user tests on the card keep the session (R7)", () => {
    expect(archiveDecision(shipped({ open: ["Decide X"] }), deps()).reason).toBe("open");
    expect(archiveDecision(shipped({ userTest: [{ step: "click" }] }), deps()).reason).toBe("user-test");
    expect(archiveDecision(shipped({ open: [], userTest: [] }), deps()).archive).toBe(true);
  });

  test("a missing cwd fails closed (R6)", () => {
    expect(archiveDecision(shipped({ cwd: "" }), deps()).reason).toBe("no-cwd");
    expect(archiveDecision({ ...shipped(), cwd: undefined }, deps()).reason).toBe("no-cwd");
  });

  test("a dirty work tree fails closed (R1)", () => {
    expect(archiveDecision(shipped(), deps({ treeClean: () => false })).reason).toBe("dirty-tree");
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
    expect(writeArchiveFlag(true, "s1", dir, { cwd: "/repo" })).toBe(file);
    const stamp = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(stamp.cwd).toBe("/repo");
    expect(stamp.nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(writeArchiveFlag(true, "s2", dir)).toBe("");
    expect(fs.existsSync(path.join(dir, `${ARCHIVE_FLAG_PREFIX}-s2`))).toBe(false);
    expect(writeArchiveFlag(false, "s1", dir)).toBe("");
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the hook gate reads what the MCP writes: stamp, work tree, clean tree", () => {
    const gate = createRequire(import.meta.url)("../../hooks/lib/session-archive-gate.js");
    expect(gate.FLAG).toBe(ARCHIVE_FLAG_PREFIX);
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "session-archive-repo-"));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "session-archive-other-"));
    const git = (cwd, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
    for (const d of [repo, other]) { git(d, "init", "-q"); git(d, "commit", "-q", "--allow-empty", "-m", "init"); }
    writeArchiveFlag(true, "s3", repo, { cwd: repo });
    const flag = path.join(repo, `${ARCHIVE_FLAG_PREFIX}-s3`);
    fs.appendFileSync(path.join(repo, ".git", "info", "exclude"), `\n${ARCHIVE_FLAG_PREFIX}-*\n`);
    expect(gate.flagBelongsTo(flag, path.join(repo))).toBe(true);
    expect(gate.flagBelongsTo(flag, other)).toBe(false);
    // Ignored files are accepted; untracked and tracked changes are not.
    expect(gate.treeClean(repo)).toBe(true);
    fs.writeFileSync(path.join(repo, "new.txt"), "x");
    expect(gate.treeClean(repo)).toBe(false);
    expect(gate.treeClean(path.join(repo, "missing"))).toBe(false);
    expect(gate.treeClean("")).toBe(false);
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
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
