#!/usr/bin/env node
/**
 * @hook ss.mcp.deps
 * @version 0.3.0
 * @event SessionStart
 * @plugin devops
 * @description Auto-install MCP server dependencies into CLAUDE_PLUGIN_DATA,
 *   and self-heal partial installs left by an incomplete cache sync (#190).
 *
 *   Follows the official Claude Code plugin pattern:
 *     1. Compare mcp-server/package.json against the cached copy in PLUGIN_DATA
 *     2. If they differ (first run or dependency update), run `npm install`
 *     3. Symlink PLUGIN_DATA/node_modules into mcp-server/ dirs for ESM resolution
 *     4. On failure, remove the cached package.json so next session retries
 *
 *   Why symlink instead of NODE_PATH?
 *     Node.js ESM resolver ignores NODE_PATH for package imports (import ... from "pkg").
 *     A symlink in the mcp-server directory lets the standard ESM resolver find packages.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, mkdirSync, existsSync, unlinkSync, lstatSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runOnce, releaseOnce } = require("../lib/run-once.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname, "../..");

const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA;
if (!PLUGIN_DATA) {
  // Not running as a plugin — skip silently (e.g. local dev)
  process.exit(0);
}

const SOURCE_PKG = join(PLUGIN_ROOT, "mcp-server", "package.json");
const CACHED_PKG = join(PLUGIN_DATA, "package.json");
const DATA_MODULES = join(PLUGIN_DATA, "node_modules");

// Top-level runtime deps every MCP server needs (from mcp-server/package.json).
// Their presence is the completeness signal: a partial node_modules (the
// failure mode in issue #190) lacks these even when the directory exists.
const REQUIRED_PKGS = ["@modelcontextprotocol/sdk", "zod"];

// A package counts only with its package.json: a directory alone is what an
// interrupted install or a delete through a junction leaves behind (the SDK
// with just LICENSE + dist/), and the ESM resolver cannot load it.
function hasAllDeps(modulesDir) {
  if (!existsSync(modulesDir)) return false;
  return REQUIRED_PKGS.every((pkg) => existsSync(join(modulesDir, ...pkg.split("/"), "package.json")));
}

function needsInstall() {
  if (!existsSync(CACHED_PKG) || !existsSync(DATA_MODULES)) return true;
  // Heal partial installs: a node_modules missing the required packages
  // (interrupted/incomplete cache sync) must be reinstalled, not trusted.
  if (!hasAllDeps(DATA_MODULES)) return true;
  try {
    const source = readFileSync(SOURCE_PKG, "utf8");
    const cached = readFileSync(CACHED_PKG, "utf8");
    return source !== cached;
  } catch {
    return true;
  }
}

// The dirs whose node_modules must resolve for the ESM servers to boot.
const symlinkTargets = [
  join(PLUGIN_ROOT, "mcp-server", "node_modules"),
  join(PLUGIN_ROOT, "mcp-server", "ship", "node_modules"),
  join(PLUGIN_ROOT, "mcp-server", "issues", "node_modules"),
];

/** A link/dir that the ESM resolver will actually find the packages through. */
function linkHealthy(target) {
  try {
    // A link is judged by what it reaches, not by being a link: a junction to
    // a truncated install must be relinked, not trusted.
    return hasAllDeps(target);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cooldown gate (#324)
//
// This hook runs concurrently with the MCP servers' 30 s connect window. Its
// worst case — `npm install` with a 60 s budget — is exactly the kind of load
// that starved them. But it must never trade a working session for quiet: the
// gate only applies when NOTHING is broken. The integrity probe below is pure
// existsSync/lstatSync, so deciding is free; the moment a dep or a link is
// missing we install/relink regardless of the cooldown, because the servers
// simply would not boot otherwise.
//
// Bypass: `--force` (used by /auto-update, which owns the explicit path) or
// DEVOPS_MCP_DEPS_FORCE=1.
// ---------------------------------------------------------------------------
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FORCE = process.argv.includes("--force") || process.env.DEVOPS_MCP_DEPS_FORCE === "1";
const broken = needsInstall() || symlinkTargets.some((t) => !linkHealthy(t));

if (!broken && !FORCE && !runOnce("ss-mcp-deps", null, { cooldownMs: COOLDOWN_MS })) {
  process.exit(0);
}

// Step 1: Install dependencies if needed
if (needsInstall()) {
  console.error("[dotclaude] Installing MCP dependencies...");
  try {
    mkdirSync(PLUGIN_DATA, { recursive: true });
    // npm trusts node_modules/.package-lock.json and skips a package whose
    // directory exists, so a truncated install would survive `npm install`.
    if (existsSync(DATA_MODULES) && !hasAllDeps(DATA_MODULES)) {
      rmSync(DATA_MODULES, { recursive: true, force: true });
    }
    writeFileSync(CACHED_PKG, readFileSync(SOURCE_PKG, "utf8"));

    execSync("npm install --omit=dev --no-fund --no-audit", {
      cwd: PLUGIN_DATA,
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    console.error("[dotclaude] MCP dependencies installed.");
  } catch (err) {
    console.error("[dotclaude] Failed to install MCP dependencies:", err.message);
    try { unlinkSync(CACHED_PKG); } catch { /* ignore */ }
    // Hand the cooldown token back — the work did not succeed, so the next
    // session must be free to retry instead of waiting out 24 h on a failure.
    releaseOnce("ss-mcp-deps", null);
    process.exit(0); // Don't block session start
  }
}

// Never link to an install that cannot serve the imports (#190, truncated SDK).
if (!hasAllDeps(DATA_MODULES)) {
  console.error("[dotclaude] MCP dependencies incomplete — not linking them.");
  try { unlinkSync(CACHED_PKG); } catch { /* ignore */ }
  releaseOnce("ss-mcp-deps", null);
  process.exit(0);
}

// Step 2: Create symlinks so ESM resolver finds the packages
for (const target of symlinkTargets) {
  try {
    let stat = null;
    try { stat = lstatSync(target); } catch { /* absent */ }
    if (stat) {
      if (stat.isSymbolicLink()) {
        if (hasAllDeps(target)) continue;
        // Stale or dangling junction (e.g. to another plugin id's truncated
        // install): unlink removes only the link, never the target's files.
        unlinkSync(target);
      } else if (stat.isDirectory()) {
        // Real directory: keep it only if it is a complete install (a dev
        // checkout or a healthy cache). A partial real dir (issue #190 — the
        // cache sync dropped deps) shadows the shared node_modules and makes
        // the server crash; replace it with a junction to the healed copy.
        if (hasAllDeps(target)) continue;
        rmSync(target, { recursive: true, force: true });
      }
    }
    symlinkSync(DATA_MODULES, target, "junction");
  } catch {
    // Symlink creation can fail on some systems — non-fatal
  }
}
