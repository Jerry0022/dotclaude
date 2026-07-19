import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  write,
  clear,
  isActive,
  sentinelPath,
  SENTINEL_REL,
  SENTINEL_MAX_AGE_MS,
} from "./ship-sentinel.js";

const dirs = [];
const mkdtemp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ship-sentinel-test-"));
  dirs.push(d);
  return d;
};

// Write a sentinel with an explicit timestamp so the TTL branch is exercised
// deterministically (no sleeping).
const writeAt = (cwd, ts) => {
  const p = sentinelPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ts, pid: 1234 }), "utf8");
  return p;
};

afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("ship-sentinel — path + round trip", () => {
  test("sentinelPath joins the well-known relative path onto cwd", () => {
    const cwd = path.join("/", "proj");
    expect(sentinelPath(cwd)).toBe(path.join(cwd, SENTINEL_REL));
  });

  test("write → isActive true → clear → isActive false", () => {
    const d = mkdtemp();
    expect(write(d)).toBe(true);
    expect(fs.existsSync(sentinelPath(d))).toBe(true);
    expect(isActive(d)).toBe(true);
    expect(clear(d)).toBe(true);
    expect(fs.existsSync(sentinelPath(d))).toBe(false);
    expect(isActive(d)).toBe(false);
  });

  test("isActive is false when no sentinel exists", () => {
    expect(isActive(mkdtemp())).toBe(false);
  });

  test("isActive is false for a corrupt sentinel payload", () => {
    const d = mkdtemp();
    const p = sentinelPath(d);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{ not json", "utf8");
    expect(isActive(d)).toBe(false);
  });
});

describe("ship-sentinel — TTL deadlock backstop", () => {
  test("a fresh sentinel just inside the TTL reads active", () => {
    const d = mkdtemp();
    writeAt(d, Date.now() - (SENTINEL_MAX_AGE_MS - 60_000));
    expect(isActive(d)).toBe(true);
    expect(fs.existsSync(sentinelPath(d))).toBe(true);
  });

  test("a sentinel older than the TTL reads inactive AND is unlinked (self-heal)", () => {
    const d = mkdtemp();
    const p = writeAt(d, Date.now() - (SENTINEL_MAX_AGE_MS + 60_000));
    expect(isActive(d)).toBe(false);
    // Stale sentinels are pruned so a never-cleaned deadlock cannot persist.
    expect(fs.existsSync(p)).toBe(false);
  });

  test("TTL comfortably exceeds a legit worst-case pipeline (>= 45 min) — F4 regression guard", () => {
    // Guards against silently reverting to the former 15 min, which expired
    // mid-ship and re-armed the main/edit guards against a running ship.
    expect(SENTINEL_MAX_AGE_MS).toBeGreaterThanOrEqual(45 * 60 * 1000);
  });
});
