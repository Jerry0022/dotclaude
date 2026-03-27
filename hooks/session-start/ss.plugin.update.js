#!/usr/bin/env node
/**
 * @hook ss.plugin.update
 * @version 0.1.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Self-update mechanism for Claude Desktop (no /plugin CLI).
 *   Checks the GitHub repo for a newer release on every session start.
 *   If a new version exists, downloads and overwrites the local installation
 *   in ~/.claude/. Quick version check (~200ms), download only when needed.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_REPO = 'Jerry0022/dotclaude-dev-ops';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const VERSION_FILE = path.join(CLAUDE_DIR, '.plugin-version');
const TEMP_DIR = path.join(os.tmpdir(), 'dotclaude-dev-ops-update');

// Directories to sync from plugin repo into ~/.claude/
const SYNC_DIRS = [
  'skills',
  'hooks',
  'agents',
  'deep-knowledge',
  'templates',
  'scripts',
  'scheduled-tasks',
];

function getLocalVersion() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}

function getRemoteVersion() {
  try {
    const result = execSync(
      `gh api repos/${PLUGIN_REPO}/releases/latest --jq ".tag_name"`,
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    // Strip 'v' prefix: v0.1.0 → 0.1.0
    return result.replace(/^v/, '');
  } catch {
    return null; // API not available or no releases
  }
}

function downloadAndInstall(version) {
  // Clean temp dir
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  try {
    // Download release tarball
    execSync(
      `gh release download v${version} --repo ${PLUGIN_REPO} --archive tar.gz --dir "${TEMP_DIR}"`,
      { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Find the downloaded archive
    const archives = fs.readdirSync(TEMP_DIR).filter(f => f.endsWith('.tar.gz'));
    if (archives.length === 0) throw new Error('No archive downloaded');

    const archivePath = path.join(TEMP_DIR, archives[0]);

    // Extract
    const extractDir = path.join(TEMP_DIR, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
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

// Main
const localVersion = getLocalVersion();
const remoteVersion = getRemoteVersion();

if (!remoteVersion) {
  // Can't reach GitHub — skip silently
  process.exit(0);
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

if (downloadAndInstall(remoteVersion)) {
  process.stderr.write(
    `[ss.plugin.update] Plugin updated to v${remoteVersion}. Changes apply to this session.\n`
  );
} else {
  process.stderr.write(
    `[ss.plugin.update] Update failed — continuing with v${localVersion}.\n`
  );
}
