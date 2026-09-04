/**
 * @module cache-rebuild
 * @version 0.1.0
 * @description The plugin-cache rebuild used by ss.plugin.update — extracted so
 *   it can run OUT OF BAND, in a detached child process, long after the MCP
 *   connect window has closed.
 *
 *   Why (#324): `.mcp.json` sets the cached version dir
 *   (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) as the `cwd`
 *   AND the require() root of all three MCP servers. The rebuild used to
 *   `fs.cpSync(recursive, force)` 10 521 files — 10 176 of them node_modules,
 *   in three copies — into exactly that directory while the servers were
 *   booting against a 30 s connect budget. Servers that boot in < 2.5 s
 *   standalone hit CONNECT_TIMEOUT.
 *
 *   Two independent mitigations, both applied:
 *
 *   1. node_modules is NEVER copied. It is the bulk (97 %) of the tree and it
 *      is not plugin source: ss.mcp.deps.js already owns dependency resolution
 *      and junctions a single shared install into each server dir. The rebuild
 *      keeps whatever node_modules the target already has, or junctions the
 *      source's, and only drops it when the declared dependency set changed.
 *
 *   2. When the target version dir is CLAIMED by a live session (Claude Code's
 *      own `.in_use/<pid>` reference counting — see cache-inuse.js), the whole
 *      rebuild is deferred into a detached child that waits out the connect
 *      window before writing a single byte. That is precisely the same-version
 *      "cache repair" case, which is silent housekeeping the user cannot act on
 *      anyway (see ss.plugin.update's `reportable` filter) — so deferring costs
 *      no reporting fidelity. A rebuild into a NEW version dir is not deferred:
 *      no running server has that dir as its cwd, and the user is waiting for
 *      the restart notice.
 */

'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prunableEntries, isVersionDirInUse } = require('./cache-inuse');

/** How long the deferred child waits before touching the cache. */
const DEFER_DELAY_MS = 60_000;

/** Server dirs whose node_modules the rebuild links instead of copying. */
const MODULE_DIRS = [
  path.join('mcp-server'),
  path.join('mcp-server', 'ship'),
  path.join('mcp-server', 'issues'),
];

// Candidate set of files whose absence means a cache is functionally broken
// even when its version/sha look correct (issue #190 — sync dropped mcp-server
// files and .mcp.json, so the MCP servers never registered). This is a SUPERSET
// across plugins, NOT a list every plugin ships: missingMcpFiles() asserts only
// the entries a given plugin's SOURCE actually has.
const MCP_CRITICAL_FILES = [
  '.mcp.json',
  path.join('mcp-server', 'index.js'),
  path.join('mcp-server', 'lib', 'heartbeat.js'),
  path.join('mcp-server', 'ship', 'index.js'),
  path.join('mcp-server', 'issues', 'index.js'),
];

function hasMcpServer(root) {
  return fs.existsSync(path.join(root, '.mcp.json'));
}

/**
 * The MCP-critical files missing from `targetRoot`, asserted PER-PLUGIN against
 * what the SOURCE actually ships. The gate is the SOURCE's .mcp.json — a target
 * whose own .mcp.json was dropped must not report "nothing to assert" and mask
 * the very breakage we check for (issue #190).
 */
function missingMcpFiles(targetRoot, sourceRoot) {
  if (!hasMcpServer(sourceRoot)) return [];
  return MCP_CRITICAL_FILES.filter(
    (rel) => fs.existsSync(path.join(sourceRoot, rel)) && !fs.existsSync(path.join(targetRoot, rel)),
  );
}

function getVersion(dir) {
  const pluginJson = path.join(dir, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(pluginJson)) return null;
  try {
    return JSON.parse(fs.readFileSync(pluginJson, 'utf8')).version || null;
  } catch {
    return null;
  }
}

/**
 * Fingerprint of a plugin's declared MCP dependency set.
 *
 * Prefers the lock file when one exists (exact resolution); falls back to
 * mcp-server/package.json, which is what this repo actually ships — the lock is
 * gitignored, so package.json IS the declaration of record here.
 *
 * @returns {string|null} null when the plugin has no MCP dependency manifest
 */
