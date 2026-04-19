/**
 * @module anythingllm-lifecycle
 * @version 0.1.0
 * @plugin local-llm
 * @description Windows lifecycle helpers for AnythingLLM Desktop.
 *   Detects an existing installation, checks whether the process is running,
 *   and launches it detached. Does NOT wait for readiness — polling is done
 *   by the caller via anythingllm-http.checkHealth.
 *
 *   All helpers return plain data structures; no throws.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const DOWNLOAD_URL = 'https://anythingllm.com/download';

// Observed executable and process names across AnythingLLM Desktop installers.
// The installer name (the .exe on disk) and the runtime image name (what
// Windows reports in tasklist) are NOT guaranteed to match — the Electron
// app manifest can rename the runtime image.
const EXE_NAMES = ['AnythingLLM.exe', 'AnythingLLMDesktop.exe'];
const PROCESS_NAMES = ['AnythingLLMDesktop.exe', 'AnythingLLM.exe'];

function candidatePaths() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  // Directory layouts observed across installer versions.
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
    for (const exe of EXE_NAMES) paths.push(path.join(d, exe));
  }
  return paths;
}

function detectInstallation() {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return { installed: true, path: p };
    } catch { /* ignore */ }
  }
  return { installed: false, path: null, downloadUrl: DOWNLOAD_URL };
}

function isProcessRunning() {
  if (process.platform !== 'win32') return false;
  for (const name of PROCESS_NAMES) {
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

function launch(exePath) {
  try {
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
