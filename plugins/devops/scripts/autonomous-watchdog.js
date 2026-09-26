#!/usr/bin/env node
/**
 * autonomous-watchdog.js — External safety net for do-run autonomous mode.
 *
 * Registers a Windows Scheduled Task that fires after N hours. The task checks
 * for a "done-flag" file; if it's missing, the task takes a recovery action
 * depending on the mode it was registered with:
 *   - "shutdown" (shutdown=yes runs): force-shut the PC down.
 *   - "notify"   (shutdown=no runs):  write a visible AUTONOMOUS-STALLED.txt
 *                next to the flag path so a silent hang becomes a visible signal
 *                the user sees on return. Never powers the machine off.
 *   - "resume"   (shutdown=no runs):  notify (as above) AND attempt a guarded,
 *                one-shot external relaunch of `claude` with a resume prompt, so
 *                a wedged run is actively revived instead of merely flagged. The
 *                relaunch is gated by a one-per-run AUTONOMOUS-RECOVERY.flag and
 *                degrades cleanly to notify-only when `claude` is not on PATH.
 *                Never powers the machine off. Requires a resume prompt.
 *
 * Why this is needed: when Claude is AFK and hits an Anthropic API rate-limit,
 * a crashed subagent, or a wakelock-style hang, the in-session Step 8 is never
 * reached. The scheduled task fires *independently* of Claude — so a shutdown
 * still happens (shutdown mode), a stalled run stops being invisible (notify
 * mode), or a fresh session is spawned to continue the work (resume mode).
 * Without this, a "report-only" run that wedges would hang forever with zero
 * external signal, and a shutdown=no run had no active recovery at all.
 *
 * Subcommands (stdout: JSON):
 *   register <flag-path> <hours> [action] [resume-prompt]
 *                                  Create one-shot task firing in N hours.
 *                                  action = "shutdown" (default) | "notify" | "resume".
 *                                  resume-prompt is REQUIRED for action "resume":
 *                                  the initial prompt handed to the relaunched
 *                                  `claude` (e.g. a RUN_BACKLOG_AUTOSTART: line).
 *                                  Stores a PER-REGISTRATION sentinel under TEMP
 *                                  (parallel autonomous sessions coexist; only a
 *                                  previous registration for the SAME flag path
 *                                  is replaced). The task deletes itself once its
 *                                  trigger window has passed (EndBoundary +
 *                                  DeleteExpiredTaskAfter), and once the new task
 *                                  is armed, register sweeps watchdog tasks and
 *                                  helper scripts older than STALE_AFTER_MS that
 *                                  earlier plugin versions left behind (#544),
 *                                  under one short budget.
 *                                  → { ok, taskName, flagPath, fireAt, action, swept }
 *
 *   flag [flag-path]               Write the completion flag (signals success).
 *                                  If omitted, resolves the session's own
 *                                  sentinel: single sentinel → that one;
 *                                  multiple (parallel sessions) → the one whose
 *                                  flagPath directory contains the current cwd.
 *                                  Ambiguous → hard fail (never writes into
 *                                  another session's project). A written flag
 *                                  leaves the watchdog nothing to do, so the
 *                                  task(s) registered for that flag path are
 *                                  removed with their script and sentinel.
 *                                  → { ok, flagPath, unregistered }
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
// A registration fires at most MAX_HOURS after its task name's epoch, so a
// watchdog task or helper script older than MAX_HOURS + 2 h has fired (or was
// missed) for good and can never matter again (#544).
const MAX_HOURS = 24;
const STALE_AFTER_MS = (MAX_HOURS + 2) * 3600_000;
// After its fire time the trigger stays valid this long; then Task Scheduler
// deletes the expired task on its own (DeleteExpiredTaskAfter 0).
const TRIGGER_WINDOW_MIN = 30;
// Every child process is bounded — a hung schtasks/PowerShell must never
// wedge the autonomous run it is meant to guard.
const SPAWN_TIMEOUT_MS = 30_000;
const REGISTER_TIMEOUT_MS = 60_000;
// Deletions per sweep: the backlog of expired tasks shrinks over a few runs
// instead of stalling one registration.
const SWEEP_MAX = 25;
// The whole sweep (query + deletions) stays inside this budget — it runs
// after the deadman is armed and must not stretch the register call.
const SWEEP_BUDGET_MS = 8_000;

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

function isValidWatchdogScriptPath(scriptPath, tempRoot = os.tmpdir()) {
  if (typeof scriptPath !== 'string' || scriptPath.length === 0) return false;
  const tempDir = path.resolve(tempRoot);
  const absPath = path.resolve(scriptPath);
  // Must live directly under TEMP (no traversal, no sibling dirs)
  if (path.dirname(absPath).toLowerCase() !== tempDir.toLowerCase()) return false;
  const basename = path.basename(absPath);
  if (!basename.startsWith(SCRIPT_PREFIX)) return false;
  if (!basename.endsWith(SCRIPT_SUFFIX)) return false;
  return true;
}

const SPAWN_OPTS = { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, windowsHide: true };

/** schtasks answered "no such task" — the task is gone either way. */
function taskNotFound(result) {
  return /cannot find|nicht gefunden|does not exist/i.test(
    ((result && result.stderr) || '') + ((result && result.stdout) || ''));
}

