import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stripAnsi, parseFailingTests, isEnvCleanupFailure, classifyFailure, parseLockWait,
  readLockHolder, busyPct, sampleCpu, buildLoad, buildPreRunWarning, createLockWatch,
} from "./test-step.js";

const ESC = String.fromCharCode(27);
const c = (code) => `${ESC}[${code}m`;

// Shape of vitest 3.2 default-reporter output (captured 2026-10-20, non-TTY).
const VITEST_RED = [
  ` ${c(31)}x${c(39)} demo.test.js ${c(2)}(${c(22)}3 tests | ${c(31)}2 failed${c(39)})`,
  `${c(31)}   ${c(31)}×${c(31)} grp${c(2)} > ${c(22)}fails here${c(39)}${c(32)} 9${c(2)}ms${c(22)}${c(39)}`,
  `${c(31)}   ${c(31)}×${c(31)} top fail${c(39)}${c(32)} 1${c(2)}ms${c(22)}${c(39)}`,
  "",
  `${c(41)}${c(1)} FAIL ${c(22)}${c(49)} demo.test.js${c(2)} > ${c(22)}grp${c(2)} > ${c(22)}fails here`,
  `${c(31)}${c(1)}AssertionError${c(22)}: expected 1 to be 2`,
  `${c(41)}${c(1)} FAIL ${c(22)}${c(49)} demo.test.js${c(2)} > ${c(22)}top fail`,
  `${c(41)}${c(1)} FAIL ${c(22)}${c(49)} demo.test.js${c(2)} > ${c(22)}top fail`,
  `${c(41)}${c(1)} FAIL ${c(22)}${c(49)} broken.test.js [ broken.test.js ]`,
].join("\n");

describe("parseFailingTests", () => {
  test("summary FAIL lines, ANSI stripped, deduped, in order, file-level errors kept", () => {
    expect(parseFailingTests(VITEST_RED)).toEqual([
      "demo.test.js > grp > fails here",
      "demo.test.js > top fail",
      "broken.test.js [ broken.test.js ]",
    ]);
  });

  test("falls back to inline × lines (duration stripped) when there is no summary", () => {
    const inline = VITEST_RED.split("\n").slice(0, 3).join("\n");
    expect(parseFailingTests(inline)).toEqual(["grp > fails here", "top fail"]);
  });

  test("green or empty output → []", () => {
    expect(parseFailingTests(" Test Files  3 passed (3)")).toEqual([]);
    expect(parseFailingTests(undefined)).toEqual([]);
  });

  test("stripAnsi removes colour codes", () => {
    expect(stripAnsi(`${c(31)}red${c(39)}`)).toBe("red");
  });
});

describe("environment vs test failure", () => {
  const winEperm = "Error: EPERM, operation not permitted, rmdir 'C:" + "\\" + "Users" + "\\" + "x" + "\\" + "AppData" + "\\" + "Local" + "\\" + "Temp" + "\\" + "vitest-iso'";
  test.each([
    winEperm,
    "Error: EBUSY: resource busy or locked, unlink '/tmp/x/lock'",
    "Error: ENOTEMPTY: directory not empty, rmdir '/tmp/vitest-1'",
    "EPERM: operation not permitted, scandir 'C:/Users/x/AppData/Local/Temp/a'",
  ])("cleanup pattern: %s", (line) => {
    expect(isEnvCleanupFailure(`Unhandled Errors\n${line}\n`)).toBe(true);
  });

  test("an EPERM unrelated to temp/cleanup does not match", () => {
    expect(isEnvCleanupFailure("EPERM: operation not permitted, open 'C:/repo/src/a.js'")).toBe(false);
    expect(isEnvCleanupFailure("expected 1 to be 2")).toBe(false);
  });

  test("classifyFailure: env pattern without failing names → environment; names → test", () => {
    expect(classifyFailure(`Unhandled Errors\n${winEperm}`)).toBe("environment");
    expect(classifyFailure(`${VITEST_RED}\n${winEperm}`)).toBe("test");
    expect(classifyFailure("exit 1")).toBe("test");
  });
});

describe("parseLockWait", () => {
  test("waited then acquired, with holder", () => {
    const s = "[suite-lock] another full test run is active (pid 4242, C:/repo/a) — waiting for it to finish\n[suite-lock] acquired after 75 s\n";
    expect(parseLockWait(s)).toEqual({ waitedMs: 75_000, gaveUp: false, holder: { pid: 4242, cwd: "C:/repo/a" } });
  });
  test("gave up after the max wait", () => {
    expect(parseLockWait("[suite-lock] waited 30 min — running anyway")).toMatchObject({ waitedMs: 1_800_000, gaveUp: true });
  });
  test("no lock lines → null", () => {
    expect(parseLockWait("all green")).toBeNull();
  });
});

describe("readLockHolder", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "lockholder-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const write = (body) => { const f = join(dir, "l.lock"); writeFileSync(f, JSON.stringify(body)); return f; };

  test("live other pid → holder", () => {
    const now = Date.now();
    const file = write({ pid: process.ppid, since: now - 5000, cwd: "C:/other" });
    expect(readLockHolder({ file, now })).toEqual({ pid: process.ppid, cwd: "C:/other", heldMs: 5000 });
  });
  test("absent, own pid, stale or dead → null", () => {
    expect(readLockHolder({ file: join(dir, "none") })).toBeNull();
    expect(readLockHolder({ file: write({ pid: process.pid, since: Date.now() }) })).toBeNull();
    expect(readLockHolder({ file: write({ pid: process.ppid, since: 0 }) })).toBeNull();
    expect(readLockHolder({ file: write({ pid: 2 ** 30, since: Date.now() }) })).toBeNull();
  });
});

