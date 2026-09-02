import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// cache-inuse.js is CommonJS (hooks are standalone CJS scripts) — default interop.
import cacheInUse from "./cache-inuse.js";

const { IN_USE_DIR, isVersionDirInUse, prunableEntries } = cacheInUse;

const LIVE = 1111;
const DEAD = 2222;
const isAlive = (pid) => pid === LIVE;

let cache;

function marker(versionDir, name, content) {
  const dir = path.join(versionDir, IN_USE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function version(name) {
  const dir = path.join(cache, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-inuse-"));
});

afterEach(() => {
  try {
    fs.rmSync(cache, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("isVersionDirInUse — Claude Code's native .in_use reference counting", () => {
  test("no .in_use dir at all → nothing claims the version dir", () => {
    expect(isVersionDirInUse(version("0.1.0"), isAlive)).toBe(false);
  });

  test("empty .in_use dir → no claim", () => {
    const dir = version("0.1.0");
    fs.mkdirSync(path.join(dir, IN_USE_DIR), { recursive: true });
    expect(isVersionDirInUse(dir, isAlive)).toBe(false);
  });

  test("marker for a live PID → in use", () => {
    const dir = version("0.1.0");
    marker(dir, String(LIVE), JSON.stringify({ pid: LIVE, procStartFt: "1343" }));
    expect(isVersionDirInUse(dir, isAlive)).toBe(true);
  });

  test("marker for a dead PID only → not in use", () => {
    const dir = version("0.1.0");
    marker(dir, String(DEAD), JSON.stringify({ pid: DEAD, procStartFt: "1343" }));
    expect(isVersionDirInUse(dir, isAlive)).toBe(false);
  });

  test("one dead + one live marker → in use", () => {
    const dir = version("0.1.0");
    marker(dir, String(DEAD), JSON.stringify({ pid: DEAD }));
    marker(dir, String(LIVE), JSON.stringify({ pid: LIVE }));
    expect(isVersionDirInUse(dir, isAlive)).toBe(true);
  });

  test("half-written .tmp marker falls back to the leading PID in the filename", () => {
    const dir = version("0.1.0");
    marker(dir, `${LIVE}.tmp.7da02f73`, "");
    expect(isVersionDirInUse(dir, isAlive)).toBe(true);
  });

  test("marker with neither parsable JSON nor a PID-prefixed name → assumed in use", () => {
    const dir = version("0.1.0");
    marker(dir, "garbage", "not json");
    expect(isVersionDirInUse(dir, isAlive)).toBe(true);
  });

  test("unreadable .in_use (a file, not a dir) → assumed in use", () => {
    const dir = version("0.1.0");
    fs.writeFileSync(path.join(dir, IN_USE_DIR), "not a directory");
    expect(isVersionDirInUse(dir, isAlive)).toBe(true);
  });
});

describe("prunableEntries — which version dirs a cache rebuild may delete", () => {
  test("never prunes the version being built, even with no claim on it", () => {
    version("0.137.0");
    expect(prunableEntries(cache, "0.137.0", isAlive)).toEqual([]);
  });

  test("prunes an unclaimed old version dir", () => {
    version("0.137.0");
    version("0.135.0");
    expect(prunableEntries(cache, "0.137.0", isAlive)).toEqual(["0.135.0"]);
  });

  test("keeps an old version dir another live session still claims", () => {
    version("0.137.0");
    marker(version("0.136.0"), String(LIVE), JSON.stringify({ pid: LIVE }));
    version("0.135.0");
    expect(prunableEntries(cache, "0.137.0", isAlive)).toEqual(["0.135.0"]);
  });

  test("a claim by a dead session does not protect the dir", () => {
    version("0.137.0");
    marker(version("0.136.0"), String(DEAD), JSON.stringify({ pid: DEAD }));
    expect(prunableEntries(cache, "0.137.0", isAlive)).toEqual(["0.136.0"]);
  });

  test("missing plugin cache dir → nothing to prune, no throw", () => {
    expect(prunableEntries(path.join(cache, "absent"), "0.137.0", isAlive)).toEqual([]);
  });
});
