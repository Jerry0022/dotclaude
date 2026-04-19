/**
 * @module anythingllm-lifecycle
 * @version 0.2.0
 * @plugin local-llm
 * @description Cross-platform lifecycle helpers for AnythingLLM Desktop.
 *   Detects an existing installation, checks whether the process is running,
 *   and launches it detached. Does NOT wait for readiness — polling is done
 *   by the caller via anythingllm-http.checkHealth.
 *
 *   Supported platforms: Windows (win32), macOS (darwin), Linux. On any other
 *   platform `detectInstallation()` reports "not installed" with an
 *   `unsupported` reason, `isProcessRunning()` returns false, and `launch()`
 *   returns an explicit error. The caller's state machine then surfaces the
 *   download link and instructs the user to start the app manually.
 *
 *   All helpers return plain data structures; no throws.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const DOWNLOAD_URL = 'https://anythingllm.com/download';
const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux']);

// -------- Windows --------------------------------------------------------

// Installer name on disk and runtime image name reported by tasklist are NOT
// guaranteed to match — the Electron app manifest can rename the runtime.
const WIN_EXE_NAMES = ['AnythingLLM.exe', 'AnythingLLMDesktop.exe'];
const WIN_PROCESS_NAMES = ['AnythingLLMDesktop.exe', 'AnythingLLM.exe'];

function windowsCandidatePaths() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const dirs = [
    path.join(localAppData, 'Programs', 'AnythingLLM'),
    path.join(localAppData, 'Programs', 'anythingllm-desktop'),
    path.join(localAppData, 'Programs', 'AnythingLLMDesktop'),
    path.join(localAppData, 'AnythingLLM'),
    path.join(programFiles, 'AnythingLLM'),
    path.join(programFilesX86, 'AnythingLLM'),
  ];

  const paths = [];
  for (const d of dirs) {
    for (const exe of WIN_EXE_NAMES) paths.push(path.join(d, exe));
  }
  return paths;
}

function isRunningWindows() {
  for (const name of WIN_PROCESS_NAMES) {
    try {
      const out = execFileSync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${name}`, '/NH'],
        { encoding: 'utf8', timeout: 3000 }
      );
      if (new RegExp(name.replace('.', '\\.'), 'i').test(out)) return true;
    } catch { /* try next */ }
  }
  return false;
}

// -------- macOS ----------------------------------------------------------

function macOSCandidatePaths() {
  const home = os.homedir();
  const bundles = [
    '/Applications/AnythingLLM.app',
    path.join(home, 'Applications', 'AnythingLLM.app'),
  ];
  // Mach-O binary inside the .app bundle. Electron apps may use either the
  // app name or a "Desktop" variant — include both.
  const binNames = ['AnythingLLM', 'AnythingLLM Desktop'];
  const paths = [];
  for (const bundle of bundles) {
    for (const name of binNames) paths.push(path.join(bundle, 'Contents', 'MacOS', name));
  }
  return paths;
}

// -------- Linux ----------------------------------------------------------

function linuxCandidatePaths() {
  const home = os.homedir();
  const paths = [];

  // .deb / .rpm / tarball system targets
  const systemBins = [
    '/usr/bin/anythingllm-desktop',
    '/usr/bin/AnythingLLM',
    '/usr/local/bin/anythingllm-desktop',
    '/opt/AnythingLLM/anythingllm-desktop',
    '/opt/AnythingLLM/AnythingLLM',
  ];
  paths.push(...systemBins);

  // Per-user install locations. AppImage is the typical distribution channel
  // for AnythingLLM Desktop on Linux, and users commonly drop it into one of
  // these directories without installing system-wide.
  const userDirs = [
    path.join(home, 'Applications'),
    path.join(home, '.local', 'share', 'AnythingLLM'),
    path.join(home, 'Downloads'),
  ];
  for (const dir of userDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (/^anythingllm.*\.appimage$/i.test(entry)) {
          paths.push(path.join(dir, entry));
        } else if (/^anythingllm(-desktop)?$/i.test(entry)) {
          paths.push(path.join(dir, entry));
        }
      }
    } catch { /* unreadable dir — skip */ }
  }

  return paths;
}

// pgrep ships on every mainstream macOS and Linux distro. If it's missing
// (minimal container image) the caller's state machine still handles an
// unreachable /api/ping by prompting the user to start the app.
function isRunningPosix() {
  try {
    execFileSync('pgrep', ['-f', '-i', 'anythingllm'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

// -------- Public API -----------------------------------------------------

function candidatePaths() {
  switch (process.platform) {
    case 'win32': return windowsCandidatePaths();
    case 'darwin': return macOSCandidatePaths();
    case 'linux': return linuxCandidatePaths();
    default: return [];
  }
}

function detectInstallation() {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    return {
      installed: false,
      path: null,
      downloadUrl: DOWNLOAD_URL,
      reason: `unsupported-platform:${process.platform}`,
    };
  }
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return { installed: true, path: p };
    } catch { /* ignore */ }
  }
  return { installed: false, path: null, downloadUrl: DOWNLOAD_URL };
}

function isProcessRunning() {
  switch (process.platform) {
    case 'win32': return isRunningWindows();
    case 'darwin':
    case 'linux': return isRunningPosix();
    default: return false;
  }
}

function launch(exePath) {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    return { ok: false, error: `unsupported platform: ${process.platform}` };
  }
  try {
    // On macOS, prefer `open -a <AppBundle>` so LaunchServices handles
    // activation, Dock icon, and Gatekeeper. Spawning the Mach-O directly
    // works but bypasses all of that.
    if (process.platform === 'darwin') {
      const bundle = exePath.match(/^(.*\.app)\/Contents\/MacOS\//);
      if (bundle) {
        const child = spawn('open', ['-a', bundle[1]], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return { ok: true, pid: child.pid };
      }
    }

    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  candidatePaths,
  detectInstallation,
  isProcessRunning,
  launch,
  DOWNLOAD_URL,
};
