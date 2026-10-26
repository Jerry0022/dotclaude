/**
 * @module ship-timings
 * @version 0.1.0
 * @plugin devops
 * @description Ship telemetry: one JSON line per ship_* tool call in
 *   ~/.claude/ship-timings.jsonl (append-only, truncated to its newer half past
 *   ~5 MB). Written by ship/cli.js — the executor of every ship tool, MCP and
 *   offline — and read back by the completion card (`summarizeShip`).
 *
 *   Line: { ts, repo, branch, tool, durationMs, outcome, repeat, ...extras }
 *   `ts` is the call's START (ISO). `repeat` counts the same tool on the same
 *   repo+branch within one ship (a ship starts at its ship_preflight), so 1 =
 *   first run and 2+ = a rerun. Telemetry never fails a ship: every export
 *   swallows its errors.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const MAX_BYTES = 5 * 1024 * 1024;
/** How much of the file's end is read to find the current ship — a ship is minutes, not megabytes. */
const TAIL_BYTES = 512 * 1024;

export function defaultTimingsPath() {
  return process.env.DOTCLAUDE_SHIP_TIMINGS_FILE || path.join(os.homedir(), ".claude", "ship-timings.jsonl");
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Repo identity: origin url (credentials stripped), else the toplevel's basename. */
export function repoKey(cwd) {
  const url = git(["config", "--get", "remote.origin.url"], cwd).replace(/\/\/[^@/]+@/, "//");
  if (url) return url;
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  return path.basename(top || cwd || "");
}

/** outcome of a handler result: error | blocked | success. */
export function outcomeOf(result) {
  if (!result || typeof result !== "object") return "success";
  if (result.error) return "error";
  if (result.success === false || result.ok === false || result.blocked === true) return "blocked";
  return "success";
}

/** Tool-specific extras: build → per-step ms, testsReused, lock wait; release → checks wait. */
export function extrasOf(tool, result) {
  const out = {};
  try {
    if (!result || typeof result !== "object") return out;
    if (tool === "ship_build") {
      if (Array.isArray(result.steps)) {
        out.stepMs = Object.fromEntries(result.steps.filter((s) => s && s.step && Number.isFinite(s.durationMs)).map((s) => [s.step, s.durationMs]));
      }
      out.testsReused = Boolean(result.testsReused);
      const wait = result.load?.lockWaitMs;
      if (Number.isFinite(wait)) out.lockWaitMs = wait;
    }
    if (tool === "ship_release") {
      const c = result.checks || result.checkResult || {};
      const wait = c.waitedMs ?? c.elapsedMs ?? c.durationMs;
      if (Number.isFinite(wait)) out.checksWaitMs = wait;
    }
  } catch { /* extras are optional */ }
  return out;
}

function readTail(file, bytes = TAIL_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (size > len) lines.shift(); // first line is cut mid-way
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(lines) {
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    try { const e = JSON.parse(l); if (e && typeof e === "object") out.push(e); } catch { /* torn line */ }
  }
  return out;
}

/** Entries of the ship in progress / just finished: same repo+branch, from its latest ship_preflight on. */
function currentShip(entries, repo, branch) {
  const mine = entries.filter((e) => e.repo === repo && e.branch === branch);
  let start = 0;
  mine.forEach((e, i) => { if (e.tool === "ship_preflight") start = i; });
  return mine.slice(start);
}

function rotate(file, maxBytes) {
  if (fs.statSync(file).size <= maxBytes) return;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
}

/**
 * Append one timing line. Never throws; returns the written entry or null.
 * @param {object} o
 * @param {string} o.cwd
 * @param {string} o.tool
 * @param {number} o.startedAt  epoch ms of the call's start
 * @param {number} [o.durationMs]
 * @param {object} [o.result]   the handler result (outcome + extras derive from it)
 * @param {string} [o.outcome]  overrides outcomeOf(result)
 * @param {string} [o.branch]
 * @param {string} [o.file]     override of the telemetry file (tests)
 * @param {number} [o.maxBytes]
 */
export function recordTiming(o) {
  try {
    const file = o.file || defaultTimingsPath();
    const repo = o.repo || repoKey(o.cwd);
    const branch = o.branch || git(["rev-parse", "--abbrev-ref", "HEAD"], o.cwd);
    let repeat = 1;
    try {
      if (o.tool !== "ship_preflight" && fs.existsSync(file)) {
        repeat += currentShip(parseLines(readTail(file)), repo, branch).filter((e) => e.tool === o.tool).length;
      }
    } catch { /* counter is best effort */ }
    const entry = {
      ts: new Date(o.startedAt).toISOString(), repo, branch, tool: o.tool,
      durationMs: Math.max(0, Math.round(o.durationMs ?? (Date.now() - o.startedAt))),
      outcome: o.outcome || outcomeOf(o.result), repeat, ...extrasOf(o.tool, o.result),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
    try { rotate(file, o.maxBytes ?? MAX_BYTES); } catch { /* rotation is best effort */ }
    return entry;
  } catch {
    return null;
  }
}

/**
 * Timing summary of the ship on `branch` since its latest ship_preflight.
 * @returns {{totalMs:number, perTool:Object<string,number>, repeats:Object<string,number>, calls:number}|null}
 *   totalMs = first call's start to last call's end (wall clock, includes the
 *   agent's thinking time between tools); perTool = summed durations;
 *   repeats = tools run more than once → run count. null when no data.
 */
export function summarizeShip({ cwd, branch, file } = {}) {
  try {
    const f = file || defaultTimingsPath();
    if (!fs.existsSync(f)) return null;
    const repo = repoKey(cwd);
    const br = branch || git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const ship = currentShip(parseLines(readTail(f)), repo, br);
    if (!ship.length) return null;
    const perTool = {};
    const runs = {};
    let first = Infinity;
    let last = 0;
    for (const e of ship) {
      const start = Date.parse(e.ts);
      if (!Number.isFinite(start)) continue;
      first = Math.min(first, start);
      last = Math.max(last, start + (e.durationMs || 0));
      perTool[e.tool] = (perTool[e.tool] || 0) + (e.durationMs || 0);
      runs[e.tool] = (runs[e.tool] || 0) + 1;
    }
    if (!Number.isFinite(first)) return null;
    const repeats = Object.fromEntries(Object.entries(runs).filter(([, n]) => n > 1));
    return { totalMs: last - first, perTool, repeats, calls: ship.length };
  } catch {
    return null;
  }
}

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;

/** The card's `tests` entry for a summary: Ship-Dauer / "7:40 min (Build 2:10 · Release 1:15)"; null without data. */
export function shipDurationTest(summary, lang = "de") {
  if (!summary || !(summary.totalMs > 0)) return null;
  const names = { ship_build: "Build", ship_release: "Release", ship_preflight: "Preflight" };
  const parts = Object.entries(names)
    .filter(([tool]) => summary.perTool[tool] >= 1000)
    .map(([tool, label]) => `${label} ${fmt(summary.perTool[tool])}`);
  return {
    method: lang === "en" ? "Ship duration" : "Ship-Dauer",
    result: `${fmt(summary.totalMs)} min${parts.length ? ` (${parts.join(" · ")})` : ""}`,
  };
}
