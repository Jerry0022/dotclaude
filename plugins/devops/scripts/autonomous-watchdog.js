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
 *                                  Stores a PER-REGISTRATION sentinel under TEMP
 *                                  (parallel autonomous sessions coexist; only a
 *                                  previous registration for the SAME flag path
 *                                  is replaced).
 *                                  → { ok, taskName, flagPath, fireAt, action }
 *
 *   flag [flag-path]               Write the completion flag (signals success).
 *                                  If omitted, resolves the session's own
 *                                  sentinel: single sentinel → that one;
 *                                  multiple (parallel sessions) → the one whose
 *                                  flagPath directory contains the current cwd.
 *                                  Ambiguous → hard fail (never writes into
 *                                  another session's project).
 *                                  → { ok, flagPath }
 *
 *   unregister [task-name]         Delete the scheduled task + helper script.
 *                                  Resolves sentinel like `flag` if omitted.
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
// Legacy single-file sentinel (pre parallel-session fix). Still read so a run
// armed by an older plugin version can complete its flag/unregister.
const LEGACY_SENTINEL_FILE = path.join(os.tmpdir(), 'claude-autonomous-watchdog.json');
const SENTINEL_PREFIX = 'claude-autonomous-watchdog-';
const SENTINEL_SUFFIX = '.json';
// A sentinel whose fire time is this long past is dead weight — the one-shot
// task fired and its recovery script self-deleted. Prune it so it can never
// shadow a live registration in the pick logic.
const SENTINEL_EXPIRY_MS = 48 * 3600_000;

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
  process.exit(1);
}

function ok(extra) {
  process.stdout.write(JSON.stringify({ ok: true, ...extra }) + '\n');
  process.exit(0);
}

function sentinelFileFor(taskName) {
  return path.join(os.tmpdir(), `${SENTINEL_PREFIX}${taskName}${SENTINEL_SUFFIX}`);
}

function readSentinelFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * All live sentinels: one per registration (`claude-autonomous-watchdog-
 * ClaudeAutonomousWatchdog-<ts>.json`) plus the legacy single file. Entries
 * whose fireAt is >48h past are pruned on sight — their task has long fired.
 * @returns {Array<{file:string, data:object}>}
 */
function listSentinels() {
  const out = [];
  const tmp = os.tmpdir();
  let entries = [];
  try { entries = fs.readdirSync(tmp); } catch { return out; }
  for (const name of entries) {
    if (!name.startsWith(SENTINEL_PREFIX) || !name.endsWith(SENTINEL_SUFFIX)) continue;
    const file = path.join(tmp, name);
    const data = readSentinelFile(file);
    if (data) out.push({ file, data });
  }
  const legacy = readSentinelFile(LEGACY_SENTINEL_FILE);
  if (legacy) out.push({ file: LEGACY_SENTINEL_FILE, data: legacy });
  const now = Date.now();
  return out.filter((s) => {
    const fireAt = Date.parse(s.data?.fireAt || '');
    if (Number.isFinite(fireAt) && now - fireAt > SENTINEL_EXPIRY_MS) {
      try { fs.unlinkSync(s.file); } catch { /* ignore */ }
      return false;
    }
    return true;
  });
}

/**
 * Resolve which sentinel belongs to the calling session. There is no global
 * "the one sentinel" — parallel autonomous sessions each register their own,
 * and picking the wrong one writes the done-flag into a foreign project and
 * mutes that session's watchdog (2026-07-05 incident: TIjedea run flagged the
 * hll-overlay run as done).
 *
 * Pure function (no fs) so it is unit-testable:
 *   1. Single sentinel → that one (single-session fast path, cwd-drift safe).
 *   2. Multiple → candidates whose flagPath directory equals the cwd or is an
 *      ancestor of it (Step 8 runs from the project/worktree root the flag
 *      belongs to); the deepest such directory wins.
 *   3. Tie on equally deep directories with identical flagPath → first one
 *      (harmless duplicate); different flagPaths or no candidate → no match,
 *      caller must fail loudly and demand an explicit path.
 *
 * @param {Array<{file:string, data:object}>} sentinels
 * @param {string} cwd
 * @returns {{match: {file:string, data:object}|null, candidates: Array}}
 */
