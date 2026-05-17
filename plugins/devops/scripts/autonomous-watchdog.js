#!/usr/bin/env node
/**
 * autonomous-watchdog.js — External shutdown safety net for devops-autonomous.
 *
 * Registers a Windows Scheduled Task that fires after N hours. The task checks
 * for a "done-flag" file; if it's missing, the task force-shuts the PC down.
 *
 * Why this is needed: when Claude is AFK and hits an Anthropic API rate-limit,
 * a crashed subagent, or a wakelock-style hang, the in-session Step 8 shutdown
 * is never reached. The scheduled task fires *independently* of Claude, so the
 * shutdown still happens.
 *
 * Subcommands (stdout: JSON):
 *   register <flag-path> <hours>   Create one-shot task firing in N hours.
 *                                  Stores sentinel under TEMP for later cleanup.
 *                                  → { ok, taskName, flagPath, fireAt }
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
 * Platform: Windows-only (uses schtasks.exe). No-op on other platforms.
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

if (process.platform !== 'win32') {
  ok({ skipped: true, reason: 'non-windows platform' });
}

const [, , subcmd, ...args] = process.argv;

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

if (subcmd === 'register') {
  const [flagPathRaw, hoursRaw] = args;
  if (!flagPathRaw || !hoursRaw) fail('Usage: register <flag-path> <hours>');
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 0.1 || hours > 24) {
    fail('hours must be 0.1..24');
  }
  const flagPath = path.resolve(flagPathRaw);

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
  const psScript =
`$ErrorActionPreference = 'Continue'
$flag = '${flagPath.replace(/'/g, "''")}'
$logPath = Join-Path $env:TEMP 'claude-autonomous-watchdog.log'
$ts = (Get-Date -Format 'o')
if (Test-Path $flag) {
  Add-Content -Path $logPath -Value "[$ts] flag present at $flag — no action"
} else {
  Add-Content -Path $logPath -Value "[$ts] flag MISSING at $flag — forcing shutdown"
  & "$env:SystemRoot\\System32\\shutdown.exe" /s /t 0 /c "Claude autonomous watchdog: session unresponsive after ${hours}h, forcing shutdown"
}
# Self-delete this script after run
try { Remove-Item -Path $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue } catch {}
`;
  fs.writeFileSync(scriptPath, psScript, 'utf8');

  const sd = `${String(fireAt.getMonth() + 1).padStart(2, '0')}/` +
             `${String(fireAt.getDate()).padStart(2, '0')}/` +
             `${fireAt.getFullYear()}`;
  const st = `${String(fireAt.getHours()).padStart(2, '0')}:` +
             `${String(fireAt.getMinutes()).padStart(2, '0')}`;
  const tr = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"`;

  const result = spawnSync('schtasks.exe', [
    '/Create',
    '/TN', taskName,
    '/SC', 'ONCE',
    '/SD', sd,
    '/ST', st,
    '/TR', tr,
    '/F',
  ], { encoding: 'utf8' });

  if (result.status !== 0) {
    fail(`schtasks /Create failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  writeSentinel({
    taskName,
    flagPath,
    scriptPath,
    fireAt: fireAt.toISOString(),
    hours,
  });

  ok({ taskName, flagPath, fireAt: fireAt.toISOString(), scriptPath });
}

if (subcmd === 'flag') {
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

if (subcmd === 'unregister') {
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

if (subcmd === 'status') {
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

fail(`Unknown subcommand: ${subcmd || '(empty)'}. ` +
  `Use: register | flag | unregister | status`);
