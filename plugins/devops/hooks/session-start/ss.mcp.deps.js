#!/usr/bin/env node
/**
 * @hook ss.mcp.deps
 * @version 0.2.0
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

function hasAllDeps(modulesDir) {
  if (!existsSync(modulesDir)) return false;
  return REQUIRED_PKGS.every((pkg) => existsSync(join(modulesDir, ...pkg.split("/"))));
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

// Step 1: Install dependencies if needed
if (needsInstall()) {
  console.error("[dotclaude] Installing MCP dependencies...");
  try {
    mkdirSync(PLUGIN_DATA, { recursive: true });
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
    process.exit(0); // Don't block session start
  }
}

// Step 2: Create symlinks so ESM resolver finds the packages
const symlinkTargets = [
  join(PLUGIN_ROOT, "mcp-server", "node_modules"),
  join(PLUGIN_ROOT, "mcp-server", "ship", "node_modules"),
  join(PLUGIN_ROOT, "mcp-server", "issues", "node_modules"),
];

for (const target of symlinkTargets) {
  try {
    if (existsSync(target)) {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
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
