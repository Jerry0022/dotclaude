/**
 * run-contract-store.js unit tests for the 2026-09-25 audit follow-ups that
 * touch only the store (AUD-017 close-always-wins, AUD-018 events cap,
 * AUD-011 CARD-path ownership). AUD-022 (corrupt header quarantine) is
 * covered in run-contract.test.js next to the test it replaces.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("./run-contract-store.js");
const RC = require("./run-contract.js");

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-contract-store-"));
  const r = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  return dir;
}

let cwd;
beforeEach(() => { cwd = repo(); });
afterEach(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ } });

const T0 = Date.parse("2026-09-25T09:00:00Z");
const lockFile = (c) => `${store.contractPath(c)}.lock`;

describe("AUD-017: update() vs close() mutual exclusion", () => {
  test("close() is never overwritten by an update() that could not get the lock in time", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    // Simulate another process holding the header lock.
    fs.writeFileSync(lockFile(cwd), "other-pid");
    const patched = store.update(cwd, { mode: "audit" }, { now: T0, lockWaitMs: 20 });
    expect(patched).toBeNull(); // couldn't get in — must not silently skip the lock
    fs.unlinkSync(lockFile(cwd));
    const closed = store.close(cwd, "done", { now: T0 + 1000 });
    expect(closed).not.toBeNull();
    expect(closed.closedAt).not.toBeNull();
    expect(closed.mode).toBe("prompt"); // the blocked update's patch never landed
  });

  test("update() cannot resurrect a header that already closed", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    store.close(cwd, "done", { now: T0 });
    const patched = store.update(cwd, { mode: "audit" }, { now: T0 + 1000 });
    expect(patched).toBeNull();
    const raw = store.readRawContract(cwd);
    expect(raw.closedAt).not.toBeNull();
    expect(raw.mode).toBe("prompt");
  });

  test("a stale lock (older than lockStaleMs) is recovered, not deadlocked", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    fs.writeFileSync(lockFile(cwd), "crashed-pid");
    const past = new Date(Date.now() - 5000);
    fs.utimesSync(lockFile(cwd), past, past);
    const patched = store.update(cwd, { mode: "audit" }, { now: T0 + 1000, lockStaleMs: 1000, lockWaitMs: 500 });
    expect(patched).not.toBeNull();
    expect(patched.mode).toBe("audit");
  });
});

describe("AUD-018: events cap / compaction", () => {
  test("compaction never changes openObligations, and shrinks the file", () => {
    RC.arm(cwd, { mode: "backlog", flow: "autonomous", ship: "auto", passes: [] }, { now: T0 });
    let t = T0;
    for (let i = 0; i < 10; i++) {
      t += 1000; RC.record(cwd, { k: "skill", name: "auto-agents", args: "" }, { now: t });
      t += 1000; RC.record(cwd, { k: "edit" }, { now: t });
      for (let j = 0; j < 6; j++) {
        t += 1000; RC.record(cwd, { k: "measure", codeFiles: j + 1 }, { now: t });
        t += 1000; RC.record(cwd, { k: "block", gate: "release", open: [`x${j}`] }, { now: t });
      }
      t += 1000; RC.record(cwd, { k: "release", ok: true, item: String(i) }, { now: t });
    }
    const header = store.readRawContract(cwd);
    const evsBefore = RC.events(cwd);
    const before = RC.openObligations(header, evsBefore, "card", {});
    const linesBefore = fs.readFileSync(store.eventsPath(cwd), "utf8").split("\n").filter(Boolean).length;

    store.compactEvents(cwd, header);

    const linesAfter = fs.readFileSync(store.eventsPath(cwd), "utf8").split("\n").filter(Boolean).length;
    const evsAfter = RC.events(cwd);
    const after = RC.openObligations(header, evsAfter, "card", {});
    expect(linesAfter).toBeLessThan(linesBefore);
    expect(after).toEqual(before);
    // every `block` line is gone; every segment keeps at most its last `measure`.
    expect(evsAfter.some((e) => e.k === "block")).toBe(false);
  });

  test("record() auto-compacts once the file passes the line cap", () => {
    RC.arm(cwd, { mode: "prompt", flow: "interactive" }, { now: T0 });
    let t = T0;
    for (let i = 0; i < store.EVENTS_COMPACT_LINES + 20; i++) {
      t += 1000;
      RC.record(cwd, { k: "measure", codeFiles: i }, { now: t }); // varies → never dedups
    }
    const lines = fs.readFileSync(store.eventsPath(cwd), "utf8").split("\n").filter(Boolean).length;
    expect(lines).toBeLessThanOrEqual(store.EVENTS_COMPACT_LINES + 20);
    expect(lines).toBeLessThan(store.EVENTS_COMPACT_LINES); // all `measure`s but the segment's last were dropped
  });

  test("readEventLines cache is invalidated by a write it did not know about", () => {
    RC.arm(cwd, { mode: "prompt" }, { now: T0 });
    RC.record(cwd, { k: "edit" }, { now: T0 + 1000 });
    expect(RC.events(cwd)).toHaveLength(1);
    fs.appendFileSync(store.eventsPath(cwd), `${JSON.stringify({ k: "commit", t: new Date(T0 + 2000).toISOString(), c: store.readRawContract(cwd).id })}\n`);
    expect(RC.events(cwd)).toHaveLength(2); // not served stale from the size+mtime cache
  });
});

describe("AUD-011: readContractForCard ownership", () => {
  test("no asking session id + a header that stores one → null", () => {
    store.arm(cwd, { mode: "prompt", sessionId: "owner-session" }, { now: T0 });
    expect(store.readContractForCard(cwd, { now: T0, sessionId: null })).toBeNull();
  });

  test("a foreign asking session id → null", () => {
    store.arm(cwd, { mode: "prompt", sessionId: "owner-session" }, { now: T0 });
    expect(store.readContractForCard(cwd, { now: T0, sessionId: "someone-else" })).toBeNull();
  });

  test("the owning session id → the header", () => {
    store.arm(cwd, { mode: "prompt", sessionId: "owner-session" }, { now: T0 });
    const h = store.readContractForCard(cwd, { now: T0, sessionId: "owner-session" });
    expect(h).not.toBeNull();
    expect(h.sessionId).toBe("owner-session");
  });

  test("no asking session id + a header with no stored session id → the header (unchanged leniency)", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    const h = store.readContractForCard(cwd, { now: T0, sessionId: null });
    expect(h).not.toBeNull();
  });
});
