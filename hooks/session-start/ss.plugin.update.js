#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.2.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Self-update mechanism — no external CLI dependencies.
 *   Checks the GitHub repo for a newer release on every session start
 *   using the GitHub REST API (Node.js built-in https).
 *   If a new version exists, downloads and overwrites the local installation
 *   in ~/.claude/. Quick version check (~200ms), download only when needed.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const PLUGIN_REPO = 'Jerry0022/dotclaude-dev-ops';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const VERSION_FILE = path.join(CLAUDE_DIR, '.plugin-version');
const TEMP_DIR = path.join(os.tmpdir(), 'dotclaude-dev-ops-update');

const GITHUB_API_BASE = `https://api.github.com/repos/${PLUGIN_REPO}`;
const REQUEST_HEADERS = {
  'User-Agent': 'dotclaude-dev-ops-updater',
  Accept: 'application/vnd.github+json',
};

// Directories to sync from plugin repo into ~/.claude/
const SYNC_DIRS = [
  'skills',
  'hooks',
  'agents',
  'deep-knowledge',
  'templates',
  'scripts',
];

function getLocalVersion() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim();
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

async function downloadAndInstall(version) {
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

    // Sync each directory
    for (const dir of SYNC_DIRS) {
      const src = path.join(rootDir, dir);
      const dest = path.join(CLAUDE_DIR, dir);

      if (!fs.existsSync(src)) continue;

      // Remove existing dir and replace with new content
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDirRecursive(src, dest);
    }

    // Also sync hooks.json
    const hooksJsonSrc = path.join(rootDir, 'hooks', 'hooks.json');
    if (fs.existsSync(hooksJsonSrc)) {
      const hooksDir = path.join(CLAUDE_DIR, 'hooks');
      if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });
      fs.copyFileSync(hooksJsonSrc, path.join(hooksDir, 'hooks.json'));
    }

    // Update version file
    fs.writeFileSync(VERSION_FILE, version);

    return true;
  } catch (err) {
    process.stderr.write(`[ss.plugin.update] Download failed: ${err.message}\n`);
    return false;
  } finally {
    // Cleanup temp
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

// Main (async IIFE)
(async () => {
  const localVersion = getLocalVersion();
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

  if (await downloadAndInstall(remoteVersion)) {
    process.stderr.write(
      `[ss.plugin.update] Plugin updated to v${remoteVersion}. Changes apply to this session.\n`
    );
  } else {
    process.stderr.write(
      `[ss.plugin.update] Update failed — continuing with v${localVersion}.\n`
    );
  }
})();
