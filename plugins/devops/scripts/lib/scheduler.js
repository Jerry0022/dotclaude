'use strict';
/**
 * @module scripts/lib/scheduler
 * @version 0.1.0
 * @plugin devops
 * @description Register and remove a recurring OS job that runs a plain node
 *   script — Windows Task Scheduler, crontab on Linux/macOS. Used by the
 *   machine-level opt-ins (home-backup, wip-watch): their runs are pure node,
 *   no `claude` invocation, no Claude Code cron, no cloud routine — zero model
 *   tokens.
 *
 *   Windows: `Register-ScheduledTask` (PowerShell) because only it sets
 *   StartWhenAvailable — a laptop that was off at the scheduled time catches
 *   up at the next logon instead of skipping the day. The action runs through
 *   `conhost.exe --headless` so no console window flashes. Removal and lookup
 *   use schtasks.exe. Tasks live under the `\devops\` folder.
 *   Linux/macOS: one crontab line per job, tagged `# devops:<name>`, replaced
 *   in place; all other lines stay untouched.
 *
 *   Every spawn is injectable (`io.run`) so the logic is testable without
 *   touching the machine's scheduler. Nothing here throws: results carry
 *   `ok` and `detail`.
 */

const { spawnSync } = require('child_process');

const DAYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const PS_DAYS = Object.freeze({ sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' });
const TASK_FOLDER = '\\devops\\';
const SPAWN_TIMEOUT = 30_000;

/** Validated `{kind, time, day}`; throws on nonsense so a bad call never registers a broken job. */
function normalizeSchedule(schedule) {
  const kind = schedule && schedule.kind;
  if (kind !== 'daily' && kind !== 'weekly') throw new Error(`schedule.kind must be daily or weekly, got ${kind}`);
  const time = (schedule.time || '12:00').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`schedule.time must be HH:MM, got ${time}`);
  const day = kind === 'weekly' ? String(schedule.day || 'sun').toLowerCase().slice(0, 3) : null;
  if (kind === 'weekly' && !DAYS.includes(day)) throw new Error(`schedule.day must be one of ${DAYS.join(', ')}`);
  return { kind, hour: Number(m[1]), minute: Number(m[2]), time: `${m[1].padStart(2, '0')}:${m[2]}`, day };
}

function assertName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error(`invalid job name ${name}`);
}

