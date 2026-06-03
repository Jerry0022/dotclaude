#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.7.0
 * @event SessionStart
 * @plugin devops
 * @description Auto-update plugin marketplace clones, rebuild cache, and update registry.
 *   Workaround for anthropics/claude-code#14061 — Desktop never runs git pull
 *   on marketplace clones and never rebuilds the plugin cache.
 *   Shares the same update logic as /devops-plugin-update (see SKILL.md).
 *
 *   When a plugin with an MCP server is upgraded mid-session, the running
 *   MCP processes point at the now-deleted old installPath. A sentinel file
 *   (~/.claude/plugins/.mcp-stale.json) is written so pre.mcp.health can
 *   block MCP tool calls until the user restarts Claude Code.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { t } = require('../lib/locale');

// Translations for user-facing output. SessionStart fires before any user
// prompt — there is no detected locale yet and no session_id in hook input
// here. Default to English; the DICT is pre-wired so a future improvement
// (e.g. reading hook stdin for session_id and calling getLocale) can switch
// languages without restructuring the output.
const DICT = {
  en: {
    header: 'Plugin updates applied (workaround for claude-code#14061):',
    restart: '⚡ **Plugin updated ({names}) — restart Claude to activate the new version.**',
    dk_reread: 'Deep-knowledge index may have changed — re-read INDEX.md on next relevant task.',
    show_asis: 'Show the user this restart notice as-is.',
  },
  de: {
    header: 'Plugin-Updates angewendet (Workaround für claude-code#14061):',
    restart: '⚡ **Plugin aktualisiert ({names}) — Claude neu starten, um die neue Version zu aktivieren.**',
    dk_reread: 'Deep-Knowledge-Index hat sich evtl. geändert — INDEX.md beim nächsten relevanten Task neu lesen.',
    show_asis: 'Diese Restart-Notice dem User unverändert zeigen.',
  },
};

const lang = 'en';

const home = process.env.HOME || process.env.USERPROFILE || '';
const marketplacesDir = path.join(home, '.claude', 'plugins', 'marketplaces');
const cacheDir = path.join(home, '.claude', 'plugins', 'cache');
const registryFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
const sentinelFile = path.join(home, '.claude', 'plugins', '.mcp-stale.json');

// Files whose absence means a cache is functionally broken even when its
// version/sha look correct (issue #190 — sync dropped mcp-server files and
// .mcp.json, so the MCP servers never registered). Checked both to flag an
// existing cache for rebuild and to verify a freshly-built one. Paths are
// relative to a plugin root; only assert files that exist in every plugin
// that ships an .mcp.json — guarded by hasMcpServer() below.
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

// Returns the MCP-critical files missing from `targetRoot`. `expectMcp` must be
// derived from the SOURCE plugin dir, not the target — otherwise a target whose
// own .mcp.json was dropped would report "nothing to assert" and mask the very
// breakage we are checking for (issue #190).
function missingMcpFiles(targetRoot, expectMcp) {
  if (!expectMcp) return [];
  return MCP_CRITICAL_FILES.filter((rel) => !fs.existsSync(path.join(targetRoot, rel)));
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim();
  } catch {
    return '';
  }
}

/**
 * Fire an OS-level notification (tray / toast / notification center).
 * Non-blocking on Windows (spawns detached), sync elsewhere.
 * Fails silently — never blocks or crashes the hook.
 */
