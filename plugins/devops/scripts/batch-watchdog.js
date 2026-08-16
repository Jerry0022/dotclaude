#!/usr/bin/env node
/**
 * @script batch-watchdog
 * @version 0.1.0
 * @plugin devops
 * @description Inactivity reminder for `/claude-batch` collect mode. Polls the
 *   dedicated user-activity clock and fires ONE Windows toast once the user has
 *   been quiet for the configured window, so a collection session started
 *   before a coffee break does not sit forgotten.
 *
 *   Costs zero tokens: this is a plain Node process talking to PowerShell. It
 *   never re-enters Claude.
 *
 *   The clock is `.claude/batch-activity`, written only for REAL user prompts.
 *   Hanging the timer off general session activity would never fire — the
 *   concept bridge cron polls once a minute and git-sync every ten.
 *
 *   Orphan protection (a detached, unref'd process on Windows survives Claude
 *   Code exit, crashes and `/clear`):
 *     - PID lockfile with a liveness check before spawning a second one
 *     - hard self-expiry after MAX_LIFETIME_MS
 *     - self-exit as soon as the mode file disappears
 *
 *   Usage:
 *     node batch-watchdog.js start <project>   # spawn detached (idempotent)
 *     node batch-watchdog.js stop  <project>   # stop and clear the lock
 *     node batch-watchdog.js status <project>
 *     node batch-watchdog.js --run <project>   # internal: the polling loop
 *
 *   Spec: docs/superpowers/specs/2026-08-16-claude-batch-design.md
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const B = require(path.join(__dirname, '..', 'hooks', 'lib', 'batch-state.js'));

const POLL_MS         = 30_000;
const MAX_LIFETIME_MS = 2 * 60 * 60 * 1000; // hard stop — never outlive a workday
const RUN_FLAG        = '--run';

// ── lock ───────────────────────────────────────────────────────────────────

function readLock(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(B.lockPath(cwd), 'utf8'));
    return raw && typeof raw.pid === 'number' ? raw : null;
  } catch {
    return null;
  }
}

/** Signal 0 probes existence without touching the process. */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but owned by someone else
  }
}

