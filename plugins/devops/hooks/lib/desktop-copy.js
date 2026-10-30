/**
 * Desktop plugin copy lag check.
 *
 * The Claude Desktop app (Code tab) does not load plugins from
 * ~/.claude/plugins/cache — it loads the copy its claude.ai account marketplace
 * synced into <Claude-Data>/rpm/<org>/<user>/plugin_<id>/. ss.plugin.update
 * keeps only the CLI cache current, so a Desktop copy can sit on an old version
 * for days with no warning (observed 2026-10-30: Desktop on 0.326.0 while the
 * CLI cache and alpha were on 0.334.1 — 28 of the last 30 changes missing).
 *
 * This module only DETECTS that state (pure fs, no network): the running
 * plugin root is an rpm copy and its version trails the local marketplace
 * clone, which ss.plugin.update has already moved to the channel-resolved tag.
 * The sync itself happens on claude.ai and cannot be done from a hook.
 */

const fs = require('fs');
const path = require('path');
const { compareVersions } = require('./channels');
const { getVersion } = require('./cache-rebuild');

const RPM_DIR = /[\\/]rpm[\\/][^\\/]+[\\/][^\\/]+[\\/]plugin_[^\\/]+[\\/]?$/i;

function isRpmCopy(pluginRoot) {
  return RPM_DIR.test(String(pluginRoot || ''));
}

/** marketplaceName of the rpm entry for this plugin dir, from its sibling manifest.json. */
function rpmMarketplace(pluginRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(pluginRoot), 'manifest.json'), 'utf8'));
    const id = path.basename(pluginRoot);
    const entry = (manifest.plugins || []).find((p) => p.id === id);
    return entry ? { marketplace: entry.marketplaceName || null, updatedAt: entry.updatedAt || null } : null;
  } catch {
    return null;
  }
}

/** Plugin dir inside a marketplace clone: plugins/<name>, else a root-level plugin. */
function clonePluginDir(marketplacesDir, marketplace, pluginName) {
  const mDir = path.join(marketplacesDir, marketplace);
  const nested = path.join(mDir, 'plugins', pluginName);
  if (fs.existsSync(path.join(nested, '.claude-plugin', 'plugin.json'))) return nested;
  if (fs.existsSync(path.join(mDir, '.claude-plugin', 'plugin.json'))) return mDir;
  return null;
}

/**
 * @returns {null | { name, running, latest, marketplace, updatedAt }}
 *   null when the running copy is not an rpm copy, cannot be matched to a
 *   local marketplace clone, or is not behind it.
 */
function desktopCopyLag({ pluginRoot, marketplacesDir }) {
  if (!isRpmCopy(pluginRoot)) return null;
  const running = getVersion(pluginRoot);
  if (!running) return null;
  let name;
  try {
    name = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).name;
  } catch {
    return null;
  }
  const rpm = rpmMarketplace(pluginRoot);
  if (!name || !rpm || !rpm.marketplace) return null;
  const cloneDir = clonePluginDir(marketplacesDir, rpm.marketplace, name);
  const latest = cloneDir && getVersion(cloneDir);
  if (!latest || compareVersions(running, latest) >= 0) return null;
  return { name, running, latest, marketplace: rpm.marketplace, updatedAt: rpm.updatedAt };
}

module.exports = { isRpmCopy, desktopCopyLag };
