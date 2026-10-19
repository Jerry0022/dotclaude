'use strict';
/**
 * @module scripts/lib/desktop-notify
 * @version 0.1.0
 * @plugin devops
 * @description One desktop notification from a background node job — Windows
 *   toast (PowerShell + WinRT, no module needed), macOS `osascript`, Linux
 *   `notify-send`. Best effort: never throws, returns whether it was shown.
 *   The text is passed as data (environment variables / argv), never spliced
 *   into a script, so a repo or branch name cannot inject code.
 */

const { spawnSync } = require('child_process');

const TIMEOUT = 15_000;

/** The PowerShell toast script; title and body come from $env. */
const WIN_TOAST = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
  '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$n = $t.GetElementsByTagName("text")',
  '$n.Item(0).AppendChild($t.CreateTextNode($env:DEVOPS_NOTIFY_TITLE)) > $null',
  '$n.Item(1).AppendChild($t.CreateTextNode($env:DEVOPS_NOTIFY_BODY)) > $null',
  // PowerShell's own AppUserModelID — always registered, so the toast shows without an installer.
  '$app = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))',
].join('; ');

function clip(s, n) {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

/**
 * Show `{title, body}`.
 * @param {{title:string, body:string}} msg
 * @param {{platform?:string, run?:Function}} [io]
 * @returns {boolean} shown
 */
function notify(msg, io = {}) {
  const platform = io.platform || process.platform;
  const run = io.run || ((cmd, args, opts) => spawnSync(cmd, args, { timeout: TIMEOUT, windowsHide: true, stdio: 'ignore', ...opts }));
  const title = clip(msg && msg.title, 80) || 'devops';
  const body = clip(msg && msg.body, 240);
  try {
    if (platform === 'win32') {
      const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', WIN_TOAST], {
        env: { ...process.env, DEVOPS_NOTIFY_TITLE: title, DEVOPS_NOTIFY_BODY: body },
      });
      return !!r && r.status === 0;
    }
    if (platform === 'darwin') {
      const r = run('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body]);
      return !!r && r.status === 0;
    }
    const r = run('notify-send', ['--app-name=devops', title, body]);
    return !!r && r.status === 0;
  } catch {
    return false;
  }
}

module.exports = { notify, WIN_TOAST };
