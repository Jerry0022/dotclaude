#!/usr/bin/env node
'use strict';
/**
 * @module session-autosave-worker
 * @version 0.1.0
 * @plugin devops
 * @description Runs the session autosave outside the Stop hook, so a slow save
 *   (p90 28 s, max 192 s in the 2026-10 audit) never holds a turn end. The
 *   Stop hook (stop.session.autosave) starts this script detached and
 *   windowless, waits `sessionEnd.autosaveWaitSeconds` for the result file and
 *   — when it is not there yet — leaves the save running.
 *
 *   While it runs, the worker keeps a running marker `{pid, start}` per session
 *   (tmp dir); pre.session.archive refuses to archive the session while the
 *   marker is live (`isRunning`: younger than 10 min and the pid alive). The
 *   worker removes the marker when it is done and writes the result
 *   (`{message}` or `{}`) to `<marker>.result` for a hook that still waits.
 *
 *   This module is also a tiny dependency of the archive gate: the marker
 *   helpers load nothing heavy; lib/session-autosave.js is required lazily.
 *
 *   CLI: node session-autosave-worker.js '<json payload>'
 *   payload: { sessionId, cwd, mode, delayMs? }  (delayMs: test seam)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER_PREFIX = 'dotclaude-devops-autosave-running';
/** A marker older than this is stale — a crashed worker must not block archiving forever. */
const STALE_MS = 10 * 60 * 1000;

function markerFile(sessionId) {
  const key = String(sessionId || 'unknown').replace(/[^\w.-]/g, '_');
  return path.join(os.tmpdir(), `${MARKER_PREFIX}-${key}`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e) && e.code === 'EPERM'; }
}

/** Is an autosave of this session still running? Stale or dead-pid markers read as no. */
function isRunning(sessionId, now = Date.now()) {
  try {
    const m = JSON.parse(fs.readFileSync(markerFile(sessionId), 'utf8'));
    return now - m.start < STALE_MS && pidAlive(m.pid);
  } catch {
    return false;
  }
}

function unlinkQuiet(f) { try { fs.unlinkSync(f); } catch { /* absent */ } }

async function run(payload) {
  const marker = markerFile(payload.sessionId);
  const result = `${marker}.result`;
  unlinkQuiet(result);
  try { fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, start: Date.now() })); } catch { /* best effort */ }
  let out = {};
  try {
    if (payload.delayMs) await new Promise((r) => setTimeout(r, payload.delayMs));
    const res = await require('./session-autosave').autosave({
      cwd: payload.cwd, mode: payload.mode,
      shipActive: (top) => require('./ship-sentinel').isActive(top),
    });
    if (res) out = { message: res.message };
  } catch { /* fail open: nothing saved */ }
  // result first, marker last: a waiting hook never sees "not running" without a result
  try { fs.writeFileSync(result, JSON.stringify(out)); } catch { /* best effort */ }
  unlinkQuiet(marker);
  return out;
}

module.exports = { markerFile, isRunning, run, STALE_MS };

if (require.main === module) {
  let payload = null;
  try { payload = JSON.parse(process.argv[2] || ''); } catch { /* none */ }
  if (payload && payload.cwd) run(payload).finally(() => { process.exitCode = 0; });
}