function pickSentinel(sentinels, cwd) {
  if (!sentinels.length) return { match: null, candidates: [] };
  if (sentinels.length === 1) return { match: sentinels[0], candidates: sentinels };
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  const cwdN = norm(cwd);
  const scored = sentinels
    .filter((s) => typeof s.data?.flagPath === 'string' && s.data.flagPath)
    .map((s) => ({ s, dir: norm(path.dirname(s.data.flagPath)) }))
    .filter(({ dir }) => cwdN === dir || cwdN.startsWith(dir + path.sep));
  if (!scored.length) return { match: null, candidates: sentinels };
  scored.sort((a, b) => b.dir.length - a.dir.length);
  const tied = scored.filter((c) => c.dir.length === scored[0].dir.length);
  if (tied.length > 1) {
    const flags = new Set(tied.map((c) => norm(c.s.data.flagPath)));
    if (flags.size > 1) return { match: null, candidates: sentinels };
  }
  return { match: scored[0].s, candidates: sentinels };
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

  // Clean up a previous watchdog FOR THIS PROJECT ONLY (same flagPath).
  // Parallel autonomous sessions in other projects keep their watchdogs —
  // the old global "only one active at a time" takeover deleted the sibling
  // session's task and let its sentinel shadow ours (2026-07-05 incident).
  // Sentinels are untrusted (same-user TEMP); validate before destructive ops.
  const flagN = path.resolve(flagPath).toLowerCase();
  for (const prev of listSentinels()) {
    const prevFlag = typeof prev.data?.flagPath === 'string'
      ? path.resolve(prev.data.flagPath).toLowerCase() : null;
    if (prevFlag !== flagN) continue;
    if (prev.data.taskName && isValidWatchdogTaskName(prev.data.taskName)) {
      spawnSync('schtasks.exe', ['/Delete', '/TN', prev.data.taskName, '/F'],
        { encoding: 'utf8' });
    }
    if (prev.data.scriptPath && isValidWatchdogScriptPath(prev.data.scriptPath) &&
        fs.existsSync(prev.data.scriptPath)) {
      try { fs.unlinkSync(prev.data.scriptPath); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(prev.file); } catch { /* ignore */ }
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

  fs.writeFileSync(sentinelFileFor(taskName), JSON.stringify({
    taskName,
    flagPath,
    scriptPath,
    fireAt: fireAt.toISOString(),
    hours,
    action,
  }, null, 2));

  ok({ taskName, flagPath, fireAt: fireAt.toISOString(), scriptPath, action });
}

function runFlag(args) {
  const [flagPathRaw] = args;
  let flagPath;
  if (flagPathRaw) {
    flagPath = path.resolve(flagPathRaw);
  } else {
    // No path supplied → resolve THIS session's sentinel. With parallel
    // autonomous sessions there are several sentinels; writing the flag into
    // a foreign project would mute that session's watchdog, so ambiguity is
    // a hard failure, never a guess.
    const { match, candidates } = pickSentinel(listSentinels(), process.cwd());
    if (!match) {
      if (!candidates.length) {
        fail('No flag-path supplied and no sentinel found ' +
          '(call register first, or pass an explicit path).');
      }
      fail('Multiple watchdog sentinels exist (parallel autonomous sessions) ' +
        'and none matches the current directory unambiguously — pass the flag ' +
        'path explicitly. Candidates: ' +
        candidates.map((c) => c.data.flagPath).join(' | '));
    }
    flagPath = match.data.flagPath;
  }
  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(flagPath, JSON.stringify({
    doneAt: new Date().toISOString(),
    note: 'Autonomous session reached completion (Step 8c).',
  }, null, 2));
  ok({ flagPath });
}

function resolveSentinelOrFail(sentinels, what) {
  const { match, candidates } = pickSentinel(sentinels, process.cwd());
  if (match) return match;
  if (!candidates.length) return null;
  fail(`Multiple watchdog sentinels exist (parallel autonomous sessions) and ` +
    `none matches the current directory unambiguously — pass the ${what} ` +
    `explicitly. Candidates: ` +
    candidates.map((c) => `${c.data.taskName} → ${c.data.flagPath}`).join(' | '));
}

function runUnregister(args) {
  let taskName = args[0];
  const sentinels = listSentinels();
  let sentinel = null;
  if (taskName) {
    sentinel = sentinels.find((s) => s.data.taskName === taskName) || null;
  } else {
    sentinel = resolveSentinelOrFail(sentinels, 'task name');
    if (!sentinel) ok({ skipped: true, reason: 'no sentinel' });
    taskName = sentinel.data.taskName;
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

  // Best-effort cleanup of helper script + sentinel (only this registration's)
  if (sentinel?.data.scriptPath &&
      isValidWatchdogScriptPath(sentinel.data.scriptPath) &&
      fs.existsSync(sentinel.data.scriptPath)) {
    try { fs.unlinkSync(sentinel.data.scriptPath); } catch { /* ignore */ }
  }
  if (sentinel) {
    try { fs.unlinkSync(sentinel.file); } catch { /* ignore */ }
  }

  ok({ taskName, deleted: !notFound });
}

function runStatus(args) {
  let taskName = args[0];
  const sentinels = listSentinels();
  let sentinel = null;
  if (taskName) {
    sentinel = sentinels.find((s) => s.data.taskName === taskName) || null;
  } else {
    sentinel = resolveSentinelOrFail(sentinels, 'task name');
    if (!sentinel) ok({ active: false, reason: 'no sentinel' });
    taskName = sentinel.data.taskName;
  }
  const result = spawnSync('schtasks.exe',
    ['/Query', '/TN', taskName], { encoding: 'utf8' });
  ok({
    taskName,
    active: result.status === 0,
    fireAt: sentinel?.data.fireAt,
    flagPath: sentinel?.data.flagPath,
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
  pickSentinel,
  sentinelFileFor,
};
