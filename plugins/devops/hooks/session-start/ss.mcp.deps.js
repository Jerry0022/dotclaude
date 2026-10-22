#!/usr/bin/env node
/**
 * @hook ss.mcp.deps
 * @version 0.5.1
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
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { acquireInstallLock, hasAllDeps, linkHealthy, linkTargets, relinkTargets } from "../../mcp-server/lib/ensure-deps.js";

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

const symlinkTargets = linkTargets(join(PLUGIN_ROOT, "mcp-server"));

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

// Step 1: Install dependencies if needed — under the install lock the servers
// take too (#824), so a waiting server never deletes this install mid-run.
if (needsInstall()) {
  const releaseLock = acquireInstallLock(PLUGIN_DATA);
  if (!releaseLock) {
    // A server is installing right now; it relinks itself when done.
    console.error("[dotclaude] MCP dependencies are being installed by another process — skipping.");
    releaseOnce("ss-mcp-deps", null);
    process.exit(0);
  }
  console.error("[dotclaude] Installing MCP dependencies...");
  try {
    mkdirSync(PLUGIN_DATA, { recursive: true });
    // npm trusts node_modules/.package-lock.json and skips a package whose
    // directory exists, so a truncated install would survive `npm install`.
    if (existsSync(DATA_MODULES) && !hasAllDeps(DATA_MODULES)) {
      rmSync(DATA_MODULES, { recursive: true, force: true });
    }
    writeFileSync(CACHED_PKG, readFileSync(SOURCE_PKG, "utf8"));

    execSync("npm install --omit=dev --no-fund --no-audit", { windowsHide: true,
      cwd: PLUGIN_DATA,
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    releaseLock();
    console.error("[dotclaude] MCP dependencies installed.");
  } catch (err) {
    console.error("[dotclaude] Failed to install MCP dependencies:", err.message);
    try { unlinkSync(CACHED_PKG); } catch { /* ignore */ }
    releaseLock();
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

// Step 2: Create symlinks so ESM resolver finds the packages (shared with the servers, #824)
relinkTargets(DATA_MODULES, symlinkTargets);
