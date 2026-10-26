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

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/**
 * Pre-run warning (#762 A), or null when neither a live foreign lock holder
 * nor a busy CPU is seen. Names holder pid/cwd and how long it has held the
 * lock, and gives an ETA range: the usual green duration, plus the holder's
 * uptime — the holder reports no remaining time, so that part is "unknown".
 */
export function buildPreRunWarning({ holder = null, cpu = null, usualMs = null } = {}) {
  const busy = cpu?.busyPct != null && cpu.busyPct >= BUSY_PCT;
  if (!holder && !busy) return null;
  const heldS = holder ? Math.round(holder.heldMs / 1000) : null;
  const usual = usualMs > 0 ? `${Math.round(usualMs / 1000)} s` : "unknown";
  const parts = [];
  if (holder) parts.push(`another full test run holds the machine-wide test lock (pid ${holder.pid}${holder.cwd ? `, ${holder.cwd}` : ""}, up for ${heldS} s)`);
  if (busy) parts.push(`CPU ${cpu.busyPct}% busy`);
  const eta = holder
    ? `own run usually ${usual}, starting once the holder finishes (remaining time unknown, holder up for ${heldS} s)`
    : `usual run ${usual}, likely slower under load`;
  return {
    holder, heldMs: holder?.heldMs ?? null, cpuBusyPct: cpu?.busyPct ?? null, usualMs: usualMs ?? null, eta,
    note: `Machine under load before the test step: ${parts.join("; ")}. ETA: ${eta}.`,
  };
}

// ---------------------------------------------------------------------------
// Test scope: related-only locally, full suite as the CI check (M6)
// ---------------------------------------------------------------------------

/** Job key the CI full-suite workflow must declare (.github/workflows/ci-suite.yml). */
export const CI_SUITE_JOB = "suite";
/** A related-run command line beyond this length (Windows caps ~8191) falls back to the full suite. */
const MAX_RELATED_CMD = 6000;