function depsHash(root) {
  for (const rel of [path.join('mcp-server', 'package-lock.json'), path.join('mcp-server', 'package.json')]) {
    const file = path.join(root, rel);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return crypto.createHash('sha1').update(raw).digest('hex');
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Copy the plugin tree WITHOUT node_modules.
 *
 * Gate the shell fallback on fs.cpSync being genuinely UNAVAILABLE — not on it
 * throwing. A throw is a REAL copy failure (e.g. Windows EBUSY/EPERM on a file
 * Claude Code holds open), which must surface: an in-place repair over an
 * existing version dir would otherwise leave the old plugin.json in place and
 * let a half-updated cache pass the existence check below, advancing the
 * registry SHA over broken files and suppressing next session's self-heal.
 *
 * @returns {boolean} true when the copy produced a plausible plugin root
 */
function copyDir(src, dst) {
  if (typeof fs.cpSync !== 'function') {
    // Last-resort fallback for environments without fs.cpSync. Never reached on
    // any supported Node; kept so an ancient runtime degrades instead of crashing.
    try {
      fs.mkdirSync(dst, { recursive: true });
      copyRecursiveSync(src, dst);
    } catch {
      return false;
    }
    return fs.existsSync(path.join(dst, '.claude-plugin', 'plugin.json'));
  }

  try {
    fs.cpSync(src, dst, {
      recursive: true,
      force: true,
      // The single biggest win of #324: node_modules is 97 % of the file count
      // and none of it is plugin source. Skipping it turns a 10 000-file bulk
      // write into a few hundred small files.
      filter: (source) => path.basename(source) !== 'node_modules',
    });
  } catch {
    return false;
  }

  return fs.existsSync(path.join(dst, '.claude-plugin', 'plugin.json'));
}

/** Minimal recursive copy for the no-cpSync fallback. */
function copyRecursiveSync(src, dst) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecursiveSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Give the target its node_modules back after a node_modules-free copy.
 *
 *   - already present + deps unchanged → leave it alone (the cheap path)
 *   - deps changed → drop it, so ss.mcp.deps.js reinstalls a correct tree
 *   - absent → junction the source's tree in; copy only if linking is denied
 *
 * Never throws: a missing node_modules is self-healing (ss.mcp.deps.js relinks
 * it at the next session start), a broken one is not — so every failure path
 * here ends in "absent", never "half-copied".
 *
 * @returns {{linked: string[], copied: string[], dropped: string[]}}
 */
function syncNodeModules(src, dst, { depsChanged = false } = {}) {
  const report = { linked: [], copied: [], dropped: [] };
  for (const rel of MODULE_DIRS) {
    const targetParent = path.join(dst, rel);
    if (!fs.existsSync(targetParent)) continue; // plugin has no such server dir
    const s = path.join(src, rel, 'node_modules');
    const d = path.join(targetParent, 'node_modules');

    if (fs.existsSync(d)) {
      if (!depsChanged) continue; // reuse — nothing to do
      try {
        fs.rmSync(d, { recursive: true, force: true });
        report.dropped.push(rel);
      } catch {
        continue; // still in use — leave it; ss.mcp.deps heals next session
      }
    }

    if (!fs.existsSync(s)) continue; // nothing to link to
    try {
      fs.symlinkSync(fs.realpathSync(s), d, 'junction');
      report.linked.push(rel);
    } catch {
      // EPERM (no symlink privilege) or a cross-device oddity — fall back to a
      // real copy so the target is usable, accepting the IO cost.
      try {
        fs.cpSync(s, d, { recursive: true, force: true });
        report.copied.push(rel);
      } catch {
        // Leave it absent — ss.mcp.deps.js junctions a shared install in.
      }
    }
  }
  return report;
}

/**
 * Rebuild one plugin's cache version dir and point the registry at it.
 *
 * @param {object} opts
 * @param {string} opts.marketplace
 * @param {string} opts.pluginName
 * @param {string} opts.pluginDir     source (marketplace clone) plugin root
 * @param {string} opts.version
 * @param {string} opts.sha
 * @param {string} opts.cacheDir      ~/.claude/plugins/cache
 * @param {string} opts.registryFile  ~/.claude/plugins/installed_plugins.json
 * @param {string} [opts.channel]
 * @returns {{ok: boolean, installPath?: string, missing?: string, mismatch?: string}}
 */
function rebuildCache(opts) {
  const {
    marketplace, pluginName, pluginDir, version, sha,
    cacheDir, registryFile, channel = 'stable',
  } = opts;

  const pluginCache = path.join(cacheDir, marketplace, pluginName);
  const newCache = path.join(pluginCache, version);

  // Prune old version dirs — but only the ones nothing is standing on. The dir
  // being rebuilt survives (deleting + recreating it mid-session changes its
  // identity and de-registers the plugin's skills/slash-commands, #219), and so
  // does any older dir another live session still claims (#319): those are the
  // CLAUDE_PLUGIN_ROOT of that session's MCP servers.
  for (const entry of prunableEntries(pluginCache, version)) {
    try {
      fs.rmSync(path.join(pluginCache, entry), { recursive: true, force: true });
    } catch { /* claimed by something we cannot see — leave it for Claude's sweeper */ }
  }

  const depsChanged = depsHash(pluginDir) !== depsHash(newCache);

  fs.mkdirSync(newCache, { recursive: true });

  if (!copyDir(pluginDir, newCache)) {
    return { ok: false, missing: 'copy failed — .claude-plugin/plugin.json not found after copy' };
  }
  syncNodeModules(pluginDir, newCache, { depsChanged });

  // Completeness, asserted PER-PLUGIN against what the SOURCE ships. Requiring
  // both skills/ and hooks/ unconditionally fails every plugin that ships only
  // one of them, which made rebuildCache loop forever on those plugins.
  for (const dirName of ['skills', 'hooks']) {
    if (!fs.existsSync(path.join(pluginDir, dirName))) continue;
    if (!fs.existsSync(path.join(newCache, dirName))) {
      return { ok: false, missing: path.join(newCache, dirName) };
    }
  }

  const mcpMissing = missingMcpFiles(newCache, pluginDir);
  if (mcpMissing.length) {
    return { ok: false, missing: `mcp-server files: ${mcpMissing.join(', ')}` };
  }

  const cachedVersion = getVersion(newCache);
  if (cachedVersion !== version) {
    return { ok: false, mismatch: `marketplace=${version} cache=${cachedVersion}` };
  }

  // Update registry (only after verified copy)
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const key = `${pluginName}@${marketplace}`;

    if (registry.plugins[key]) {
      const entry = registry.plugins[key][0];
      entry.installPath = newCache.replace(/\//g, path.sep);
      entry.version = version;
      entry.lastUpdated = new Date().toISOString();
      entry.gitCommitSha = sha;
      // Informational only — the authoritative pin is ~/.claude/plugins/
      // .channels.json (native tooling may strip unknown registry fields).
      entry.channel = channel;
    } else {
      registry.plugins[key] = [{
        scope: 'user',
        installPath: newCache.replace(/\//g, path.sep),
        version,
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        gitCommitSha: sha,
        channel,
      }];
    }

    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
  } catch {
    // Registry update failed — non-fatal, plugin still works from marketplace dir
  }

  return { ok: true, installPath: newCache };
}

/**
 * Enumerate the plugins a marketplace clone ships, exactly like ss.plugin.update's
 * main loop: every dir under `plugins/`, plus the clone root itself when the repo
 * is a single-plugin marketplace.
 *
 * @returns {{name: string, dir: string}[]}
 */
function enumeratePlugins(marketplaceDir, marketplace) {
  const found = [];
  const pluginsRoot = path.join(marketplaceDir, 'plugins');
  try {
    for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) found.push({ name: entry.name, dir: path.join(pluginsRoot, entry.name) });
    }
  } catch { /* no plugins/ dir — single-plugin repo or empty clone */ }
  if (fs.existsSync(path.join(marketplaceDir, '.claude-plugin', 'plugin.json'))) {
    found.push({ name: marketplace, dir: marketplaceDir });
  }
  return found;
}

/**
 * Is the LOCAL plugin cache broken, independent of anything the network says?
 *
 * ss.plugin.update sits behind a 6 h cooldown (#324) because its update path is
 * network-bound and races the MCP connect window. But that gate must follow the
 * same rule as ss.mcp.deps': it only applies when NOTHING is broken. A cache
 * whose registry entry points at a deleted dir, whose cached plugin.json version
 * has drifted from the marketplace clone, or which lost its MCP-critical files
 * is exactly the state ss.mcp.verify tells the user a restart will self-heal —
 * so it must self-heal on the NEXT session, not in six hours.
 *
 * Deliberately network-free and process-free: only fs reads, no git, no
 * execSync. Deciding must be cheaper than the cooldown it can bypass.
 *
 * @param {object} opts
 * @param {string} opts.marketplacesDir  ~/.claude/plugins/marketplaces
 * @param {string} opts.registryFile     ~/.claude/plugins/installed_plugins.json
 * @returns {{broken: boolean, reason: string|null}} reason is the FIRST breakage found
 */
function cacheBroken({ marketplacesDir, registryFile }) {
  const intact = { broken: false, reason: null };

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  } catch {
    // No readable registry means no installed plugin to be broken ABOUT. The
    // main loop's own try/catch already treats this as "rebuild to be safe"
    // once it gets there; bypassing the cooldown on it would make the gate a
    // no-op on every machine that has not installed a plugin yet.
    return intact;
  }
  const plugins = registry && registry.plugins;
  if (!plugins || typeof plugins !== 'object') return intact;

  let marketplaces;
  try {
    marketplaces = fs.readdirSync(marketplacesDir, { withFileTypes: true });
  } catch {
    return intact;
  }

  for (const entry of marketplaces) {
    if (!entry.isDirectory()) continue;
    const marketplace = entry.name;
    const mDir = path.join(marketplacesDir, marketplace);
    if (!fs.existsSync(path.join(mDir, '.git'))) continue;

    for (const { name, dir } of enumeratePlugins(mDir, marketplace)) {
      const installed = plugins[`${name}@${marketplace}`];
      const record = Array.isArray(installed) ? installed[0] : null;
      if (!record) continue; // not installed from this clone — nothing to repair
      const label = `${name}@${marketplace}`;

      const installPath = record.installPath;
      if (!installPath || !fs.existsSync(installPath)) {
        return { broken: true, reason: `${label}: installPath missing` };
      }

      // A source without a readable plugin.json cannot arbitrate anything —
      // treating that as breakage would bypass the cooldown forever on a
      // half-cloned marketplace.
      const sourceVersion = getVersion(dir);
      if (!sourceVersion) continue;

      const cachedVersion = getVersion(installPath);
      if (cachedVersion !== sourceVersion) {
        return { broken: true, reason: `${label}: cached ${cachedVersion || 'none'} != source ${sourceVersion}` };
      }

      const missing = missingMcpFiles(installPath, dir);
      if (missing.length) {
        return { broken: true, reason: `${label}: missing ${missing.join(', ')}` };
      }
    }
  }

  return intact;
}

