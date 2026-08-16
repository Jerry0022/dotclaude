import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  storeDirFor,
  readStore,
  buildVerificationMandate,
  buildDeadBridgeRecovery,
  buildResumeInstructions,
} from "./ss.concept.resume.js";

// The hook's job in a recovery is to answer one question the dead bridge
// cannot: "did the user lose work?". Before #284 it exited 0 here, so a
// submission reaped by the watchdog (which is what happens when Claude hits a
// usage limit and the session-scoped pulser dies) vanished without a trace.

let dir;

function writeStore({ submitted = true, version = 3, marker = true, progress = [], attachments = [] } = {}) {
  fs.mkdirSync(path.join(dir, "attachments"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      decisions: JSON.stringify({ submitted, action: "implement", comments: [{ id: "a", text: "hart erarbeitet" }] }),
      version,
      processed_at: "",
      picked_up_at: "2026-08-16T07:00:00.000Z",
      phase: "",
    })
  );
  if (marker) {
    fs.writeFileSync(
      path.join(dir, "UNPROCESSED"),
      JSON.stringify({ version, reason: "watchdog:heartbeat_stale", at: "2026-08-16T07:30:00.000Z" })
    );
  }
  const lines = [
    JSON.stringify({ type: "submission", seq: 1, version }),
    ...progress.map((p, i) => JSON.stringify({ type: "progress", seq: i + 2, ...p })),
  ];
  fs.writeFileSync(path.join(dir, "journal.jsonl"), lines.join("\n") + "\n");
  for (const a of attachments) fs.writeFileSync(path.join(dir, "attachments", a), "x");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "concept-store-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("storeDirFor mirrors the server's own derivation", () => {
  test("uses the HTML basename without its extension", () => {
    const d = storeDirFor("docs/concepts/2026-08-16-auth-redesign.html");
    expect(path.basename(d)).toBe("2026-08-16-auth-redesign");
    expect(d).toContain(path.join(".claude", "concepts"));
  });

  test("a drifting derivation would silently read an empty store", () => {
    // Guard against someone "simplifying" this to state.slug, which is the
    // topic slug WITHOUT the date and would point at a directory the server
    // never writes — recovery would then always report nothing pending.
    expect(path.basename(storeDirFor("docs/concepts/2026-01-02-x.html"))).not.toBe("x");
  });
});

describe("readStore works with no live server", () => {
  test("a missing store reports absent, not pending", () => {
    const s = readStore(path.join(dir, "nope"));
    expect(s.present).toBe(false);
    expect(s.unprocessed).toBe(false);
  });

  test("an unprocessed submission is detected from disk alone", () => {
    writeStore({ version: 7 });
    const s = readStore(dir);
    expect(s.present).toBe(true);
    expect(s.unprocessed).toBe(true);
    expect(s.version).toBe(7);
    expect(s.marker.reason).toBe("watchdog:heartbeat_stale");
  });

  test("an already-processed submission is not resurrected", () => {
    writeStore({ submitted: false, marker: false });
    expect(readStore(dir).unprocessed).toBe(false);
  });

  test("the payload decides, not the marker", () => {
    // A marker write can fail on a full disk while the fsynced payload is
    // fine. Trusting the marker over the payload would under-report a loss.
    writeStore({ submitted: true, marker: false });
    expect(readStore(dir).unprocessed).toBe(true);
    expect(readStore(dir).marker).toBeNull();
  });

  test("progress checkpoints and attachments are surfaced", () => {
    writeStore({
      progress: [
        { action: "implement", step: "branch-created", artifacts: { branch: "feat/x" } },
        { action: "implement", step: "pr-opened", artifacts: { pr: 42 } },
      ],
      attachments: ["aa.png", "bb.png"],
    });
    const s = readStore(dir);
    expect(s.progress).toHaveLength(2);
    expect(s.lastCheckpoint.step).toBe("pr-opened");
    expect(s.attachments).toBe(2);
  });

  test("a torn final journal line does not lose the earlier records", () => {
    // A hard kill mid-append can leave a partial last line. Losing the whole
    // journal to one bad line would defeat the point of an append-only log.
    writeStore({ progress: [{ action: "ship", step: "preflight" }] });
    fs.appendFileSync(path.join(dir, "journal.jsonl"), '{"type":"progress","step":"tor');
    expect(readStore(dir).progress).toHaveLength(1);
  });
});

describe("the verification mandate keeps auto-resume from double-shipping", () => {
  test("it names the artifacts to verify and forbids trusting them", () => {
    writeStore({ progress: [{ action: "ship", step: "pr-opened", artifacts: { pr: 42, branch: "feat/x" } }] });
    const text = buildVerificationMandate(readStore(dir));
    expect(text).toContain("VERIFY BEFORE YOU ACT");
    expect(text).toContain("gh pr view");
    expect(text).toContain("git rev-parse");
    expect(text).toMatch(/never re-merge a merged PR/i);
    expect(text).toContain('"pr":42');
  });

  test("it tells Claude the work was preserved, so the user is not asked to redo it", () => {
    writeStore();
    expect(buildVerificationMandate(readStore(dir))).toMatch(/do NOT ask them to redo it/i);
  });

  test("it says so explicitly when no checkpoint was ever written", () => {
    writeStore({ progress: [] });
    expect(buildVerificationMandate(readStore(dir))).toMatch(/died before it started processing/i);
  });

  test("attachments are pointed at so comments referencing images stay readable", () => {
    writeStore({ attachments: ["aa.png"] });
    const text = buildVerificationMandate(readStore(dir));
    expect(text).toContain("attachment");
    expect(text).toContain("Read tool");
  });
});

describe("a dead bridge is relaunched, not written off", () => {
  test("the relaunch pins the SAME port so the open tab stays valid", () => {
    writeStore();
    const text = buildDeadBridgeRecovery(
      { port: 8748, html_path: "docs/concepts/2026-08-16-x.html" },
      readStore(dir)
    );
    expect(text).toContain("concept-server.py");
    expect(text).toContain("8748");
    expect(text).toContain("/recovery");
    expect(text).toMatch(/SAME port/i);
  });

  test("both watchers are re-armed — a restored server nobody watches is the #276 trap", () => {
    writeStore();
    const text = buildDeadBridgeRecovery(
      { port: 8748, html_path: "docs/concepts/2026-08-16-x.html" },
      readStore(dir)
    );
    expect(text).toContain("--mode pulse");
    expect(text).toContain("--mode watch");
  });
});

describe("a live bridge with a half-finished run also verifies first", () => {
  const state = { port: 8700, html_path: "docs/concepts/2026-08-16-x.html", slug: "x" };

  test("a checkpoint pulls the mandate into the normal resume path", () => {
    writeStore({ progress: [{ action: "implement", step: "pr-opened", artifacts: { pr: 9 } }] });
    const text = buildResumeInstructions(state, "pending", "C:/p/.claude/concept-active.json", readStore(dir));
    expect(text).toContain("VERIFY BEFORE YOU ACT");
  });

  test("a fresh submission with no checkpoint is processed without the ceremony", () => {
    writeStore({ progress: [] });
    const text = buildResumeInstructions(state, "pending", "C:/p/.claude/concept-active.json", readStore(dir));
    expect(text).not.toContain("VERIFY BEFORE YOU ACT");
  });

  test("omitting the store keeps the legacy signature working", () => {
    expect(() => buildResumeInstructions(state, "idle")).not.toThrow();
  });
});
