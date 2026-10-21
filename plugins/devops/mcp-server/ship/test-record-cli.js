#!/usr/bin/env node
/**
 * @module dotclaude-test-record-cli
 * @plugin devops
 * @description Record a green full-suite run so ship_build can reuse it (#762).
 *
 *     node mcp-server/ship/test-record-cli.js run    --cwd <repo> [--cmd "npm test"]
 *     node mcp-server/ship/test-record-cli.js key    --cwd <repo>
 *     node mcp-server/ship/test-record-cli.js record --cwd <repo> --tree <hash> [--cmd "npm test"]
 *
 *   run    — computes the tree key, runs the command (output streams through),
 *            and records it green when it exits 0 AND the tree did not change
 *            during the run. Exit code = the command's exit code.
 *   key    — prints the current tree key as `[test-record] {"treeHash":…}` on
 *            stderr (capture it BEFORE a run you start yourself).
 *   scope  — --files a,b: prints `npx vitest related <files> --run`, or "full"
 *            when any file is not imported by a test (hooks/scripts spawned
 *            via execFile, JSON, Markdown). Agent loops only; scoped runs are
 *            never recorded, the ship gate always runs the full suite.
 *   record — records a run you already finished green; refused (exit 3) when
 *            the current tree no longer matches --tree.
 *
 *   Store and key semantics: lib/test-results.js. Prints one JSON line
 *   `[test-record] {...}` to stderr; never fails a green run over a store error.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { recordResult, treeKey, usualDurationMs } from "./lib/test-results.js";
import { buildPreRunWarning, readLockHolder } from "./lib/test-step.js";

const DEFAULT_CMD = "npm test";

export function parseArgs(argv) {
  const [sub, ...rest] = argv;
  const out = { sub, cwd: process.cwd(), cmd: DEFAULT_CMD, tree: null, files: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--cwd") out.cwd = rest[++i];
    else if (a === "--cmd") out.cmd = rest[++i];
    else if (a === "--tree") out.tree = rest[++i];
    else if (a === "--files") out.files = String(rest[++i] || "").split(",");
  }
  out.cwd = resolve(out.cwd || ".");
  return out;
}

/** A command that runs only part of the suite — never recorded. */
export function isScopedCmd(cmd) {
  return /\bvitest\s+related\b|--changed\b|\.test\.[cm]?[jt]sx?\b/.test(String(cmd));
}

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const IMPORTABLE = /\.[cm]?[jt]sx?$/;
const SPAWNED_DIRS = /(^|[\\/])(hooks|scripts)[\\/]/;
const IN_DIR = /[\\/]/;

const quote = (f) => (/[\s"]/.test(f) ? `"${f.replace(/"/g, '\\"')}"` : f);

/**
 * Command for an iteration run over `files`: `npx vitest related <files> --run`
 * when every file is JS/TS outside hooks/scripts (or is a test file itself),
 * otherwise "full" — the import graph is blind to execFile-spawned scripts,
 * JSON and Markdown, and to root-level config files (vitest.config.js,
 * eslint.config.js) that change every run without being imported.
 */
export function scope(files) {
  const list = (files || []).map((f) => String(f).trim()).filter(Boolean);
  if (list.length === 0) return "full";
  const covered = (f) => TEST_FILE.test(f) || (IMPORTABLE.test(f) && IN_DIR.test(f) && !SPAWNED_DIRS.test(f));
  return list.every(covered) ? `npx vitest related ${list.map(quote).join(" ")} --run` : "full";
}

/** Pre-run load warning from the lock file (the CLI's run path is synchronous: no CPU sample). */
function defaultPreRun(cwd, cmd) {
  const holder = readLockHolder();
  return holder ? buildPreRunWarning({ holder, usualMs: usualDurationMs(cwd, cmd) }) : null;
}

function say(log, obj) {
  log(`[test-record] ${JSON.stringify(obj)}\n`);
}

/** Returns the exit code. `deps` exists for tests. */
export function main(argv, { exec = (cmd, cwd) => spawnSync(cmd, { windowsHide: true, cwd, shell: true, stdio: "inherit" }).status ?? 1,
  key = treeKey, record = recordResult, preRun = defaultPreRun, log = (s) => process.stderr.write(s), now = () => Date.now() } = {}) {
  const a = parseArgs(argv);
  if (a.sub === "key") {
    const k = key(a.cwd);
    if (!k) { say(log, { ok: false, reason: "no tree key (not a git repo?)" }); return 2; }
    // stderr like every line here: files under mcp-server/ keep stdout for the MCP wire.
    say(log, { ok: true, treeHash: k.treeHash, method: k.method });
    return 0;
  }
  if (a.sub === "record") {
    if (!a.tree) { say(log, { ok: false, reason: "--tree <hash> is required" }); return 2; }
    const k = key(a.cwd);
    if (!k || k.treeHash !== a.tree) {
      say(log, { ok: false, reason: "tree changed since the run — not recorded", tree: a.tree, now: k?.treeHash ?? null });
      return 3;
    }
    const rec = record(a.cwd, { treeHash: a.tree, testCmd: a.cmd, passed: true, source: "agent" });
    say(log, { ok: !!rec, recorded: rec });
    return rec ? 0 : 1;
  }
  if (a.sub === "scope") {
    log(`${scope(a.files)}\n`);
    return 0;
  }
  if (a.sub === "run") {
    const scoped = isScopedCmd(a.cmd);
    const warning = scoped ? null : preRun(a.cwd, a.cmd);
    if (warning) log(`[test-record] ${warning.note}\n`);
    const before = key(a.cwd);
    const started = now();
    const code = exec(a.cmd, a.cwd);
    if (code !== 0) { say(log, { ok: false, reason: `command exited ${code} — nothing recorded` }); return code; }
    if (scoped) { say(log, { ok: true, scoped: true, reason: "scoped run — not recorded" }); return 0; }
    const after = key(a.cwd);
    if (!before || !after || before.treeHash !== after.treeHash) {
      say(log, { ok: false, reason: "tree changed during the run (or no git tree) — green run not recorded" });
      return 0;
    }
    const rec = record(a.cwd, { treeHash: before.treeHash, testCmd: a.cmd, passed: true, durationMs: now() - started, source: "agent" });
    say(log, { ok: !!rec, recorded: rec });
    return 0;
  }
  say(log, { ok: false, reason: `unknown subcommand ${a.sub ?? "(none)"} — use run | key | record` });
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
