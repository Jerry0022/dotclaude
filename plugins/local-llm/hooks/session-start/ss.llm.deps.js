#!/usr/bin/env node
/**
 * @hook ss.llm.deps
 * @version 0.1.0
 * @event SessionStart
 * @plugin local-llm
 * @description Install MCP server dependencies into CLAUDE_PLUGIN_DATA.
 *   Same pattern as devops plugin's ss.mcp.deps.js.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, mkdirSync, existsSync, unlinkSync, lstatSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname, "../..");

const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA;
if (!PLUGIN_DATA) {
  process.exit(0);
}

const SOURCE_PKG = join(PLUGIN_ROOT, "mcp-server", "package.json");
const CACHED_PKG = join(PLUGIN_DATA, "package.json");
const DATA_MODULES = join(PLUGIN_DATA, "node_modules");

// Required top-level deps that must be present after install. Add any new
// runtime dep here so a corrupt/partial node_modules gets detected and redone.
const REQUIRED_DEPS = ["@modelcontextprotocol/sdk", "zod"];

function dataModulesIntact() {
  if (!existsSync(DATA_MODULES)) return false;
  return REQUIRED_DEPS.every((dep) => existsSync(join(DATA_MODULES, dep)));
}

function needsInstall() {
  if (!existsSync(CACHED_PKG) || !dataModulesIntact()) return true;
  try {
    const source = readFileSync(SOURCE_PKG, "utf8");
    const cached = readFileSync(CACHED_PKG, "utf8");
    return source !== cached;
  } catch {
    return true;
  }
}

if (needsInstall()) {
  console.error("[local-llm] Installing MCP dependencies...");
  try {
    mkdirSync(PLUGIN_DATA, { recursive: true });
    writeFileSync(CACHED_PKG, readFileSync(SOURCE_PKG, "utf8"));

    execSync("npm install --omit=dev --no-fund --no-audit", {
      cwd: PLUGIN_DATA,
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    console.error("[local-llm] MCP dependencies installed.");
  } catch (err) {
    console.error("[local-llm] Failed to install MCP dependencies:", err.message);
    try { unlinkSync(CACHED_PKG); } catch {}
    process.exit(0);
  }
}

// Symlink node_modules into mcp-server/ for ESM resolution.
// If a real directory is already there, verify it has the required deps —
// if not, it's a stale/corrupt leftover and we replace it with a symlink
// pointing at the authoritative PLUGIN_DATA install.
const target = join(PLUGIN_ROOT, "mcp-server", "node_modules");

function targetIsIntact(p) {
  return REQUIRED_DEPS.every((dep) => existsSync(join(p, dep)));
}

try {
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) process.exit(0);
    if (stat.isDirectory()) {
      if (targetIsIntact(target)) process.exit(0);
      // Corrupt leftover — wipe and re-symlink.
      console.error("[local-llm] mcp-server/node_modules is incomplete — replacing with symlink.");
      rmSync(target, { recursive: true, force: true });
    }
  }
  symlinkSync(DATA_MODULES, target, "junction");
} catch (err) {
  console.error("[local-llm] Symlink step failed:", err.message);
}
