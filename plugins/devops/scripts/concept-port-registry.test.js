import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isForeignLiveOwner,
  canClaim,
  pickFreePort,
  pruneStale,
  registryDir,
  bridgeFile,
  listEntries,
  writeEntry,
  REGISTRY_DIR,
  REGISTRY_DIR_ENV,
  normWorktree,
} from "./concept-port-registry.js";

// Cross-session port-collision regression: two concept sessions (different
// worktrees) must never pick the same port nor sweep each other's live bridge.
// These exercise the pure decision logic with injected read / isAlive / isBound
// so no real FS or processes are touched.

const MINE = "C:/proj/.claude/worktrees/feature-a";
const THEIRS = "C:/proj/.claude/worktrees/feature-b";
const entry = (over = {}) => ({ port: 8791, pid: 4242, worktree: THEIRS, ...over });

describe("isForeignLiveOwner", () => {
  test("live process on a DIFFERENT worktree → foreign (must not touch)", () => {
    expect(isForeignLiveOwner(entry(), MINE, () => true)).toBe(true);
  });
  test("live process on MY OWN worktree → not foreign (reclaimable)", () => {
    expect(isForeignLiveOwner(entry({ worktree: MINE }), MINE, () => true)).toBe(false);
  });
  test("dead owner → not foreign-live, even on a different worktree", () => {
    expect(isForeignLiveOwner(entry(), MINE, () => false)).toBe(false);
  });
  test("no registry entry → not foreign", () => {
    expect(isForeignLiveOwner(null, MINE, () => true)).toBe(false);
  });
  test("worktree comparison is slash/trailing-slash/case insensitive", () => {
    const backslashMine = "C:\\proj\\.claude\\worktrees\\feature-a\\";
    expect(isForeignLiveOwner(entry({ worktree: MINE }), backslashMine, () => true)).toBe(false);
  });
});

describe("canClaim (pre-launch sweep gate)", () => {
  const opts = (over = {}) => ({ myWorktree: MINE, isAlive: () => true, read: () => entry(), ...over });
  test("port held by a live foreign session → NOT claimable (never sweep it)", () => {
    expect(canClaim(8791, opts())).toBe(false);
  });
  test("port held by my own session → claimable", () => {
    expect(canClaim(8791, opts({ read: () => entry({ worktree: MINE }) }))).toBe(true);
  });
  test("port with a dead owner → claimable (stale entry)", () => {
    expect(canClaim(8791, opts({ isAlive: () => false }))).toBe(true);
  });
  test("port with no registry entry → claimable", () => {
    expect(canClaim(8791, opts({ read: () => null }))).toBe(true);
  });
});

describe("pickFreePort", () => {
  const base = { myWorktree: MINE, isAlive: () => true, read: () => null, isBound: () => false };
  test("returns the range start when rand=0 and nothing is taken", () => {
    const port = pickFreePort({ ...base, rand: () => 0, range: [8700, 8999] });
    expect(port).toBe(8700);
  });
  test("skips a port owned by a live foreign session", () => {
    const read = (p) => (p === 8700 ? { port: 8700, pid: 1, worktree: THEIRS } : null);
    const port = pickFreePort({ ...base, read, isAlive: () => true, rand: () => 0, range: [8700, 8702] });
    expect(port).toBe(8701); // 8700 is foreign-live → skipped
  });
  test("skips a port that is currently bound", () => {
    const isBound = (p) => p === 8700;
    const port = pickFreePort({ ...base, isBound, rand: () => 0, range: [8700, 8702] });
    expect(port).toBe(8701);
  });
  test("returns null when every port in range is foreign-live", () => {
    const read = (p) => ({ port: p, pid: 1, worktree: THEIRS });
    const port = pickFreePort({ ...base, read, isAlive: () => true, rand: () => 0, range: [8700, 8701] });
    expect(port).toBe(null);
  });
  test("wraps around the range from a mid-range random start", () => {
    // rand=0.99 → start near the top (8702); 8702 free → returned without wrap.
    const port = pickFreePort({ ...base, rand: () => 0.99, range: [8700, 8702] });
    expect(port).toBe(8702);
  });
  test("a dead foreign owner does not block the port (stale entry reclaimed)", () => {
    const read = (p) => (p === 8700 ? { port: 8700, pid: 9, worktree: THEIRS } : null);
    const port = pickFreePort({ ...base, read, isAlive: () => false, rand: () => 0, range: [8700, 8702] });
    expect(port).toBe(8700); // owner dead → reclaimable
  });
});

