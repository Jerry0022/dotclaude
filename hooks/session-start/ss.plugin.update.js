#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.3.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Self-update mechanism — no external CLI dependencies.
 *   Checks the GitHub repo for a newer release on every session start
 *   using the GitHub REST API (Node.js built-in https).
 *   If a new version exists, downloads and overwrites the local installation.
 *   Supports both global (~/.claude/) and project-level (.claude/) installs.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const PLUGIN_REPO = 'Jerry0022/dotclaude-dev-ops';
const GLOBAL_DIR = path.join(os.homedir(), '.claude');
const TEMP_DIR = path.join(os.tmpdir(), 'dotclaude-dev-ops-update');

const GITHUB_API_BASE = `https://api.github.com/repos/${PLUGIN_REPO}`;
const REQUEST_HEADERS = {
  'User-Agent': 'dotclaude-dev-ops-updater',
  Accept: 'application/vnd.github+json',
};

// Directories to sync from plugin repo into the install target
const SYNC_DIRS = [
  'skills',
  'hooks',
  'agents',
  'deep-knowledge',
  'templates',
  'scripts',
  'scheduled-tasks',
];

/**
 * Determine whether this is a project-level or global install.
 * Project install: {cwd}/.claude/settings.json has dotclaude-dev-ops@Jerry0022 enabled.
 * Global install: fallback.
 */
function getInstallTarget() {
  const projectSettings = path.join(process.cwd(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(projectSettings, 'utf8'));
    if (settings.enabledPlugins && settings.enabledPlugins['dotclaude-dev-ops@Jerry0022']) {
      return { type: 'project', dir: path.join(process.cwd(), '.claude') };
    }
  } catch {
    // fall through
  }
  return { type: 'global', dir: GLOBAL_DIR };
}

function getVersionFile(installDir) {
  return path.join(installDir, '.plugin-version');
}

