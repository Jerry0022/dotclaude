/**
 * @module anythingllm-tray
 * @version 0.1.0
 * @plugin local-llm
 * @description Minimize the AnythingLLM main window after a fresh launch.
 *   Windows-only: AnythingLLM ships no `--minimize` flag, so we shell out to
 *   PowerShell which polls for the main window and calls Win32 ShowWindow
 *   with SW_MINIMIZE. macOS/Linux: no-op (no standard tray concept; user can
 *   set Hide-on-launch inside the app).
 *
 *   Detached and fire-and-forget — never blocks the caller.
 */

'use strict';

const { spawn } = require('node:child_process');

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_SECONDS = 20;
const SW_MINIMIZE = 6;

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace W -Name U -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
"@
$deadline = (Get-Date).AddSeconds(${POLL_MAX_SECONDS})
$names = @('AnythingLLM','AnythingLLMDesktop')
while ((Get-Date) -lt $deadline) {
  foreach ($n in $names) {
    $procs = Get-Process -Name $n -ErrorAction SilentlyContinue |
             Where-Object { $_.MainWindowHandle -ne 0 -and [W.U]::IsWindowVisible($_.MainWindowHandle) }
    foreach ($p in $procs) {
      [W.U]::ShowWindow($p.MainWindowHandle, ${SW_MINIMIZE}) | Out-Null
    }
    if ($procs) { return }
  }
  Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
}
`;

function minimizeAfterLaunch() {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported-platform' };
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS_SCRIPT],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { minimizeAfterLaunch };
