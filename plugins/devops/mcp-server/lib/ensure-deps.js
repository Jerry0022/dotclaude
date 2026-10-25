/**
 * Shared dependency guard for the MCP servers and the ss.mcp.deps hook (#824).
 *
 * Race: after a plugin update Claude Code switches the plugin path and starts
 * the servers before node_modules exists there; they died in ~200 ms with
 * ERR_MODULE_NOT_FOUND and stayed down all session. The entry points now call
 * ensureDeps() before importing the SDK: happy path is ONE existsSync, the
 * broken path relinks PLUGIN_DATA/node_modules (and installs as a last resort)
 * and waits up to ~25 s. Node builtins only; never writes to stdout (it is the
 * JSON-RPC wire).
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** mcp-server/ of the plugin this file belongs to. */
export const MCP_ROOT = resolve(HERE, "..");

// Top-level runtime deps every MCP server needs (mcp-server/package.json).
export const REQUIRED_PKGS = ["@modelcontextprotocol/sdk", "zod"];

/**
 * A package counts only with its package.json: a directory alone is what an
 * interrupted install or a delete through a junction leaves behind.
 */
export function hasAllDeps(modulesDir) {
  if (!existsSync(modulesDir)) return false;
  return REQUIRED_PKGS.every((pkg) => existsSync(join(modulesDir, ...pkg.split("/"), "package.json")));
}

/** A link/dir is judged by what it reaches, not by being a link. */
export function linkHealthy(target) {
  try { return hasAllDeps(target); } catch { return false; }
}

/** The dirs whose node_modules must resolve for the ESM servers to boot. */
export function linkTargets(mcpRoot = MCP_ROOT) {
  return [
    join(mcpRoot, "node_modules"),
    join(mcpRoot, "ship", "node_modules"),
    join(mcpRoot, "issues", "node_modules"),
  ];
}

/**
 * Point every unhealthy target at `dataModules` (a complete install). Healthy
 * targets are kept; stale links are unlinked (never the target's files); a
 * partial real dir is replaced. Failures are non-fatal.
 */
export function relinkTargets(dataModules, targets = linkTargets()) {
  for (const target of targets) {
    try {
      let stat = null;
      try { stat = lstatSync(target); } catch { /* absent */ }
      if (stat) {
        if (hasAllDeps(target)) continue;
        if (stat.isSymbolicLink()) unlinkSync(target);
        else if (stat.isDirectory()) rmSync(target, { recursive: true, force: true });
      }
      symlinkSync(dataModules, target, "junction");
    } catch {
      // Symlink creation can fail on some systems — non-fatal
    }
  }
}

const LOCK_STALE_MS = 90_000;

/**
 * The one install lock for PLUGIN_DATA, shared by the ss.mcp.deps hook and the
 * servers: whoever holds it may delete and reinstall node_modules, everyone
 * else leaves it alone. Returns a release function, or null when another
 * process holds a lock younger than LOCK_STALE_MS.
 */
export function acquireInstallLock(pluginData) {
  const lock = join(pluginData, ".install.lock");
  try {
    mkdirSync(pluginData, { recursive: true });
    try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmdirSync(lock); } catch { /* none */ }
    mkdirSync(lock); // atomic: EEXIST means another process (hook/server) is on it
  } catch { return null; }
  return () => { try { rmdirSync(lock); } catch { /* ignore */ } };
}

/** Last resort: npm install into PLUGIN_DATA, once (one devops server per session since v0.309). */
function tryInstall(pluginData, mcpRoot) {
  const release = acquireInstallLock(pluginData);
  if (!release) return;
  try {
    const dataModules = join(pluginData, "node_modules");
    if (existsSync(dataModules) && !hasAllDeps(dataModules)) rmSync(dataModules, { recursive: true, force: true });
    writeFileSync(join(pluginData, "package.json"), readFileSync(join(mcpRoot, "package.json"), "utf8"));
  } catch { release(); return; }
  const child = execFile("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"],
    { cwd: pluginData, timeout: 60_000, windowsHide: true, shell: process.platform === "win32" },
    () => release());
  child.unref?.();
}

/** Mirrors the ESM resolver: any ancestor node_modules (dev checkout) counts. */
function resolvable(mcpRoot) {
  for (let d = mcpRoot; ; d = dirname(d)) {
    if (hasAllDeps(join(d, "node_modules"))) return true;
    if (dirname(d) === d) return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves once the SDK and zod resolve from this plugin copy. Otherwise
 * relinks/installs and polls; on timeout writes ONE stderr line and exits 1.
 * Options (tests): mcpRoot, pluginData, timeoutMs, pollMs, installAfterMs, exit.
 */
export async function ensureDeps(opts = {}) {
  const mcpRoot = opts.mcpRoot ?? MCP_ROOT;
  // Happy path: one existsSync.
  if (existsSync(join(mcpRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"))) return;

  const pluginData = opts.pluginData ?? process.env.CLAUDE_PLUGIN_DATA;
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.DEVOPS_MCP_DEPS_WAIT_MS) || 25_000);
  const pollMs = opts.pollMs ?? 100;
  const installAfterMs = opts.installAfterMs ?? 8_000;
  const exit = opts.exit ?? ((code) => process.exit(code));
  const targets = linkTargets(mcpRoot);
  const dataModules = pluginData ? join(pluginData, "node_modules") : null;
  const start = Date.now();
  let installTried = false;

  for (;;) {
    if (resolvable(mcpRoot)) return;
    if (dataModules && hasAllDeps(dataModules)) {
      relinkTargets(dataModules, targets);
      if (hasAllDeps(targets[0])) return;
    }
    const waited = Date.now() - start;
    if (!installTried && pluginData && waited >= installAfterMs) {
      installTried = true;
      tryInstall(pluginData, mcpRoot);
    }
    if (waited >= timeoutMs) break;
    await sleep(pollMs);
  }
  process.stderr.write(
    `[dotclaude] MCP server cannot start: dependencies (${REQUIRED_PKGS.join(", ")}) not found in ` +
    `${join(mcpRoot, "node_modules")} after ${Math.round((Date.now() - start) / 1000)} s` +
    (pluginData ? "" : " (CLAUDE_PLUGIN_DATA unset)") + " - run /devops-update or restart the session.\n");
  exit(1);
}
