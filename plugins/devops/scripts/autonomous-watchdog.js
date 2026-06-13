#!/usr/bin/env node
/**
 * autonomous-watchdog.js — External safety net for devops-autonomous.
 *
 * Registers a Windows Scheduled Task that fires after N hours. The task checks
 * for a "done-flag" file; if it's missing, the task takes a recovery action
 * depending on the mode it was registered with:
 *   - "shutdown" (shutdown=yes runs): force-shut the PC down.
 *   - "notify"   (shutdown=no runs):  write a visible AUTONOMOUS-STALLED.txt
 *                next to the flag path so a silent hang becomes a visible signal
 *                the user sees on return. Never powers the machine off.
 *
 * Why this is needed: when Claude is AFK and hits an Anthropic API rate-limit,
 * a crashed subagent, or a wakelock-style hang, the in-session Step 8 is never
 * reached. The scheduled task fires *independently* of Claude — so a shutdown
 * still happens (shutdown mode), or a stalled run stops being invisible
 * (notify mode). Without this, a "report-only" run that wedges would hang
 * forever with zero external signal.
 *
 * Subcommands (stdout: JSON):
 *   register <flag-path> <hours> [action]
 *                                  Create one-shot task firing in N hours.
 *                                  action = "shutdown" (default) | "notify".
 *                                  Stores sentinel under TEMP for later cleanup.
 *                                  → { ok, taskName, flagPath, fireAt, action }
 *
 *   flag [flag-path]               Write the completion flag (signals success).
 *                                  If omitted, reads flagPath from the sentinel
 *                                  written at register time — recommended path,
 *                                  avoids cwd drift between arm and flag-write.
 *                                  → { ok, flagPath }
 *
 *   unregister [task-name]         Delete the scheduled task + helper script.
 *                                  Uses sentinel if task-name omitted.
 *                                  → { ok, taskName, deleted }
 *
 *   status [task-name]             Check if the task still exists.
 *                                  → { ok, taskName, active }
 *
 * Platform: Windows-only. Registration uses the PowerShell ScheduledTasks module
 * (Register-ScheduledTask); query/delete use schtasks.exe. No-op on other platforms.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TASK_PREFIX = 'ClaudeAutonomousWatchdog';
const SENTINEL_FILE = path.join(os.tmpdir(), 'claude-autonomous-watchdog.json');

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
  process.exit(1);
}

function ok(extra) {
  process.stdout.write(JSON.stringify({ ok: true, ...extra }) + '\n');
  process.exit(0);
}

function readSentinel() {
  if (!fs.existsSync(SENTINEL_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SENTINEL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeSentinel(data) {
  fs.writeFileSync(SENTINEL_FILE, JSON.stringify(data, null, 2));
}

function deleteSentinel() {
  if (fs.existsSync(SENTINEL_FILE)) {
    try { fs.unlinkSync(SENTINEL_FILE); } catch { /* ignore */ }
  }
}

// --- Validation guards for sentinel-derived destructive operations ---
// The sentinel file lives under %TEMP% and is world-writable in same-user
// scope. Any same-user process could tamper with it to redirect deletions
// to arbitrary task names or files. Validate strictly before acting.

const SCRIPT_PREFIX = 'claude-autonomous-watchdog-';
const SCRIPT_SUFFIX = '.ps1';

function isValidWatchdogTaskName(taskName) {
  if (typeof taskName !== 'string') return false;
  // Must match exactly: <PREFIX>-<digits>
  const re = new RegExp(`^${TASK_PREFIX}-\\d+$`);
  return re.test(taskName);
}

function isValidWatchdogScriptPath(scriptPath) {
  if (typeof scriptPath !== 'string' || scriptPath.length === 0) return false;
  const tempDir = path.resolve(os.tmpdir());
  const absPath = path.resolve(scriptPath);
  // Must live directly under TEMP (no traversal, no sibling dirs)
  if (path.dirname(absPath).toLowerCase() !== tempDir.toLowerCase()) return false;
  const basename = path.basename(absPath);
  if (!basename.startsWith(SCRIPT_PREFIX)) return false;
  if (!basename.endsWith(SCRIPT_SUFFIX)) return false;
  return true;
}

/**
 * Build the recovery PowerShell script that the scheduled task executes on fire.
 * It checks the done-flag and, if missing, runs the mode-specific recovery.
 * @param {{action:string, hours:number, flagPath:string, stalledPath:string}} o
 * @returns {string} PowerShell script body, written to a self-deleting .ps1.
 */
