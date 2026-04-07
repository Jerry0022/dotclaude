#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.3.0
 * @event SessionStart
 * @plugin devops
 * @description Auto-update plugin marketplace clones, rebuild cache, and update registry.
 *   Workaround for anthropics/claude-code#14061 — Desktop never runs git pull
 *   on marketplace clones and never rebuilds the plugin cache.
 *   Shares the same update logic as /devops-self-update (see SKILL.md).
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const home = process.env.HOME || process.env.USERPROFILE || '';
const marketplacesDir = path.join(home, '.claude', 'plugins', 'marketplaces');
const cacheDir = path.join(home, '.claude', 'plugins', 'cache');
const registryFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim();
  } catch {
    return '';
  }
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

function copyDir(src, dst) {
  // Use cp -a (archive) to get dotfiles + new directories.
  // Fallback to manual copy on Windows where cp -a may not work.
  const result = run(`cp -a "${src}/." "${dst}/"`, path.dirname(src));
  if (!result && result !== '') {
    // Verify copy worked by checking a known file
    if (!fs.existsSync(path.join(dst, '.claude-plugin', 'plugin.json'))) {
      // Fallback: manual copy
      run(`cp -r "${src}/"* "${dst}/"`, path.dirname(src));
      run(`cp -r "${src}/.claude-plugin" "${dst}/"`, path.dirname(src));
      const mcpSrc = path.join(src, '.mcp.json');
      if (fs.existsSync(mcpSrc)) {
        fs.copyFileSync(mcpSrc, path.join(dst, '.mcp.json'));
      }
    }
  }
}

function rebuildCache(marketplace, pluginName, pluginDir, version, sha) {
  const pluginCache = path.join(cacheDir, marketplace, pluginName);

  // Clean ALL old version dirs
  if (fs.existsSync(pluginCache)) {
    fs.rmSync(pluginCache, { recursive: true, force: true });
  }

  // Create new cache dir
  const newCache = path.join(pluginCache, version);
  fs.mkdirSync(newCache, { recursive: true });

  // Copy all files (archive mode for dotfiles)
  copyDir(pluginDir, newCache);

  // Verify cache completeness
  const checks = [
    path.join(newCache, '.claude-plugin', 'plugin.json'),
    path.join(newCache, 'skills'),
    path.join(newCache, 'hooks'),
  ];
  for (const check of checks) {
    if (!fs.existsSync(check)) {
      return { ok: false, missing: check };
    }
  }

  // Verify version alignment
  const cachedVersion = getVersion(newCache);
  if (cachedVersion !== version) {
    return { ok: false, mismatch: `marketplace=${version} cache=${cachedVersion}` };
  }

  // Update registry
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const key = `${pluginName}@${marketplace}`;

    if (registry.plugins[key]) {
      const entry = registry.plugins[key][0];
      entry.installPath = newCache.replace(/\//g, path.sep);
      entry.version = version;
      entry.lastUpdated = new Date().toISOString();
      entry.gitCommitSha = sha;
    } else {
      // New install — create entry
      registry.plugins[key] = [{
        scope: 'user',
        installPath: newCache.replace(/\//g, path.sep),
        version,
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        gitCommitSha: sha,
      }];
    }

    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
  } catch {
    // Registry update failed — non-fatal, plugin still works from marketplace dir
  }

  return { ok: true };
}

if (!fs.existsSync(marketplacesDir)) process.exit(0);

const updated = [];

for (const marketplace of fs.readdirSync(marketplacesDir)) {
  const mDir = path.join(marketplacesDir, marketplace);
  if (!fs.statSync(mDir).isDirectory()) continue;
  if (!fs.existsSync(path.join(mDir, '.git'))) continue;

  // Find all plugin dirs within this marketplace
  const pluginsRoot = path.join(mDir, 'plugins');
  const pluginDirs = [];
  if (fs.existsSync(pluginsRoot)) {
    for (const p of fs.readdirSync(pluginsRoot)) {
      const pd = path.join(pluginsRoot, p);
      if (fs.statSync(pd).isDirectory()) pluginDirs.push({ name: p, dir: pd });
    }
  }
  // Also check root-level plugin (single-plugin repos)
  if (fs.existsSync(path.join(mDir, '.claude-plugin', 'plugin.json'))) {
    pluginDirs.push({ name: marketplace, dir: mDir });
  }

  // Capture versions before pull
  const beforeVersions = {};
  for (const { name, dir } of pluginDirs) {
    beforeVersions[name] = getVersion(dir);
  }

  // Pull latest — reset dirty state first to prevent pull failures
  const localHead = run('git rev-parse HEAD', mDir);
  const pullResult = run('git pull --ff-only origin main 2>&1 || git pull --ff-only origin master 2>&1', mDir);
  let newHead = run('git rev-parse HEAD', mDir);

  // If pull failed (dirty tree), reset and retry
  if (localHead === newHead && !pullResult) {
    run('git checkout -- .', mDir);
    run('git clean -fd', mDir);
    run('git pull --ff-only origin main 2>&1 || git pull --ff-only origin master 2>&1', mDir);
    newHead = run('git rev-parse HEAD', mDir);
  }

  const newSha = newHead.substring(0, 7);
  const headChanged = localHead !== newHead;

  // Rebuild cache for plugins that changed version OR have missing cache
  for (const { name, dir } of pluginDirs) {
    const after = getVersion(dir);
    if (!after) continue;

    const versionChanged = headChanged && after !== beforeVersions[name];

    // Cache-existence guard: rebuild if registry points to a missing path
    let cacheMissing = false;
    try {
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      const key = `${name}@${marketplace}`;
      const entry = registry.plugins[key]?.[0];
      if (entry && !fs.existsSync(entry.installPath)) {
        cacheMissing = true;
      }
    } catch { /* registry unreadable — rebuild to be safe */ cacheMissing = true; }

    if (versionChanged || cacheMissing) {
      const result = rebuildCache(marketplace, name, dir, after, newSha);
      updated.push({
        name,
        from: beforeVersions[name] || '?',
        to: after,
        verified: result.ok,
        cacheRepair: cacheMissing && !versionChanged,
        error: result.ok ? null : (result.missing || result.mismatch),
      });
    }
  }
}

if (updated.length === 0) process.exit(0);

const lines = ['Plugin updates applied (workaround for claude-code#14061):'];
lines.push('');
for (const u of updated) {
  const status = u.verified ? '✓ cache rebuilt' : `⚠ ${u.error}`;
  const repair = u.cacheRepair ? ' [cache repair]' : '';
  lines.push(`- **${u.name}**: ${u.from} → ${u.to} (${status}${repair})`);
}
lines.push('');

process.stdout.write(lines.join('\n'));