describe("pruneStale (reader-side sweep of hard-killed bridges)", () => {
  // The 1000+ stale-entry incident: servers killed with SIGKILL never reach
  // /shutdown, the watchdog, atexit or a signal handler, so their entries
  // stay until something on the READER side sweeps them. The sweep must never
  // delete a live bridge — foreign or not — so "port still answers" keeps an
  // entry unconditionally. The recorded pid is NOT a keep criterion: Windows
  // reuses pids, and 35 weeks-old entries survived a pid-based sweep because
  // unrelated processes had inherited their numbers.
  const fixture = () => {
    const files = new Map([
      [8701, { port: 8701, pid: 11, worktree: "C:/a" }],  // bound → keep
      [8702, { port: 8702, pid: 12, worktree: "C:/b" }],  // unbound → stale
      [8703, { port: 8703, pid: 13, worktree: "C:/c" }],  // bound, pid long gone → keep
      [8704, null],                                        // corrupt JSON → stale
      [8705, { port: 8705, pid: process.pid, worktree: "C:/e" }], // "alive" pid (reused) but unbound → stale
    ]);
    const removed = [];
    return {
      files,
      removed,
      opts: {
        list: () => [...files.keys()],
        read: (p) => files.get(p) ?? null,
        remove: (p) => { removed.push(p); files.delete(p); },
        isBound: async (p) => p === 8701 || p === 8703,
      },
    };
  };

  test("removes unbound and corrupt entries, keeps every bound port", async () => {
    const { opts, removed } = fixture();
    const result = await pruneStale(opts);
    expect(removed.sort()).toEqual([8702, 8704, 8705]);
    expect(result.removed.sort()).toEqual([8702, 8704, 8705]);
    expect(result.kept.sort()).toEqual([8701, 8703]);
  });

  test("a bound port is never deleted, whatever its recorded pid says", async () => {
    const { opts, removed } = fixture();
    await pruneStale({ ...opts, read: (p) => ({ port: p, pid: 0, worktree: "C:/z" }) });
    expect(removed).not.toContain(8701);
    expect(removed).not.toContain(8703);
  });

  test("a live-looking pid does not rescue an unbound port (Windows pid reuse)", async () => {
    const { opts, removed } = fixture();
    await pruneStale(opts);
    expect(removed).toContain(8705);
  });

  test("a corrupt entry is removed without probing its port", async () => {
    const probed = [];
    await pruneStale({
      list: () => [8704],
      read: () => null,
      remove: () => {},
      isBound: async (p) => { probed.push(p); return true; },
    });
    expect(probed).toEqual([]);
  });

  test("an empty registry is a no-op", async () => {
    const result = await pruneStale({ list: () => [], read: () => null, remove: () => {}, isBound: async () => false });
    expect(result).toEqual({ removed: [], kept: [] });
  });
});

describe("registry directory override", () => {
  const saved = process.env[REGISTRY_DIR_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[REGISTRY_DIR_ENV];
    else process.env[REGISTRY_DIR_ENV] = saved;
  });

  test("defaults to ~/.claude/concept-bridges", () => {
    delete process.env[REGISTRY_DIR_ENV];
    expect(registryDir()).toBe(REGISTRY_DIR);
    expect(bridgeFile(8700)).toBe(path.join(REGISTRY_DIR, "8700.json"));
  });

  test("CONCEPT_BRIDGE_REGISTRY_DIR redirects reads, writes and listing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "concept-bridges-unit-"));
    process.env[REGISTRY_DIR_ENV] = tmp;
    expect(registryDir()).toBe(tmp);
    writeEntry(8710, { port: 8710, pid: 1, worktree: "C:/x" });
    expect(fs.existsSync(path.join(tmp, "8710.json"))).toBe(true);
    fs.writeFileSync(path.join(tmp, "notes.txt"), "ignored");
    expect(listEntries()).toEqual([8710]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("listEntries on a missing directory is []", () => {
    process.env[REGISTRY_DIR_ENV] = path.join(os.tmpdir(), "concept-bridges-does-not-exist-" + process.pid);
    expect(listEntries()).toEqual([]);
  });
});

describe("normWorktree", () => {
  test("normalizes backslashes, trailing slash, and case", () => {
    expect(normWorktree("C:\\A\\B\\")).toBe(normWorktree("c:/a/b"));
  });
});
