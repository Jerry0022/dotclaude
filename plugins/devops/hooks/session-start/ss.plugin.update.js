#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Auto-update plugin marketplace clones and invalidate stale cache.
 *   Workaround for anthropics/claude-code#14061 — Desktop never runs git pull
 *   on marketplace clones and never invalidates the plugin cache.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const home = process.env.HOME || process.env.USERPROFILE || '';
const marketplacesDir = path.join(home, '.claude', 'plugins', 'marketplaces');
const cacheDir = path.join(home, '.claude', 'plugins', 'cache');

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

  // Pull latest
  const localHead = run('git rev-parse HEAD', mDir);
  run('git pull --ff-only origin main 2>&1 || git pull --ff-only origin master 2>&1', mDir);
  const newHead = run('git rev-parse HEAD', mDir);

  if (localHead === newHead) continue; // no changes

  // Check which plugins changed version
  for (const { name, dir } of pluginDirs) {
    const after = getVersion(dir);
    if (after && after !== beforeVersions[name]) {
      // Invalidate cache for this plugin
      const pluginCache = path.join(cacheDir, marketplace, name);
      if (fs.existsSync(pluginCache)) {
        fs.rmSync(pluginCache, { recursive: true, force: true });
      }
      updated.push({ name, from: beforeVersions[name] || '?', to: after });
    }
  }
}

if (updated.length === 0) process.exit(0);

const lines = ['Plugin updates applied (workaround for claude-code#14061):'];
lines.push('');
for (const u of updated) {
  lines.push(`- **${u.name}**: ${u.from} → ${u.to} (cache invalidated)`);
}
lines.push('');

process.stdout.write(lines.join('\n'));