/**
 * Watchdog task names in a `schtasks /Query /FO CSV /NH` listing whose
 * registration epoch (the `-<ms>` suffix) lies more than `maxAgeMs` before
 * `nowMs` — tasks that fired, or were missed, for good (#544). Only root-level
 * `\ClaudeAutonomousWatchdog-<digits>` rows count. Pure, so it is unit-testable.
 * @param {string} csv
 * @param {number} nowMs
 * @param {number} [maxAgeMs]
 * @returns {string[]}
 */
function staleWatchdogTaskNames(csv, nowMs, maxAgeMs = STALE_AFTER_MS) {
  const out = new Set();
  for (const m of String(csv || '').matchAll(/"\\(ClaudeAutonomousWatchdog-(\d{1,16}))"/g)) {
    const epoch = Number(m[2]);
    if (Number.isFinite(epoch) && nowMs - epoch > maxAgeMs && isValidWatchdogTaskName(m[1])) out.add(m[1]);
  }
  return [...out];
}

/**
 * Delete watchdog tasks and helper scripts older than STALE_AFTER_MS (#544).
 * Earlier plugin versions never removed their task, and a task that never
 * fired (PC off at its time) never removed its script. A live registration is
 * at most MAX_HOURS old, so it is never touched. Best effort and bounded:
 * never throws, deletes at most SWEEP_MAX tasks per call.
 * @param {{now?: number, spawn?: Function, tmp?: string}} [deps]
 * @returns {{tasks: string[], scripts: number}}
 */
function sweepStaleWatchdogs({ now = Date.now(), spawn = spawnSync, tmp = os.tmpdir(), budgetMs = SWEEP_BUDGET_MS, clock = Date.now } = {}) {
  const swept = { tasks: [], scripts: 0 };
  // One deadline for the whole sweep: a slow or hung Task Scheduler (right
  // after boot, a loaded machine) must never hold the registration's caller.
  const deadline = clock() + budgetMs;
  const left = () => deadline - clock();
  try {
    const query = spawn('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH'], { ...SPAWN_OPTS, timeout: Math.max(1, Math.min(SPAWN_TIMEOUT_MS, left())) });
    const stale = query && query.status === 0
      ? staleWatchdogTaskNames(query.stdout, now).slice(0, SWEEP_MAX) : [];
    for (const name of stale) {
      if (left() <= 0) break;
      const del = spawn('schtasks.exe', ['/Delete', '/TN', name, '/F'], { ...SPAWN_OPTS, timeout: Math.max(1, Math.min(SPAWN_TIMEOUT_MS, left())) });
      if (del && (del.status === 0 || taskNotFound(del))) swept.tasks.push(name);
    }
  } catch { /* best effort: the next registration sweeps again */ }
  let names = [];
  try { names = fs.readdirSync(tmp); } catch { /* TEMP unreadable: nothing to sweep */ }
  for (const name of names) {
    const m = /^claude-autonomous-watchdog-(\d{1,16})\.ps1$/.exec(name);
    if (!m || !(now - Number(m[1]) > STALE_AFTER_MS)) continue;
    const file = path.join(tmp, name);
    if (!isValidWatchdogScriptPath(file, tmp)) continue;
    try { fs.unlinkSync(file); swept.scripts++; } catch { /* in use or already gone */ }
  }
  return swept;
}