/**
 * Would rebuilding this version dir write into a LIVE MCP server's cwd?
 * True exactly when a session (this one included) has already claimed it.
 */
function targetIsLive(opts) {
  return isVersionDirInUse(path.join(opts.cacheDir, opts.marketplace, opts.pluginName, opts.version));
}

/**
 * Hand the rebuild to a detached child that sleeps past the MCP connect window.
 *
 * `detached: true` + `stdio: 'ignore'` + `unref()` — all three are required:
 * without them the parent hook (and with it SessionStart) stays open for the
 * whole delay, which would be a far worse regression than the one we are fixing.
 *
 * @returns {{deferred: boolean, pid?: number, delayMs?: number, error?: string}}
 */
function deferRebuild(opts, { delayMs = DEFER_DELAY_MS } = {}) {
  const runner = path.join(__dirname, 'cache-rebuild-runner.js');
  try {
    const child = spawn(
      process.execPath,
      [runner, JSON.stringify({ ...opts, delayMs })],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    return { deferred: true, pid: child.pid, delayMs };
  } catch (e) {
    return { deferred: false, error: e.message };
  }
}

module.exports = {
  DEFER_DELAY_MS,
  MCP_CRITICAL_FILES,
  MODULE_DIRS,
  cacheBroken,
  copyDir,
  deferRebuild,
  enumeratePlugins,
  depsHash,
  getVersion,
  hasMcpServer,
  missingMcpFiles,
  rebuildCache,
  syncNodeModules,
  targetIsLive,
};