function buildRecoveryScript({ action, hours, flagPath, stalledPath }) {
  const flagPs = flagPath.replace(/'/g, "''");
  const stalledPs = stalledPath.replace(/'/g, "''");
  // Recovery action when the flag is missing — differs by mode.
  const recoveryPs = action === 'shutdown'
    ? `  Add-Content -Path $logPath -Value "[$ts] flag MISSING at $flag — forcing shutdown"
  & "$env:SystemRoot\\System32\\shutdown.exe" /s /t 0 /c "Claude autonomous watchdog: session unresponsive after ${hours}h, forcing shutdown"`
    : `  Add-Content -Path $logPath -Value "[$ts] flag MISSING at $flag — writing stalled marker (notify mode)"
  $msg = @(
    "Claude autonomous session was unresponsive after ${hours}h and never reached completion.",
    "",
    "The run wedged (likely an Anthropic API hang or a stuck subagent). Nothing was shut down.",
    "Check AUTONOMOUS-RESUME.json for saved state, then resume or restart the session.",
    "",
    "Stalled at: $ts"
  )
  Set-Content -Path '${stalledPs}' -Value $msg -Encoding UTF8`;
  return `$ErrorActionPreference = 'Continue'
$flag = '${flagPs}'
$logPath = Join-Path $env:TEMP 'claude-autonomous-watchdog.log'
$ts = (Get-Date -Format 'o')
if (Test-Path $flag) {
  Add-Content -Path $logPath -Value "[$ts] flag present at $flag — no action"
} else {
${recoveryPs}
}
# Self-delete this script after run
try { Remove-Item -Path $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue } catch {}
`;
}

/**
 * Build the PowerShell command that registers the one-shot watchdog task.
 *
 * Culture-agnostic by construction: the fire time is passed to `Get-Date` as
 * separate integer components (-Year/-Month/-Day/-Hour/-Minute), never as a
 * locale-formatted date string. This sidesteps the `schtasks /SD /ST` trap where
 * a hard-coded en-US `MM/DD/YYYY` is rejected by a non-US `schtasks` — e.g. a
 * de-DE install expects `TT.MM.JJJJ` and answers a US string with
 * "FEHLER: Ungültiges Startdatum", which left the 8h deadman unarmed.
 * `Register-ScheduledTask` with `New-ScheduledTaskTrigger -At <DateTime>` takes a
 * real DateTime object, so no date string is ever parsed against the active culture.
 *
 * The wall-clock components come from the local-time getters of `fireAt`, matching
 * the previous `/ST` semantics (the Task Scheduler interprets `-At` as local time).
 * Battery flags are set so the deadman still fires on a laptop running AFK on
 * battery — the schtasks default (DisallowStartIfOnBatteries) would have skipped it.
 *
 * @param {{taskName:string, scriptPath:string, fireAt:Date}} opts
 * @returns {string} PowerShell script to run via `powershell.exe -Command`.
 */
function buildRegisterPsCommand({ taskName, scriptPath, fireAt }) {
  const tnPs = String(taskName).replace(/'/g, "''");
  const spPs = String(scriptPath).replace(/'/g, "''");
  const year = fireAt.getFullYear();
  const month = fireAt.getMonth() + 1; // getMonth() is 0-based
  const day = fireAt.getDate();
  const hour = fireAt.getHours();
  const minute = fireAt.getMinutes();
  return [
    `$ErrorActionPreference = 'Stop'`,
    `try {`,
    `  $at = Get-Date -Year ${year} -Month ${month} -Day ${day} -Hour ${hour} -Minute ${minute} -Second 0`,
    `  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${spPs}"'`,
    `  $trigger = New-ScheduledTaskTrigger -Once -At $at`,
    `  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `  Register-ScheduledTask -TaskName '${tnPs}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    `} catch {`,
    `  Write-Error $_.Exception.Message`,
    `  exit 1`,
    `}`,
  ].join('\n');
}

function runRegister(args) {
  const [flagPathRaw, hoursRaw, actionRaw] = args;
  if (!flagPathRaw || !hoursRaw) {
    fail('Usage: register <flag-path> <hours> [shutdown|notify]');
  }
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 0.1 || hours > 24) {
    fail('hours must be 0.1..24');
  }
  const action = actionRaw || 'shutdown';
  if (action !== 'shutdown' && action !== 'notify') {
    fail("action must be 'shutdown' or 'notify'");
  }
  const flagPath = path.resolve(flagPathRaw);
  // notify mode drops a visible marker next to the flag; same dir, fixed name.
  const stalledPath = path.join(path.dirname(flagPath), 'AUTONOMOUS-STALLED.txt');

  // Clean up any previous watchdog first — only one active at a time.
  // Sentinel is untrusted (same-user TEMP); validate before destructive ops.
  const prev = readSentinel();
  if (prev?.taskName && isValidWatchdogTaskName(prev.taskName)) {
    spawnSync('schtasks.exe', ['/Delete', '/TN', prev.taskName, '/F'],
      { encoding: 'utf8' });
  }
  if (prev?.scriptPath && isValidWatchdogScriptPath(prev.scriptPath) &&
      fs.existsSync(prev.scriptPath)) {
    try { fs.unlinkSync(prev.scriptPath); } catch { /* ignore */ }
  }

  const taskName = `${TASK_PREFIX}-${Date.now()}`;
  const fireAt = new Date(Date.now() + hours * 3600_000);

  // Write a separate PowerShell script — robust escaping, self-deletes after run.
  const scriptPath = path.join(os.tmpdir(),
    `claude-autonomous-watchdog-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath,
    buildRecoveryScript({ action, hours, flagPath, stalledPath }), 'utf8');

  // Register via the PowerShell ScheduledTasks module rather than `schtasks /SD /ST`:
  // the trigger time is passed as a real DateTime, so it is culture-agnostic and
  // does not break on non-US locales (see buildRegisterPsCommand).
  const psCommand = buildRegisterPsCommand({ taskName, scriptPath, fireAt });
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    { encoding: 'utf8' });

  if (result.status !== 0) {
    fail(`watchdog task registration failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  writeSentinel({
    taskName,
    flagPath,
    scriptPath,
    fireAt: fireAt.toISOString(),
    hours,
    action,
  });

  ok({ taskName, flagPath, fireAt: fireAt.toISOString(), scriptPath, action });
}

function runFlag(args) {
  const [flagPathRaw] = args;
  let flagPath;
  if (flagPathRaw) {
    flagPath = path.resolve(flagPathRaw);
  } else {
    // No path supplied → use the one persisted at registration time.
    // This is the recommended path because it avoids cwd-drift between
    // arm-time and flag-write-time (Codex finding #2).
    const sentinel = readSentinel();
    if (!sentinel?.flagPath) {
      fail('No flag-path supplied and no sentinel found ' +
        '(call register first, or pass an explicit path).');
    }
    flagPath = sentinel.flagPath;
  }
  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(flagPath, JSON.stringify({
    doneAt: new Date().toISOString(),
    note: 'Autonomous session reached completion (Step 8c).',
  }, null, 2));
  ok({ flagPath });
}

function runUnregister(args) {
  let taskName = args[0];
  const sentinel = readSentinel();
  if (!taskName) {
    if (!sentinel) ok({ skipped: true, reason: 'no sentinel' });
    taskName = sentinel.taskName;
  }

  // Reject task names that don't match our prefix — protects against a
  // tampered sentinel pointing at unrelated scheduled tasks.
  if (!isValidWatchdogTaskName(taskName)) {
    fail(`Refusing to delete task with unexpected name format: ${taskName}`);
  }

  const result = spawnSync('schtasks.exe',
    ['/Delete', '/TN', taskName, '/F'], { encoding: 'utf8' });

  // Not-found is acceptable — the task may have already fired or never existed.
  const notFound = /cannot find|nicht gefunden/i.test(
    (result.stderr || '') + (result.stdout || '')
  );
  if (result.status !== 0 && !notFound) {
    fail(`schtasks /Delete failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  // Best-effort cleanup of helper script (only if path matches expected layout)
  if (sentinel?.scriptPath &&
      isValidWatchdogScriptPath(sentinel.scriptPath) &&
      fs.existsSync(sentinel.scriptPath)) {
    try { fs.unlinkSync(sentinel.scriptPath); } catch { /* ignore */ }
  }
  deleteSentinel();

  ok({ taskName, deleted: !notFound });
}

function runStatus(args) {
  let taskName = args[0];
  const sentinel = readSentinel();
  if (!taskName) {
    if (!sentinel) ok({ active: false, reason: 'no sentinel' });
    taskName = sentinel.taskName;
  }
  const result = spawnSync('schtasks.exe',
    ['/Query', '/TN', taskName], { encoding: 'utf8' });
  ok({
    taskName,
    active: result.status === 0,
    fireAt: sentinel?.fireAt,
    flagPath: sentinel?.flagPath,
  });
}

// --- CLI entry (skipped when require()'d by tests) ---
if (require.main === module) {
  if (process.platform !== 'win32') {
    ok({ skipped: true, reason: 'non-windows platform' });
  }
  const [, , subcmd, ...args] = process.argv;
  if (subcmd === 'register') runRegister(args);
  else if (subcmd === 'flag') runFlag(args);
  else if (subcmd === 'unregister') runUnregister(args);
  else if (subcmd === 'status') runStatus(args);
  else {
    fail(`Unknown subcommand: ${subcmd || '(empty)'}. ` +
      `Use: register | flag | unregister | status`);
  }
}

module.exports = {
  buildRegisterPsCommand,
  buildRecoveryScript,
  isValidWatchdogTaskName,
  isValidWatchdogScriptPath,
};