/**
 * Remove every registration whose sentinel names `flagPath`: its scheduled
 * task, helper script and sentinel. Used before a new registration for the
 * same project and once its done-flag is written — the task then has nothing
 * left to do (#544). Sentinels are untrusted (same-user TEMP): names and
 * paths are validated before anything is deleted.
 * @param {string} flagPath
 * @param {{spawn?: Function, sentinels?: Array<{file:string, data:object}>}} [deps]
 * @returns {string[]} task names whose task is gone now
 */
function removeRegistrationsFor(flagPath, { spawn = spawnSync, sentinels = listSentinels() } = {}) {
  const flagN = path.resolve(flagPath).toLowerCase();
  const removed = [];
  for (const prev of sentinels) {
    const prevFlag = typeof prev.data?.flagPath === 'string'
      ? path.resolve(prev.data.flagPath).toLowerCase() : null;
    if (prevFlag !== flagN) continue;
    if (prev.data.taskName && isValidWatchdogTaskName(prev.data.taskName)) {
      let del = null;
      try { del = spawn('schtasks.exe', ['/Delete', '/TN', prev.data.taskName, '/F'], SPAWN_OPTS); }
      catch { /* spawn failed: the task may still be armed, the flag still disarms it */ }
      if (del && (del.status === 0 || taskNotFound(del))) removed.push(prev.data.taskName);
    }
    if (prev.data.scriptPath && isValidWatchdogScriptPath(prev.data.scriptPath) &&
        fs.existsSync(prev.data.scriptPath)) {
      try { fs.unlinkSync(prev.data.scriptPath); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(prev.file); } catch { /* ignore */ }
  }
  return removed;
}

/**
 * Build the recovery PowerShell script that the scheduled task executes on fire.
 * It checks the done-flag and, if missing, runs the mode-specific recovery.
 * `recoveryFlagPath`, `workingDir`, `resumePrompt` are only consulted for the
 * "resume" action — they are computed by the (Windows-only) caller and passed
 * in, never derived here, so the pure builder stays cross-platform testable.
 * @param {{action:string, hours:number, flagPath:string, stalledPath:string,
 *          recoveryFlagPath?:string, workingDir?:string, resumePrompt?:string}} o
 * @returns {string} PowerShell script body, written to a self-deleting .ps1.
 */
function buildRecoveryScript({
  action, hours, flagPath, stalledPath, recoveryFlagPath, workingDir, resumePrompt,
}) {
  const flagPs = flagPath.replace(/'/g, "''");
  const stalledPs = String(stalledPath || '').replace(/'/g, "''");

  // Shared visible stalled marker — notify AND resume both surface it, so a hang
  // is never invisible even when a relaunch is impossible.
  const notifyMarker = (context) => `  $msg = @(
    "Claude autonomous session was unresponsive after ${hours}h and never reached completion.",
    "",
    "The run wedged (likely an Anthropic API hang or a stuck subagent).${context}",
    "Check AUTONOMOUS-RESUME.json for saved state, then resume or restart the session.",
    "",
    "Stalled at: $ts"
  )
  Set-Content -Path '${stalledPs}' -Value $msg -Encoding UTF8`;

  // Recovery action when the flag is missing — differs by mode.
  let recoveryPs;
  if (action === 'shutdown') {
    recoveryPs = `  Add-Content -Path $logPath -Value "[$ts] flag MISSING at $flag — forcing shutdown"
  & "$env:SystemRoot\\System32\\shutdown.exe" /s /t 0 /c "Claude autonomous watchdog: session unresponsive after ${hours}h, forcing shutdown"`;
  } else if (action === 'resume') {
    const recoveryFlagPs = String(recoveryFlagPath || '').replace(/'/g, "''");
    const dirPs = String(workingDir || '').replace(/'/g, "''");
    const promptPs = String(resumePrompt || '').replace(/'/g, "''");
    // notify first (always visible), then a ONE-SHOT relaunch guarded by a
    // recovery flag so a repeatedly-firing task can never fork-bomb `claude`.
    // No `claude` on PATH → notify-only, no error.
    recoveryPs = `  Add-Content -Path $logPath -Value "[$ts] flag MISSING at $flag — resume mode"
${notifyMarker(' A one-shot resume was attempted (see watchdog log).')}
  $recoveryFlag = '${recoveryFlagPs}'
  if (Test-Path $recoveryFlag) {
    Add-Content -Path $logPath -Value "[$ts] recovery already attempted — notify-only, not relaunching"
  } else {
    Set-Content -Path $recoveryFlag -Value $ts -Encoding UTF8
    $claude = Get-Command claude -ErrorAction SilentlyContinue
    if ($claude) {
      try {
        Start-Process -FilePath $claude.Source -ArgumentList @('-p','${promptPs}') -WorkingDirectory '${dirPs}' -WindowStyle Hidden
        Add-Content -Path $logPath -Value "[$ts] resume launched via $($claude.Source)"
      } catch {
        Add-Content -Path $logPath -Value "[$ts] resume launch FAILED: $($_.Exception.Message)"
      }
    } else {
      Add-Content -Path $logPath -Value "[$ts] claude not found on PATH — notify-only"
    }
  }`;
  } else {
    recoveryPs = `  Add-Content -Path $logPath -Value "[$ts] flag MISSING at $flag — writing stalled marker (notify mode)"
${notifyMarker(' Nothing was shut down.')}`;
  }
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
 * The task removes itself (#544): its trigger ends TRIGGER_WINDOW_MIN after the
 * fire time (`EndBoundary`, the invariant sortable 's' format — no culture
 * parsing) and `DeleteExpiredTaskAfter 0` lets Task Scheduler delete it once
 * that window has passed, whether it ran or was missed. Should either setting
 * be refused, the plain one-shot registration below it still arms the deadman
 * — cleanup is a nicety, the watchdog is not.
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
  const register = `Register-ScheduledTask -TaskName '${tnPs}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`;
  return [
    `$ErrorActionPreference = 'Stop'`,
    `try {`,
    `  $at = Get-Date -Year ${year} -Month ${month} -Day ${day} -Hour ${hour} -Minute ${minute} -Second 0`,
    `  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${spPs}"'`,
    `  try {`,
    `    $trigger = New-ScheduledTaskTrigger -Once -At $at`,
    `    $trigger.EndBoundary = $at.AddMinutes(${TRIGGER_WINDOW_MIN}).ToString('s')`,
    `    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DeleteExpiredTaskAfter (New-TimeSpan -Seconds 0)`,
    `    ${register}`,
    `  } catch {`,
    `    $trigger = New-ScheduledTaskTrigger -Once -At $at`,
    `    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `    ${register}`,
    `  }`,
    `} catch {`,
    `  Write-Error $_.Exception.Message`,
    `  exit 1`,
    `}`,
  ].join('\n');
}

function runRegister(args) {
  const [flagPathRaw, hoursRaw, actionRaw, resumePromptRaw] = args;
  if (!flagPathRaw || !hoursRaw) {
    fail('Usage: register <flag-path> <hours> [shutdown|notify|resume] [resume-prompt]');
  }
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 0.1 || hours > MAX_HOURS) {
    fail(`hours must be 0.1..${MAX_HOURS}`);
  }
  const action = actionRaw || 'shutdown';
  if (action !== 'shutdown' && action !== 'notify' && action !== 'resume') {
    fail("action must be 'shutdown', 'notify' or 'resume'");
  }
  const resumePrompt = resumePromptRaw || '';
  if (action === 'resume' && !resumePrompt) {
    fail("action 'resume' requires a resume-prompt argument");
  }
  const flagPath = path.resolve(flagPathRaw);
  // notify/resume drop a visible marker next to the flag; same dir, fixed name.
  const stalledPath = path.join(path.dirname(flagPath), 'AUTONOMOUS-STALLED.txt');
  // resume mode: a one-per-run relaunch guard + the working dir for the fresh
  // session (both computed here, on Windows, and passed to the pure builder).
  const recoveryFlagPath = path.join(path.dirname(flagPath), 'AUTONOMOUS-RECOVERY.flag');
  const workingDir = path.dirname(flagPath);

  // Clean up a previous watchdog FOR THIS PROJECT ONLY (same flagPath).
  // Parallel autonomous sessions in other projects keep their watchdogs —
  // the old global "only one active at a time" takeover deleted the sibling
  // session's task and let its sentinel shadow ours (2026-07-05 incident).
  removeRegistrationsFor(flagPath);

  // A registration starts a new run: the done-flag and the one-shot relaunch
  // guard of an earlier run in this directory would otherwise disarm the new
  // watchdog from its first second (flag present → "no action") and make the
  // resume scan skip the new run as finished.
  for (const stale of [flagPath, recoveryFlagPath]) {
    try { fs.unlinkSync(stale); } catch { /* absent */ }
  }

  const taskName = `${TASK_PREFIX}-${Date.now()}`;
  const fireAt = new Date(Date.now() + hours * 3600_000);

  // Write a separate PowerShell script — robust escaping, self-deletes after run.
  const scriptPath = path.join(os.tmpdir(),
    `claude-autonomous-watchdog-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath,
    buildRecoveryScript({
      action, hours, flagPath, stalledPath, recoveryFlagPath, workingDir, resumePrompt,
    }), 'utf8');

  // Register via the PowerShell ScheduledTasks module rather than `schtasks /SD /ST`:
  // the trigger time is passed as a real DateTime, so it is culture-agnostic and
  // does not break on non-US locales (see buildRegisterPsCommand).
  const psCommand = buildRegisterPsCommand({ taskName, scriptPath, fireAt });
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    { ...SPAWN_OPTS, timeout: REGISTER_TIMEOUT_MS });

  if (result.status !== 0) {
    // No task means no use for its script. A timed-out Register call may
    // still land a task: without its script it does nothing when it fires,
    // and it expires on its own (or falls to a later sweep).
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    const why = result.error ? result.error.message : (result.stderr || result.stdout || '').trim();
    fail(`watchdog task registration failed: ${why}`);
  }

  fs.writeFileSync(sentinelFileFor(taskName), JSON.stringify({
    taskName,
    flagPath,
    scriptPath,
    fireAt: fireAt.toISOString(),
    hours,
    action,
    ...(action === 'resume' ? { resumePrompt } : {}),
  }, null, 2));

  // Leftovers of earlier registrations (#544) go only now, once the deadman
  // is armed, under one short budget — a hung Task Scheduler can delay
  // the cleanup, never the watchdog itself.
  const swept = sweepStaleWatchdogs();

  ok({ taskName, flagPath, fireAt: fireAt.toISOString(), scriptPath, action, swept });
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
  // The flag disarms the watchdog; its task would only log "no action" when
  // it fires, so it goes now instead of piling up in Task Scheduler (#544).
  ok({ flagPath, unregistered: removeRegistrationsFor(flagPath) });
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
    ['/Delete', '/TN', taskName, '/F'], SPAWN_OPTS);

  // Not-found is acceptable — the task may have already fired or never existed.
  const notFound = taskNotFound(result);
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
    ['/Query', '/TN', taskName], SPAWN_OPTS);
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
  removeRegistrationsFor,
  sentinelFileFor,
  staleWatchdogTaskNames,
  sweepStaleWatchdogs,
  STALE_AFTER_MS,
};