/** Single-quote for PowerShell. */
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Double-quote one argument for a Windows command line (CreateProcess rules). */
function winArg(s) {
  const v = String(s);
  if (v && !/[\s"]/.test(v)) return v;
  return `"${v.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/** POSIX single-quote. */
function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * The PowerShell script that (re)registers the task.
 * @param {string} name job name (task `\devops\<name>`)
 * @param {object} schedule {kind, time, day}
 * @param {string[]} command argv — [nodeExe, script, ...args]
 */
function windowsRegisterScript(name, schedule, command) {
  assertName(name);
  const s = normalizeSchedule(schedule);
  const [exe, ...args] = command;
  const argLine = ['--headless', winArg(exe), ...args.map(winArg)].join(' ');
  const trigger = s.kind === 'daily'
    ? `New-ScheduledTaskTrigger -Daily -At ${psQuote(s.time)}`
    : `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${PS_DAYS[s.day]} -At ${psQuote(s.time)}`;
  return [
    "$ErrorActionPreference = 'Stop'",
    `$action = New-ScheduledTaskAction -Execute ${psQuote('conhost.exe')} -Argument ${psQuote(argLine)}`,
    `$trigger = ${trigger}`,
    '$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)',
    `Register-ScheduledTask -TaskPath ${psQuote(TASK_FOLDER)} -TaskName ${psQuote(name)} -Action $action -Trigger $trigger -Settings $settings -Description ${psQuote(`devops plugin: ${name} (pure node, no model tokens)`)} -Force | Out-Null`,
  ].join('\n');
}

/** The crontab line for the job, tagged with its marker. */
function cronLine(name, schedule, command) {
  assertName(name);
  const s = normalizeSchedule(schedule);
  const dow = s.kind === 'daily' ? '*' : String(DAYS.indexOf(s.day));
  return `${s.minute} ${s.hour} * * ${dow} ${command.map(shQuote).join(' ')} >/dev/null 2>&1 # devops:${name}`;
}

/** `text` (a crontab) with the job's line replaced, added, or — line null — removed. */
function applyCron(text, name, line) {
  const marker = `# devops:${name}`;
  const kept = String(text || '').replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !l.trimEnd().endsWith(marker));
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  if (line) kept.push(line);
  return kept.length ? kept.join('\n') + '\n' : '';
}

function defaultRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', timeout: SPAWN_TIMEOUT, windowsHide: true, input: opts.input,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

/**
 * Register (or replace) the job.
 * @param {{name:string, schedule:object, command:string[]}} job
 * @param {{platform?:string, run?:Function}} [io]
 * @returns {{ok:boolean, method:string, detail:string}}
 */
function registerJob(job, io = {}) {
  const platform = io.platform || process.platform;
  const run = io.run || defaultRun;
  try {
    if (platform === 'win32') {
      const script = windowsRegisterScript(job.name, job.schedule, job.command);
      const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      return { ok: r.status === 0, method: 'task-scheduler', detail: r.status === 0 ? `${TASK_FOLDER}${job.name}` : (r.stderr || r.stdout).trim() };
    }
    const line = cronLine(job.name, job.schedule, job.command);
    const cur = run('crontab', ['-l']);
    const next = applyCron(cur.status === 0 ? cur.stdout : '', job.name, line);
    const w = run('crontab', ['-'], { input: next });
    return { ok: w.status === 0, method: 'crontab', detail: w.status === 0 ? line : (w.stderr || w.stdout).trim() };
  } catch (e) {
    return { ok: false, method: platform === 'win32' ? 'task-scheduler' : 'crontab', detail: e.message };
  }
}

/**
 * Remove the job; a job that does not exist counts as removed.
 * @returns {{ok:boolean, method:string, detail:string}}
 */
function unregisterJob(name, io = {}) {
  const platform = io.platform || process.platform;
  const run = io.run || defaultRun;
  try {
    assertName(name);
    if (platform === 'win32') {
      const tn = `${TASK_FOLDER}${name}`;
      const q = run('schtasks.exe', ['/Query', '/TN', tn]);
      if (q.status !== 0) return { ok: true, method: 'task-scheduler', detail: 'not registered' };
      const r = run('schtasks.exe', ['/Delete', '/TN', tn, '/F']);
      return { ok: r.status === 0, method: 'task-scheduler', detail: r.status === 0 ? `removed ${tn}` : (r.stderr || r.stdout).trim() };
    }
    const cur = run('crontab', ['-l']);
    if (cur.status !== 0) return { ok: true, method: 'crontab', detail: 'no crontab' };
    if (!cur.stdout.split('\n').some((l) => l.trimEnd().endsWith(`# devops:${name}`))) {
      return { ok: true, method: 'crontab', detail: 'not registered' };
    }
    const next = applyCron(cur.stdout, name, null);
    const w = run('crontab', ['-'], { input: next });
    return { ok: w.status === 0, method: 'crontab', detail: w.status === 0 ? 'removed' : (w.stderr || w.stdout).trim() };
  } catch (e) {
    return { ok: false, method: platform === 'win32' ? 'task-scheduler' : 'crontab', detail: e.message };
  }
}

/** Is the job registered? null when that cannot be told. */
function isRegistered(name, io = {}) {
  const platform = io.platform || process.platform;
  const run = io.run || defaultRun;
  try {
    assertName(name);
    if (platform === 'win32') return run('schtasks.exe', ['/Query', '/TN', `${TASK_FOLDER}${name}`]).status === 0;
    const cur = run('crontab', ['-l']);
    if (cur.status !== 0) return false;
    return cur.stdout.split('\n').some((l) => l.trimEnd().endsWith(`# devops:${name}`));
  } catch {
    return null;
  }
}

module.exports = {
  DAYS, TASK_FOLDER,
  normalizeSchedule, windowsRegisterScript, cronLine, applyCron,
  registerJob, unregisterJob, isRegistered,
};