describe("buildPreRunWarning", () => {
  test("no holder and calm CPU → null", () => {
    expect(buildPreRunWarning({})).toBeNull();
    expect(buildPreRunWarning({ cpu: { busyPct: 40 }, usualMs: 90_000 })).toBeNull();
  });
  test("holder with usual duration → pid, cwd, held time, ETA", () => {
    const w = buildPreRunWarning({ holder: { pid: 5, cwd: "C:/o", heldMs: 61_000 }, usualMs: 100_000 });
    expect(w).toMatchObject({ heldMs: 61_000, usualMs: 100_000 });
    expect(w.note).toMatch(/pid 5, C:\/o, up for 61 s/);
    expect(w.eta).toMatch(/usually 100 s.*remaining time unknown, holder up for 61 s/);
  });
  test("holder without history → usual duration unknown; busy CPU alone is enough", () => {
    expect(buildPreRunWarning({ holder: { pid: 5, cwd: null, heldMs: 1000 } }).eta).toMatch(/usually unknown/);
    expect(buildPreRunWarning({ cpu: { busyPct: 90 } }).note).toMatch(/CPU 90% busy/);
  });
});

describe("CPU sample", () => {
  test("busyPct from two snapshots", () => {
    expect(busyPct({ idle: 100, total: 200 }, { idle: 110, total: 300 })).toBe(90);
    expect(busyPct({ idle: 0, total: 0 }, { idle: 0, total: 0 })).toBeNull();
  });
  test("sampleCpu returns cores and a 0-100 busy value", async () => {
    const s = await sampleCpu(0);
    expect(s.cores).toBeGreaterThan(0);
    if (s.busyPct != null) expect(s.busyPct).toBeGreaterThanOrEqual(0);
  });
});

describe("buildLoad", () => {
  test("quiet run → null", () => {
    expect(buildLoad({ cpu: { busyPct: 20 }, durationMs: 60_000, usualMs: 50_000 })).toBeNull();
    expect(buildLoad({ lockWait: { waitedMs: 2000, gaveUp: false, holder: null } })).toBeNull();
  });
  test("lock wait ≥ 5 s → load with note naming wait and holder", () => {
    const l = buildLoad({ lockWait: { waitedMs: 312_000, gaveUp: false, holder: { pid: 9, cwd: "C:/x" } }, durationMs: 400_000, usualMs: 80_000 });
    expect(l).toMatchObject({ lockWaitMs: 312_000, holder: { pid: 9 }, slow: false });
    expect(l.note).toMatch(/waited 312 s.*pid 9/);
  });
  test("slow net of the lock wait (2x and 30 s over usual)", () => {
    const l = buildLoad({ durationMs: 300_000, usualMs: 100_000 });
    expect(l.slow).toBe(true);
    expect(l.note).toMatch(/3\.0x slower than usual/);
    expect(buildLoad({ durationMs: 50_000, usualMs: 20_000 })).toBeNull(); // 2.5x but only 30 s over
  });
  test("busy CPU or a holder at start alone is enough", () => {
    expect(buildLoad({ cpu: { busyPct: 90, cores: 8 } }).note).toMatch(/CPU 90% busy/);
    expect(buildLoad({ holderAtStart: { pid: 3, cwd: null } }).holder).toEqual({ pid: 3, cwd: null });
  });
});

describe("createLockWatch", () => {
  const WAITING = "[suite-lock] another full test run is active (pid 7, C:/x) — waiting\n";
  const clock = () => { const c = { t: 1000, now: () => c.t }; return c; };

  test("measures an open wait live and the closed wait after `acquired`", () => {
    const c = clock();
    const w = createLockWatch(c.now);
    expect(w.waitedMs()).toBe(0);
    w.feed(WAITING);
    c.t += 40_000;
    expect(w.waiting()).toBe(true);
    expect(w.waitedMs()).toBe(40_000);
    c.t += 20_000;
    w.feed("[suite-lock] acquired after 60 s\n");
    c.t += 90_000;
    expect(w.waiting()).toBe(false);
    expect(w.waitedMs()).toBe(60_000);
  });

  test("a line split across chunks is still seen", () => {
    const w = createLockWatch(clock().now);
    w.feed(WAITING.slice(0, 30));
    expect(w.waiting()).toBe(false);
    w.feed(WAITING.slice(30));
    expect(w.waiting()).toBe(true);
  });

  test("uses the reported wait when both lines arrive in one chunk", () => {
    const w = createLockWatch(() => 5);
    w.feed(`${WAITING}[suite-lock] acquired after 147 s\n`);
    expect(w.waitedMs()).toBe(147_000);
  });

  test("a run that never waited stays at zero", () => {
    const w = createLockWatch();
    w.feed("RUN  v5.0.5\n");
    expect(w.waitedMs()).toBe(0);
    expect(w.waiting()).toBe(false);
  });
});
