/**
 * run-contract-store.js unit tests for the 2026-09-25 audit follow-ups that
 * touch only the store (AUD-017 close-always-wins, AUD-018 events cap,
 * AUD-011 CARD-path ownership). AUD-022 (corrupt header quarantine) is
 * covered in run-contract.test.js next to the test it replaces.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("RT1 red-team round 1 follow-ups", () => {
  test("R3: a transient read error (EBUSY/EPERM) is not quarantined — the header survives", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    const headerFile = store.contractPath(cwd);
    const realReadFileSync = fs.readFileSync.bind(fs);
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...rest) => {
      if (file === headerFile) { const e = new Error("busy"); e.code = "EBUSY"; throw e; }
      return realReadFileSync(file, ...rest);
    });
    try {
      expect(store.readContract(cwd, { now: T0 })).toBeNull(); // transient: "no contract this call"
    } finally {
      spy.mockRestore();
    }
    // Not quarantined: the header file itself is still there, untouched.
    expect(fs.existsSync(headerFile)).toBe(true);
    const dir = path.dirname(headerFile);
    const prefix = store.corruptPrefix();
    expect(fs.readdirSync(dir).some((n) => n.startsWith(prefix))).toBe(false);
    const h = store.readContract(cwd, { now: T0 });
    expect(h).not.toBeNull();
    expect(h.mode).toBe("prompt");
  });

  test("R4: quarantine re-reads the renamed bytes and puts back a fresh header raced in by a concurrent arm()", () => {
    fs.mkdirSync(path.dirname(store.contractPath(cwd)), { recursive: true });
    fs.writeFileSync(store.contractPath(cwd), "{broken");
    // Simulate: by the time quarantineCorrupt() actually renames it, a
    // concurrent arm() already replaced the file with a fresh valid header
    // (readJsonStrict's retry window). Patch fs.renameSync so the first
    // rename (header → quarantine copy) instead captures a fresh header.
    const headerFile = store.contractPath(cwd);
    const realRenameSync = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementationOnce((src, dest) => {
      if (src === headerFile) {
        fs.writeFileSync(dest, JSON.stringify({ v: 1, id: "fresh-id", armedAt: new Date(T0).toISOString() }));
        return;
      }
      return realRenameSync(src, dest);
    });
    try {
      store.readRawContract(cwd);
    } finally {
      spy.mockRestore();
    }
    // The fresh header must have been put back, not left quarantined.
    expect(fs.existsSync(headerFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(headerFile, "utf8"));
    expect(raw.id).toBe("fresh-id");
    const dir = path.dirname(headerFile);
    const prefix = store.corruptPrefix();
    expect(fs.readdirSync(dir).some((n) => n.startsWith(prefix))).toBe(false);
  });

  test("R6: EBUSY/EPERM on the lock file is retried like EEXIST, not given up on immediately", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    const lf = lockFile(cwd);
    const realOpenSync = fs.openSync.bind(fs);
    let calls = 0;
    const spy = vi.spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (file === lf && flags === "wx") {
        calls++;
        if (calls <= 2) { const e = new Error("busy"); e.code = "EBUSY"; throw e; }
      }
      return realOpenSync(file, flags, ...rest);
    });
    try {
      const patched = store.update(cwd, { mode: "audit" }, { now: T0, lockWaitMs: 500 });
      expect(patched).not.toBeNull();
      expect(patched.mode).toBe("audit");
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  test("R6: close() writes without the lock when the lock file can never be created", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    const lf = lockFile(cwd);
    const realOpenSync = fs.openSync.bind(fs);
    const spy = vi.spyOn(fs, "openSync").mockImplementation((file, flags, ...rest) => {
      if (file === lf) { const e = new Error("perm"); e.code = "EPERM"; throw e; }
      return realOpenSync(file, flags, ...rest);
    });
    try {
      const closed = store.close(cwd, "done", { now: T0 + 1000, lockWaitMs: 20 });
      expect(closed).not.toBeNull();
      expect(closed.closedAt).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(lf)).toBe(false); // open('wx') never once succeeded
  });

  test("R7: releaseLock only removes a lock that still holds its own token", () => {
    store.arm(cwd, { mode: "prompt" }, { now: T0 });
    const lf = lockFile(cwd);
    const headerFile = store.contractPath(cwd);
    const realReadFileSync = fs.readFileSync.bind(fs);
    let headerReads = 0;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...rest) => {
      // The first header read is update()'s pre-lock archiveIfExpired() check
      // — inject only on the second, which happens inside the locked
      // critical section (readContract()), to simulate a concurrent process
      // taking the lock over mid-section and writing its own fresh token in.
      if (file === headerFile) {
        headerReads++;
        if (headerReads === 2) fs.writeFileSync(lf, "other-process-token");
      }
      return realReadFileSync(file, ...rest);
    });
    try {
      const patched = store.update(cwd, { mode: "audit" }, { now: T0 });
      expect(patched).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
    // Our release must not have removed the other process's lock.
    expect(fs.existsSync(lf)).toBe(true);
    expect(fs.readFileSync(lf, "utf8")).toBe("other-process-token");
  });

  test("R7: stale-lock takeover puts a since-refreshed lock back instead of dropping it", () => {
    const lf = lockFile(cwd);
    fs.mkdirSync(path.dirname(lf), { recursive: true });
    fs.writeFileSync(lf, "fresh-token");
    const tookOver = store.takeoverStaleLock(lf, "stale-observed-token");
    expect(tookOver).toBe(false);
    expect(fs.existsSync(lf)).toBe(true);
    expect(fs.readFileSync(lf, "utf8")).toBe("fresh-token");
  });

  test("R7: stale-lock takeover drops the lock when its content still matches what was observed", () => {
    const lf = lockFile(cwd);
    fs.mkdirSync(path.dirname(lf), { recursive: true });
    fs.writeFileSync(lf, "crashed-token");
    const tookOver = store.takeoverStaleLock(lf, "crashed-token");
    expect(tookOver).toBe(true);
    expect(fs.existsSync(lf)).toBe(false);
  });

  test("R8: compaction aborts (no-op) if the events file grew since it read it", () => {
    RC.arm(cwd, { mode: "prompt" }, { now: T0 });
    RC.record(cwd, { k: "edit" }, { now: T0 + 1000 });
    const header = store.readRawContract(cwd);
    const before = fs.readFileSync(store.eventsPath(cwd), "utf8");
    const realStatSync = fs.statSync.bind(fs);
    let calls = 0;
    const spy = vi.spyOn(fs, "statSync").mockImplementation((file, ...rest) => {
      const st = realStatSync(file, ...rest);
      if (file === store.eventsPath(cwd)) {
        calls++;
        if (calls === 3) return { ...st, size: st.size + 999 }; // "right before the rename" check
      }
      return st;
    });
    try {
      store.compactEvents(cwd, header);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(store.eventsPath(cwd), "utf8")).toBe(before); // untouched
  });

  test("R8: header persists the last-compacted line count so a still-large file isn't rewritten every record()", () => {
    RC.arm(cwd, { mode: "prompt", flow: "interactive" }, { now: T0 });
    let t = T0;
    for (let i = 0; i < store.EVENTS_COMPACT_LINES + 20; i++) {
      t += 1000;
      RC.record(cwd, { k: "measure", codeFiles: i }, { now: t });
    }
    const afterFirstCompaction = store.readRawContract(cwd).compactedAtLines;
    expect(afterFirstCompaction).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      t += 1000;
      RC.record(cwd, { k: "measure", codeFiles: 1000 + i }, { now: t });
    }
    // Still well under EVENTS_COMPACT_LINES growth since the last compaction:
    // no second rewrite happened.
    expect(store.readRawContract(cwd).compactedAtLines).toBe(afterFirstCompaction);
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