function writeLock(cwd, pid) {
  fs.mkdirSync(B.claudeDir(cwd), { recursive: true });
  fs.writeFileSync(
    B.lockPath(cwd),
    JSON.stringify({ pid, startedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

function clearLock(cwd) {
  try { fs.unlinkSync(B.lockPath(cwd)); } catch { /* already gone */ }
}

// ── toast ──────────────────────────────────────────────────────────────────

/**
 * Windows balloon tip via NotifyIcon — same approach as post-merge-watcher.js.
 * Best-effort by design: a failed notification must never take the loop down.
 */
function notifyToast(title, message) {
  if (process.platform !== 'win32') return false;
  const safe = s => String(s).replace(/'/g, "''");
  const ps =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    '$n = New-Object System.Windows.Forms.NotifyIcon; ' +
    '$n.Icon = [System.Drawing.SystemIcons]::Information; ' +
    '$n.Visible = $true; ' +
    `$n.ShowBalloonTip(8000, '${safe(title)}', '${safe(message)}', 'Info'); ` +
    'Start-Sleep -Seconds 9; ' +
    '$n.Dispose()';
  try {
    spawnSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
      timeout: 15_000, stdio: 'ignore', detached: true,
    });
    return true;
  } catch {
    return false;
  }
}

// ── decision ───────────────────────────────────────────────────────────────

/**
 * Should the watchdog fire right now? Pure so it can be tested without timers.
 * @param {object} o
 * @param {boolean} o.modeActive
 * @param {number} o.noteCount
 * @param {number|null} o.lastActivity epoch ms
 * @param {number} o.now epoch ms
 * @param {number} o.inactivityMs
 * @param {boolean} o.alreadyNotified
 * @returns {'fire'|'wait'|'stop'}
 */
function decide({ modeActive, noteCount, lastActivity, now, inactivityMs, alreadyNotified }) {
  if (!modeActive) return 'stop';
  if (!noteCount) return 'wait';            // nothing collected — nothing to remind about
  if (lastActivity == null) return 'wait';  // no clock yet
  if (now - lastActivity < inactivityMs) return 'wait';
  return alreadyNotified ? 'wait' : 'fire';
}

// ── loop ───────────────────────────────────────────────────────────────────

function runLoop(cwd) {
  const cfg = B.loadConfig();
  const inactivityMs = Math.max(1, cfg.inactivityMinutes) * 60_000;
  const bornAt = Date.now();
  let lastSeenActivity = B.readActivity(cwd);
  let notified = false;

  writeLock(cwd, process.pid);

  let timer = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    clearLock(cwd);
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const tick = () => {
    const now = Date.now();
    if (now - bornAt >= MAX_LIFETIME_MS) return stop();

    let modeActive, noteCount, lastActivity;
    try {
      modeActive   = B.isModeActive(cwd);
      noteCount    = B.countNotes(cwd);
      lastActivity = B.readActivity(cwd);
    } catch {
      return stop(); // project gone / unreadable — do not linger
    }

    // Fresh user activity re-arms the reminder for the next quiet stretch.
    if (lastActivity != null && lastActivity !== lastSeenActivity) {
      lastSeenActivity = lastActivity;
      notified = false;
    }

    const verdict = decide({
      modeActive, noteCount, lastActivity, now, inactivityMs, alreadyNotified: notified,
    });
    if (verdict === 'stop') return stop();
    if (verdict === 'fire') {
      const mins = Math.round((now - lastActivity) / 60_000);
      notifyToast(
        `claude-batch — ${noteCount} Notiz${noteCount === 1 ? '' : 'en'} offen`,
        `Seit ${mins} Minuten still. "${cfg.marker} los" startet die Umsetzung, /claude-batch off beendet den Modus.`,
      );
      notified = true;
    }
  };

  // A referenced interval keeps the process alive on its own — no extra handle.
  timer = setInterval(tick, POLL_MS);
}

// ── commands ───────────────────────────────────────────────────────────────

/**
 * Spawn the loop detached and windowless. Spawns `node` directly with no shell
 * layer — a shell layer makes Windows Terminal open a visible tab even with
 * windowsHide (see the long note in hooks/lib/graphify-state.js).
 * @returns {number|null} pid, or null when one is already running
 */
function start(cwd) {
  const existing = readLock(cwd);
  if (existing && isAlive(existing.pid)) return null; // idempotent
  if (existing) clearLock(cwd);                       // stale lock from a crash

  try {
    const child = spawn(process.execPath, [__filename, RUN_FLAG, cwd], {
      cwd, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    if (child.pid) writeLock(cwd, child.pid);
    return child.pid || null;
  } catch {
    return null; // never let a failed watchdog break the skill
  }
}

function stopCmd(cwd) {
  const lock = readLock(cwd);
  if (lock && isAlive(lock.pid)) {
    try { process.kill(lock.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  clearLock(cwd);
  return true;
}

function status(cwd) {
  const lock = readLock(cwd);
  return {
    running: !!(lock && isAlive(lock.pid)),
    pid: lock?.pid ?? null,
    startedAt: lock?.startedAt ?? null,
    notes: (() => { try { return B.countNotes(cwd); } catch { return 0; } })(),
    modeActive: (() => { try { return B.isModeActive(cwd); } catch { return false; } })(),
  };
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const cwd = arg || process.cwd();
  switch (cmd) {
    case RUN_FLAG:  runLoop(cwd); break;
    case 'start':   process.stdout.write(JSON.stringify({ started: start(cwd) }) + '\n'); break;
    case 'stop':    stopCmd(cwd); process.stdout.write('{"stopped":true}\n'); break;
    case 'status':  process.stdout.write(JSON.stringify(status(cwd)) + '\n'); break;
    default:
      process.stderr.write('usage: batch-watchdog.js <start|stop|status> [project]\n');
      process.exit(1);
  }
}

module.exports = {
  decide, start, stopCmd, status, readLock, writeLock, clearLock, isAlive,
  notifyToast, POLL_MS, MAX_LIFETIME_MS,
};