function gitOut(cwd, args) {
  return execFileSync("git", args, {
    windowsHide: true, cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
}

/** True when a workflow file under .github/workflows declares a top-level job named `suite`. */
export function ciSuiteWorkflowPresent(cwd) {
  try {
    const dir = join(cwd, ".github", "workflows");
    if (!existsSync(dir)) return false;
    return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).some((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      const jobs = /^jobs:\s*$/m.exec(text);
      return !!jobs && new RegExp(`^  ${CI_SUITE_JOB}:\\s*(?:#.*)?$`, "m").test(text.slice(jobs.index));
    });
  } catch {
    return false;
  }
}

/** True when the origin remote points at github.com. */
export function hasGithubOrigin(cwd) {
  try {
    return /github\.com[:/]/.test(gitOut(cwd, ["remote", "get-url", "origin"]));
  } catch {
    return false;
  }
}

/**
 * Files whose change can alter every test (or how tests run): the related set
 * cannot be trusted, run the full suite.
 */
export function isTestConfigFile(file) {
  const f = String(file).replace(/\\/g, "/");
  const base = f.split("/").pop();
  return /^(package(-lock)?|npm-shrinkwrap)\.json$/.test(base)
    || /^(pnpm-lock\.yaml|yarn\.lock)$/.test(base)
    || /^(vitest|vite|jest)[^/]*\.(?:[cm]?[jt]s|json)$/.test(base)
    || /^\.npmrc$/.test(base);
}

/**
 * Changed files of `cwd` against the merge-base with the default branch
 * (committed, staged, unstaged and untracked-not-ignored), as
 * `{ files, deleted }` (renames count as delete + add), or null when no base
 * can be resolved.
 */
export function changedVsBase(cwd) {
  try {
    let base = null;
    const candidates = [];
    try { candidates.push(gitOut(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim()); } catch { /* none */ }
    candidates.push("origin/main", "origin/master", "main", "master");
    for (const c of candidates.filter(Boolean)) {
      try { base = gitOut(cwd, ["merge-base", "HEAD", c]).trim(); if (base) break; } catch { /* next */ }
    }
    if (!base) return null;
    const files = new Set();
    const deleted = new Set();
    for (const line of gitOut(cwd, ["diff", "--name-status", "--no-renames", base]).split(/\r?\n/)) {
      const m = /^([A-Z])\d*\t(.+)$/.exec(line);
      if (!m) continue;
      (m[1] === "D" ? deleted : files).add(m[2]);
    }
    for (const f of gitOut(cwd, ["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean)) files.add(f);
    return { files: [...files], deleted: [...deleted] };
  } catch {
    return null;
  }
}

const quoteArg = (f) => (/[\s"]/.test(f) ? `"${f.replace(/"/g, '\\"')}"` : f);

/**
 * The `vitest related` command for the changed files, or `{ empty: true }`
 * when no JS/TS file changed. A changed source file also pulls in its sibling
 * `<name>.test.js`: scripts and hooks that tests only spawn are invisible to
 * the import graph. Non-JS files (docs, JSON, templates) are not locally
 * testable and are covered by the CI full-suite check.
 */
export function relatedCommand(files, { exists = existsSync, cwd = "." } = {}) {
  const js = (files || []).filter((f) => /\.[cm]?[jt]sx?$/.test(f));
  const set = new Set(js);
  for (const f of js) {
    const sib = f.replace(/\.([cm]?[jt]sx?)$/, ".test.$1");
    if (sib !== f && exists(join(cwd, sib))) set.add(sib);
  }
  const list = [...set].filter((f) => exists(join(cwd, f)));
  if (list.length === 0) return { empty: true, files: [] };
  return { cmd: `npx vitest related ${list.map(quoteArg).join(" ")} --run --passWithNoTests`, files: list };
}

/**
 * Where the full suite runs for this ship, and what ship_build runs locally.
 *
 * `testScope: "related"` (local = lint + tests related to the diff;
 * `fullSuiteVia: "ci"`: the CI `suite` check is the full-suite gate) only when
 * the project has that CI check and its quota is not known exhausted AND the
 * diff is safely computable. Everything else is `testScope: "full"` run
 * locally (`fullSuiteVia: "local"`) — the invariant "never merge without one
 * full green suite on the exact tree" then rests on the local record.
 *
 * @param {object} p
 * @param {boolean|null} [p.ciSuite] explicit override: true = assume the CI check, false = never
 * @param {boolean} p.workflowPresent  .github/workflows declares job `suite`
 * @param {boolean} p.githubOrigin     origin is on github.com
 * @param {boolean} p.quotaExhausted   a CI-quota record (Actions minutes out) is active
 * @param {{files: string[], deleted: string[]}|null} p.changed diff vs base
 * @param {string} [p.cwd]
 * @param {(f: string) => boolean} [p.exists]
 * @returns {{scope: "related"|"full", fullSuiteVia: "ci"|"local", reason: string, cmd?: string, files?: string[], empty?: boolean}}
 */
export function decideTestScope({ ciSuite = null, workflowPresent, githubOrigin, quotaExhausted, changed, cwd = ".", exists } = {}) {
  const full = (reason) => ({ scope: "full", fullSuiteVia: "local", reason });
  if (ciSuite === false) return full("ciSuite=false — full suite runs locally");
  if (ciSuite !== true && !(workflowPresent && githubOrigin)) {
    return full(`no CI full-suite check (needs a \`${CI_SUITE_JOB}\` job in .github/workflows and a github.com origin) — full suite runs locally`);
  }
  if (quotaExhausted) return full("CI quota (GitHub Actions minutes) is exhausted — full suite runs locally");
  if (!changed) return full("changed files vs the base branch could not be computed — full suite runs locally");
  if (changed.files.length === 0 && changed.deleted.length === 0) return full("no changes vs the base branch — full suite runs locally");
  if (changed.deleted.length > 0) return full(`deleted/renamed files (${changed.deleted[0]}${changed.deleted.length > 1 ? ", …" : ""}) — importers cannot be resolved, full suite runs locally`);
  const cfg = changed.files.find(isTestConfigFile);
  if (cfg) return full(`${cfg} changed — it can alter every test, full suite runs locally`);
  const rel = relatedCommand(changed.files, { cwd, ...(exists ? { exists } : {}) });
  if (rel.empty) {
    return { scope: "related", fullSuiteVia: "ci", empty: true, files: [], reason: "no JS/TS file changed — nothing to run locally, the CI full-suite check is the gate" };
  }
  if (rel.cmd.length > MAX_RELATED_CMD) return full("too many changed files for one related run — full suite runs locally");
  return {
    scope: "related", fullSuiteVia: "ci", cmd: rel.cmd, files: rel.files,
    reason: `lint + ${rel.files.length} related file(s) locally; the full suite is the CI \`${CI_SUITE_JOB}\` check`,
  };
}