function getLocalVersion(installDir) {
  try {
    return fs.readFileSync(getVersionFile(installDir), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

/**
 * Fetch JSON from a URL via HTTPS GET.
 * Returns a Promise that resolves to the parsed JSON or null on error.
 */
function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: REQUEST_HEADERS, timeout: 10000 }, (res) => {
      // Follow redirects (GitHub API sometimes 301/302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Download a file from URL to a local path.
 * Follows redirects (GitHub serves tarballs via CDN redirect).
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (downloadUrl) => {
      https.get(downloadUrl, { headers: REQUEST_HEADERS, timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    };
    request(url);
  });
}

async function getRemoteVersion() {
  const release = await fetchJson(`${GITHUB_API_BASE}/releases/latest`);
  if (!release || !release.tag_name) return null;
  // Strip 'v' prefix: v0.1.0 → 0.1.0
  return release.tag_name.replace(/^v/, '');
}

async function getCommitShaForTag(version) {
  const tagRef = await fetchJson(`${GITHUB_API_BASE}/git/refs/tags/v${version}`);
  if (!tagRef || !tagRef.object) return null;
  const sha = tagRef.object.sha;
  // Dereference annotated tags to the commit
  if (tagRef.object.type === 'tag') {
    const tagObj = await fetchJson(`${GITHUB_API_BASE}/git/tags/${sha}`);
    return tagObj && tagObj.object && tagObj.object.sha || sha;
  }
  return sha;
}

function updateInstalledPluginsJson(version, commitSha) {
  const installedPluginsPath = path.join(GLOBAL_DIR, 'plugins', 'installed_plugins.json');
  try {
    if (!fs.existsSync(installedPluginsPath)) return;
    const data = JSON.parse(fs.readFileSync(installedPluginsPath, 'utf8'));
    const key = 'dotclaude-dev-ops@jerry0022-dotclaude-dev-ops';
    if (!data.plugins || !data.plugins[key]) return;
    const shortSha = commitSha.slice(0, 12);
    const entry = data.plugins[key][0];
    entry.version = shortSha;
    entry.installPath = path.join(
      GLOBAL_DIR, 'plugins', 'cache',
      'jerry0022-dotclaude-dev-ops', 'dotclaude-dev-ops', shortSha
    );
    entry.gitCommitSha = commitSha;
    entry.lastUpdated = new Date().toISOString();
    fs.writeFileSync(installedPluginsPath, JSON.stringify(data, null, 2) + '\n');
  } catch {
    // Non-fatal
  }
}

async function downloadAndInstall(version, installDir) {
  // Clean temp dir
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  try {
    // Download release tarball via GitHub API
    const tarballUrl = `${GITHUB_API_BASE}/tarball/v${version}`;
    const archivePath = path.join(TEMP_DIR, `dotclaude-dev-ops-${version}.tar.gz`);
    await downloadFile(tarballUrl, archivePath);

    // Extract
    const extractDir = path.join(TEMP_DIR, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    // --force-local prevents tar from interpreting C: as a remote host on Windows
    execSync(`tar --force-local -xzf "${archivePath}" -C "${extractDir}"`, {
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Find the root dir inside the extracted archive (usually repo-name-version/)
    const extracted = fs.readdirSync(extractDir);
    const rootDir = extracted.length === 1
      ? path.join(extractDir, extracted[0])
      : extractDir;

    // Sync each directory into the install target
    for (const dir of SYNC_DIRS) {
      const src = path.join(rootDir, dir);
      const dest = path.join(installDir, dir);

      if (!fs.existsSync(src)) continue;

      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDirRecursive(src, dest);
    }

    // Update version file
    fs.writeFileSync(getVersionFile(installDir), version);

    // Keep installed_plugins.json in sync
    const commitSha = await getCommitShaForTag(version);
    if (commitSha) updateInstalledPluginsJson(version, commitSha);

    return true;
  } catch (err) {
    process.stderr.write(`[ss.plugin.update] Download failed: ${err.message}\n`);
    return false;
  } finally {
    try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Self-healing: fix hook paths in settings.json based on install type.
 *
 * Project install: $HOME/.claude/hooks/ → .claude/hooks/ (relative to project root)
 * Global install:  bare hooks/ → $HOME/.claude/hooks/ (legacy behaviour)
 */
function healHookPaths(installType) {
  const settingsFiles = installType === 'project'
    ? [path.join(process.cwd(), '.claude', 'settings.json')]
    : [path.join(GLOBAL_DIR, 'settings.json')];

  for (const settingsPath of settingsFiles) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(raw);
      if (!settings.hooks || typeof settings.hooks !== 'object') continue;

      let changed = false;

      for (const event of Object.values(settings.hooks)) {
        if (!Array.isArray(event)) continue;
        for (const group of event) {
          const hooks = group.hooks;
          if (!Array.isArray(hooks)) continue;
          for (const hook of hooks) {
            if (!hook.command) continue;

            if (installType === 'project') {
              // Convert absolute global paths to project-relative
              if (hook.command.includes('$HOME/.claude/hooks/')) {
                hook.command = hook.command.replace(/\$HOME\/.claude\/hooks\//g, '.claude/hooks/');
                changed = true;
              }
            } else {
              // Convert bare relative paths to global absolute
              const RELATIVE_HOOK_RE = /^node\s+(?:"|')?hooks\//;
              if (RELATIVE_HOOK_RE.test(hook.command)) {
                hook.command = hook.command.replace(
                  /^node\s+(?:"|')?hooks\//,
                  'node "$HOME/.claude/hooks/'
                );
                if (!hook.command.endsWith('"')) {
                  hook.command = hook.command.replace(/\.js(?:"|')?$/, '.js"');
                }
                changed = true;
              }
            }
          }
        }
      }

      if (changed) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        process.stderr.write(`[ss.plugin.update] Healed hook paths in ${settingsPath}\n`);
      }
    } catch {
      // Non-fatal — skip silently
    }
  }
}

// Main (async IIFE)
(async () => {
  const { type: installType, dir: installDir } = getInstallTarget();

  // Always heal hook paths, even if no update is needed
  healHookPaths(installType);

  const localVersion = getLocalVersion(installDir);
  const remoteVersion = await getRemoteVersion();

  if (!remoteVersion) {
    process.exit(0); // Can't reach GitHub — skip silently
  }

  if (localVersion === remoteVersion) {
    process.exit(0); // Up to date
  }

  // Version comparison (simple semver)
  const local = localVersion.split('.').map(Number);
  const remote = remoteVersion.split('.').map(Number);
  const isNewer = remote[0] > local[0] ||
    (remote[0] === local[0] && remote[1] > local[1]) ||
    (remote[0] === local[0] && remote[1] === local[1] && remote[2] > local[2]);

  if (!isNewer) {
    process.exit(0); // Local is same or newer
  }

  process.stderr.write(
    `[ss.plugin.update] New version available: v${localVersion} → v${remoteVersion}. Updating...\n`
  );

  if (await downloadAndInstall(remoteVersion, installDir)) {
    process.stderr.write(
      `[ss.plugin.update] Plugin updated to v${remoteVersion}. Changes apply to this session.\n`
    );
  } else {
    process.stderr.write(
      `[ss.plugin.update] Update failed — continuing with v${localVersion}.\n`
    );
  }
})();