function notifyDesktop(title, body) {
  try {
    if (process.platform === 'win32') {
      const { spawn } = require('child_process');
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info',
        `$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'`,
        `$n.BalloonTipText = '${body.replace(/'/g, "''")}'`,
        '$n.Visible = $true',
        '$n.ShowBalloonTip(10000)',
        'Start-Sleep -Seconds 10',
        '$n.Dispose()',
      ].join('; ');
      const child = spawn('powershell', ['-NoProfile', '-Command', script], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
        { timeout: 5000, stdio: 'ignore' },
      );
    } else {
      execSync(`notify-send "${title.replace(/"/g, '\\"')}" "${body.replace(/"/g, '\\"')}"`, {
        timeout: 5000, stdio: 'ignore',
      });
    }
  } catch {
    // Notification failed — non-fatal
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
  // Cross-platform recursive copy (Node 16.7+). The previous implementation
  // shelled out to `cp -a` / `cp -r`, which silently fails on Windows: `cp` is
  // not a cmd.exe builtin and Git's coreutils are usually not on the PATH that
  // Node's execSync sees. A failed copy left a partial cache (missing
  // mcp-server/*.js, .mcp.json, hooks) that crashed every MCP server — the
  // exact breakage the #190 completeness guard was meant to prevent.
  try {
    fs.cpSync(src, dst, { recursive: true, force: true });
  } catch {
    // Last-resort fallback for environments where fs.cpSync is unavailable.
    run(`cp -a "${src}/." "${dst}/"`, path.dirname(src));
    run(`cp -r "${src}/.claude-plugin" "${dst}/"`, path.dirname(src));
    const mcpSrc = path.join(src, '.mcp.json');
    if (fs.existsSync(mcpSrc)) {
      try { fs.copyFileSync(mcpSrc, path.join(dst, '.mcp.json')); } catch { /* ignore */ }
    }
  }

  return fs.existsSync(path.join(dst, '.claude-plugin', 'plugin.json'));
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
  const copyOk = copyDir(pluginDir, newCache);
  if (!copyOk) {
    return { ok: false, missing: 'copy failed — .claude-plugin/plugin.json not found after copy' };
  }

  // Verify cache completeness
  const checks = [
    path.join(newCache, 'skills'),
    path.join(newCache, 'hooks'),
  ];
  for (const check of checks) {
    if (!fs.existsSync(check)) {
      return { ok: false, missing: check };
    }
  }

  // If the source ships an MCP server, the copy must include the full
  // mcp-server tree + .mcp.json — otherwise the servers never register
  // (issue #190). Fail the rebuild so the registry is not pointed at a
  // broken cache; the next session retries from the (complete) marketplace.
  const mcpMissing = missingMcpFiles(newCache, hasMcpServer(pluginDir));
  if (mcpMissing.length) {
    return { ok: false, missing: `mcp-server files: ${mcpMissing.join(', ')}` };
  }

  // Verify version alignment
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

// If the marketplaces directory is missing, there are no updates to run.
// Still clean up any lingering sentinel from a prior session — otherwise it
// would block every MCP tool call indefinitely.
if (!fs.existsSync(marketplacesDir)) {
  if (fs.existsSync(sentinelFile)) {
    try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
  }
  process.exit(0);
}

const updated = [];
// Tracks plugins whose installPath moved and that expose MCP servers.
// Used at the end to either write or clear the stale sentinel.
const mcpAffected = [];

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
    // Cache-staleness guard: rebuild if cached plugin.json version doesn't match marketplace
    let cacheStale = false;
    try {
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      const key = `${name}@${marketplace}`;
      const entry = registry.plugins[key]?.[0];
      if (entry) {
        if (!fs.existsSync(entry.installPath)) {
          cacheMissing = true;
        } else {
          // Verify cached content matches marketplace (catches stale-content-in-correct-dir)
          const cachedVersion = getVersion(entry.installPath);
          if (cachedVersion !== after) {
            cacheStale = true;
          } else {
            // SHA mismatch: same version string but different commit (files may have changed)
            const cachedSha = entry.gitCommitSha || '';
            if (cachedSha && cachedSha !== newHead && cachedSha !== newSha) {
              cacheStale = true;
            }
            // Completeness guard: version/sha can match while the MCP server
            // files were dropped by an incomplete sync (issue #190). Rebuild
            // from the marketplace clone to heal the cache in place.
            if (!cacheStale && missingMcpFiles(entry.installPath, hasMcpServer(dir)).length) {
              cacheStale = true;
            }
          }
        }
      }
    } catch { /* registry unreadable — rebuild to be safe */ cacheMissing = true; }

    if (versionChanged || cacheMissing || cacheStale) {
      const result = rebuildCache(marketplace, name, dir, after, newSha);
      updated.push({
        name,
        from: beforeVersions[name] || '?',
        to: after,
        verified: result.ok,
        cacheRepair: (cacheMissing || cacheStale) && !versionChanged,
        error: result.ok ? null : (result.missing || result.mismatch),
      });

      // Real version upgrades of MCP-bearing plugins invalidate running MCP
      // processes — they were spawned from the now-deleted installPath.
      // Cache repairs at the same version overwrite files in place, so the
      // running Node process (code already in RAM) keeps working.
      if (versionChanged && result.ok && fs.existsSync(path.join(dir, '.mcp.json'))) {
        mcpAffected.push({
          name,
          marketplace,
          from: beforeVersions[name] || '?',
          to: after,
        });
      }
    }
  }
}

// Manage the MCP-stale sentinel. Writing it here is safe even if Claude Code
// spawns MCP servers AFTER this hook runs — pre.mcp.health compares the PID
// file's mtime against the sentinel's mtime, so a fresh spawn clears it on
// the first tool call. Stale sentinels from a previous session are cleaned
// up when this hook runs without MCP-affecting changes.
if (mcpAffected.length > 0) {
  try {
    fs.writeFileSync(
      sentinelFile,
      JSON.stringify({ stampedAt: new Date().toISOString(), plugins: mcpAffected }, null, 2),
    );
  } catch {
    // Sentinel write failed — MCP tools will still work, just without the guard
  }
} else if (fs.existsSync(sentinelFile)) {
  // Nothing moved this run — any lingering sentinel is from a prior session
  try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
}

if (updated.length === 0) process.exit(0);

const lines = [t('header', lang, DICT)];
lines.push('');
for (const u of updated) {
  const status = u.verified ? '✓ cache rebuilt' : `⚠ ${u.error}`;
  const repair = u.cacheRepair ? ' [cache repair]' : '';
  lines.push(`- **${u.name}**: ${u.from} → ${u.to} (${status}${repair})`);
}
lines.push('');

// Detect real version upgrades (not just cache repairs)
const upgrades = updated.filter(u => !u.cacheRepair && u.verified);
if (upgrades.length > 0) {
  const names = upgrades.map(u => `${u.name} v${u.to}`).join(', ');
  lines.push(t('restart', lang, DICT).replace('{names}', names));
  lines.push(t('dk_reread', lang, DICT));
  lines.push(t('show_asis', lang, DICT));
  lines.push('');
  notifyDesktop('Claude Plugin Updated', `${names} — restart Claude to activate.`);
}

process.stdout.write(lines.join('\n'));
