/**
 * @module ship/lib/test-step
 * @description Diagnostics for ship_build's test step (#762): failing test
 * names from vitest output, the EPERM/EBUSY temp-cleanup pattern that marks an
 * environment failure, and the machine-load signal (test-lock wait, lock
 * holder, CPU busy, slower than usual) the caller relays to the user.
 *
 * The test lock is the repo's vitest globalSetup (vitest.suite-lock.mjs): a
 * JSON file `{ pid, since, cwd }` in the OS temp dir, and stderr lines
 * `[suite-lock] … (pid N, cwd) — waiting` / `acquired after N s` /
 * `waited 30 min — running anyway`. Repos without it simply yield no lock data.
 */

import { readFileSync } from "node:fs";
import { cpus, loadavg, platform, tmpdir } from "node:os";
import { join } from "node:path";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const NAME_MAX = 500;

export function stripAnsi(s) {
  return String(s ?? "").replace(ANSI, "");
}

/**
 * Failing test names, in output order, deduped. vitest's summary prints one
 * ` FAIL  file > suite > test` line per failure (file-level errors:
 * ` FAIL  file [ file ]`); the inline `× suite > test 12ms` lines are the
 * fallback when the summary is missing. Never truncated as a list.
 */
export function parseFailingTests(output) {
  const lines = stripAnsi(output).split(/\r?\n/);
  const pick = (re) => {
    const seen = new Set();
    for (const line of lines) {
      const m = re.exec(line);
      if (m) seen.add(m[1].trim().slice(0, NAME_MAX));
    }
    return [...seen];
  };
  const summary = pick(/^\s*FAIL\s+(\S.*?)\s*$/);
  if (summary.length > 0) return summary;
  return pick(/^\s*[×✗]\s+(\S.*?)(?:\s+\d+(?:\.\d+)?m?s)?\s*$/);
}

/** EPERM/EBUSY/ENOTEMPTY on a temp or cleanup path — the machine, not the code. */
export function isEnvCleanupFailure(output) {
  return stripAnsi(output).split(/\r?\n/).some((line) =>
    /\b(EPERM|EBUSY|ENOTEMPTY)\b/.test(line)
    && /(rmdir|unlink|\brm(Sync)?\b|scandir|rename|lstat|\btemp\b|\btmp\b|[\\/]Temp[\\/]|[\\/]tmp[\\/])/i.test(line));
}

/**
 * `failureKind` of a red test step: "environment" when the output carries the
 * temp-cleanup pattern and no test failed by name, otherwise "test".
 */
export function classifyFailure(output, failingTests = parseFailingTests(output)) {
  return failingTests.length === 0 && isEnvCleanupFailure(output) ? "environment" : "test";
}

/** Lock wait from the suite-lock stderr lines, or null when the run never waited. */
export function parseLockWait(output) {
  const s = stripAnsi(output);
  const holderM = /\[suite-lock\] another full test run is active \(pid (\d+), ([^)]*)\)/.exec(s);
  const holder = holderM ? { pid: Number(holderM[1]), cwd: holderM[2] } : null;
  const acquired = /\[suite-lock\] acquired after (\d+) s/.exec(s);
  if (acquired) return { waitedMs: Number(acquired[1]) * 1000, gaveUp: false, holder };
  const gaveUp = /\[suite-lock\] waited (\d+) min/.exec(s);
  if (gaveUp) return { waitedMs: Number(gaveUp[1]) * 60_000, gaveUp: true, holder };
  return holder ? { waitedMs: null, gaveUp: false, holder } : null;
}

export function suiteLockFile() {
  return process.env.DOTCLAUDE_SUITE_LOCK_FILE || join(tmpdir(), "dotclaude-vitest-suite.lock");
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** The live holder of the machine-wide test lock, or null (absent, dead, stale, ours). */
export function readLockHolder({ file = suiteLockFile(), now = Date.now(), staleMs = 40 * 60_000 } = {}) {
  let lock;
  try { lock = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (!lock || typeof lock.pid !== "number" || lock.pid === process.pid) return null;
  const heldMs = now - (Number(lock.since) || 0);
  if (heldMs > staleMs || !alive(lock.pid)) return null;
  return { pid: lock.pid, cwd: lock.cwd || null, heldMs };
}

function cpuTotals(list = cpus()) {
  let idle = 0, total = 0;
  for (const c of list) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Machine CPU busy % over two os.cpus() snapshots; null when not measurable. */
export function busyPct(a, b) {
  const dt = b.total - a.total;
  if (!(dt > 0)) return null;
  return Math.round(100 * (1 - (b.idle - a.idle) / dt));
}

/**
 * Cheap CPU sample before the test step: busy % across all cores over
 * `sampleMs` (works on Windows, where loadavg is always 0), plus the 1-min
 * load average elsewhere.
 */
export async function sampleCpu(sampleMs = 500) {
  try {
    const a = cpuTotals();
    if (sampleMs > 0) await new Promise((r) => setTimeout(r, sampleMs));
    const b = cpuTotals();
    const out = { busyPct: busyPct(a, b), cores: cpus().length };
    if (platform() !== "win32") out.loadAvg1 = Math.round(loadavg()[0] * 100) / 100;
    return out;
  } catch {
    return null;
  }
}

export const BUSY_PCT = 85;
export const LOCK_WAIT_REPORT_MS = 5000;

/**
 * The `load` field for ship_build, or null when nothing slowed the step.
 * Reported on: a lock wait ≥ 5 s or a live holder at start, a run more than
 * twice (and 30 s over) the usual green duration net of the lock wait, or CPU
 * ≥ 85 % busy before start.
 */
export function buildLoad({ lockWait = null, holderAtStart = null, cpu = null, durationMs = null, usualMs = null } = {}) {
  const waitedMs = lockWait?.waitedMs ?? null;
  const holder = lockWait?.holder || holderAtStart || null;
  const netMs = durationMs != null ? durationMs - (waitedMs || 0) : null;
  const slow = usualMs > 0 && netMs != null && netMs > 2 * usualMs && netMs - usualMs > 30_000;
  const busy = cpu?.busyPct != null && cpu.busyPct >= BUSY_PCT;
  const waited = (waitedMs || 0) >= LOCK_WAIT_REPORT_MS || !!lockWait?.gaveUp;
  if (!waited && !holderAtStart && !slow && !busy) return null;

  const parts = [];
  if (waited) parts.push(`waited ${Math.round(waitedMs / 1000)} s on the machine-wide test lock${lockWait.gaveUp ? " and then ran anyway" : ""}`);
  else if (holderAtStart) parts.push("another full test run held the machine-wide test lock at start");
  if (holder) parts.push(`lock held by pid ${holder.pid}${holder.cwd ? ` (${holder.cwd})` : ""}`);
  if (slow) parts.push(`ran ${(netMs / usualMs).toFixed(1)}x slower than usual (${Math.round(netMs / 1000)} s vs ${Math.round(usualMs / 1000)} s)`);
  if (busy) parts.push(`CPU ${cpu.busyPct}% busy before start`);
  return {
    lockWaitMs: waitedMs,
    lockGaveUp: !!lockWait?.gaveUp,
    holder,
    cpuBusyPct: cpu?.busyPct ?? null,
    loadAvg1: cpu?.loadAvg1 ?? null,
    cores: cpu?.cores ?? null,
    durationMs,
    usualMs,
    slow,
    note: `Machine under load — the test step ${parts.join("; ")}.`,
  };
}
