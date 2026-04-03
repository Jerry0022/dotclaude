#!/usr/bin/env node
/**
 * SessionStart hook: install MCP server dependencies into CLAUDE_PLUGIN_DATA.
 *
 * Follows the official Claude Code plugin pattern:
 *   1. Compare mcp-server/package.json against the cached copy in PLUGIN_DATA
 *   2. If they differ (first run or dependency update), run `npm install`
 *   3. Symlink PLUGIN_DATA/node_modules into mcp-server/ dirs for ESM resolution
 *   4. On failure, remove the cached package.json so next session retries
 *
 * Why symlink instead of NODE_PATH?
 *   Node.js ESM resolver ignores NODE_PATH for package imports (import ... from "pkg").
 *   A symlink in the mcp-server directory lets the standard ESM resolver find packages.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, mkdirSync, existsSync, unlinkSync, lstatSync } from "node:fs";
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

function needsInstall() {
  if (!existsSync(CACHED_PKG) || !existsSync(DATA_MODULES)) return true;
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
    // Skip if already correctly linked
    if (existsSync(target)) {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) continue;
      // Real directory from dev environment — skip, don't overwrite
      if (stat.isDirectory()) continue;
    }
    symlinkSync(DATA_MODULES, target, "junction");
  } catch {
    // Symlink creation can fail on some systems — non-fatal
  }
}
