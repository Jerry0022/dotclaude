import { describe, test, expect } from "vitest";
import {
  isForeignLiveOwner,
  canClaim,
  pickFreePort,
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

describe("normWorktree", () => {
  test("normalizes backslashes, trailing slash, and case", () => {
    expect(normWorktree("C:\\A\\B\\")).toBe(normWorktree("c:/a/b"));
  });
});
