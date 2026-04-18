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

function candidatePaths() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  return [
    path.join(localAppData, 'Programs', 'anythingllm-desktop', 'AnythingLLM.exe'),
    path.join(localAppData, 'Programs', 'AnythingLLMDesktop', 'AnythingLLM.exe'),
    path.join(localAppData, 'AnythingLLM', 'AnythingLLM.exe'),
    path.join(programFiles, 'AnythingLLM', 'AnythingLLM.exe'),
    path.join(programFilesX86, 'AnythingLLM', 'AnythingLLM.exe'),
  ];
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
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq AnythingLLM.exe', '/NH'],
      { encoding: 'utf8', timeout: 3000 }
    );
    return /AnythingLLM\.exe/i.test(out);
  } catch {
    return false;
  }
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
