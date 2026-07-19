import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lockoutPathFor, readLockout, LOCKOUT_FILE } from "./autonomous-lockout.js";

const dirs = [];
const mkdtemp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lockout-test-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("autonomous-lockout — sentinel resolution", () => {
  test("lockoutPathFor joins the well-known filename onto the project dir", () => {
    expect(lockoutPathFor(path.join("/", "proj"))).toBe(path.join("/", "proj", LOCKOUT_FILE));
  });

  test("readLockout returns null when no sentinel is present", () => {
    expect(readLockout(mkdtemp())).toBeNull();
  });

  test("readLockout returns the parsed sentinel when present", () => {
    const d = mkdtemp();
    const sentinel = { owner: "burn-backlog", since: "2026-07-19T00:00:00.000Z" };
    fs.writeFileSync(lockoutPathFor(d), JSON.stringify(sentinel));
    expect(readLockout(d)).toEqual(sentinel);
  });

  test("a present-but-corrupt sentinel still reads as locked (fail toward non-interactive)", () => {
    // The whole guard exists to keep an AFK run from hanging on a modal — so a
    // damaged sentinel must resolve to "locked", never to "no lockout".
    const d = mkdtemp();
    fs.writeFileSync(lockoutPathFor(d), "{ this is not json");
    const r = readLockout(d);
    expect(r).not.toBeNull();
    expect(r.owner).toBe("unknown");
  });
});
