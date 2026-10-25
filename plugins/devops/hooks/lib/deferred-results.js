'use strict';
/**
 * @module deferred-results
 * @version 0.1.0
 * @plugin devops
 * @description Takes slow, purely informational SessionStart work off the
 *   critical path (hooks audit 2026-10: ~25 SessionStart hooks start at once,
 *   p50 11 s, several starts ~40 s of process congestion).
 *
 *   A SessionStart hook calls `deferOrRun({ name, script })` at its entry
 *   point (only when it is the main module). On the hook path it starts
 *   lib/deferred-worker.js detached and windowless and returns true at once
 *   (the hook then exits 0). The worker runs the SAME script with
 *   DEVOPS_DEFERRED_PHASE=bg, captures its stdout and stores it per session
 *   (`dotclaude-devops-deferred-<session>-<name>.json`, tmp dir).
 *   prompt.knowledge.dispatch calls `collect(sessionId)` on a real user prompt
 *   and injects what is ready; the rest follows on a later prompt.
 *
 *   Delivery is exactly once: a result is claimed by an atomic rename before it
 *   is read. Results older than 24 h are removed on every collect and by the
 *   ss.git.check tmp sweep (same file prefix), so a session that never prompts
 *   leaves nothing that grows.
 *
 *   DEVOPS_DEFERRED_PHASE: unset = hook path (defer); 'bg' = worker run (do the
 *   work, print the result); 'inline' = do everything synchronously (tests,
 *   explicit runs such as `--force`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'dotclaude-devops-deferred-';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const safe = (s) => String(s || 'unknown').replace(/[^\w.]/g, '_');

function resultFile(sessionId, name, dir = os.tmpdir()) {
  return path.join(dir, `${PREFIX}${safe(sessionId)}-${safe(name)}.json`);
}

/** Store a result atomically (tmp + rename). Empty text stores nothing. */
function write(sessionId, name, text, dir = os.tmpdir()) {
  if (!text || !String(text).trim()) return false;
  const f = resultFile(sessionId, name, dir);
  try {
    const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ name, ts: Date.now(), text: String(text) }));
    fs.renameSync(tmp, f);
    return true;
  } catch { return false; }
}

function prune(dir, now) {
  try {
    for (const e of fs.readdirSync(dir)) {
      if (!e.startsWith(PREFIX)) continue;
      const full = path.join(dir, e);
      try { if (now - fs.statSync(full).mtimeMs > MAX_AGE_MS) fs.unlinkSync(full); } catch { /* raced */ }
    }
  } catch { /* no tmp dir */ }
}

/**
 * Take every ready result of this session. Each file is claimed by rename, so
 * two concurrent prompts never deliver the same result twice.
 * @returns {string[]} texts, ordered by hook name
 */
function collect(sessionId, { dir = os.tmpdir(), now = Date.now() } = {}) {
  prune(dir, now);
  const own = `${PREFIX}${safe(sessionId)}-`;
  let names = [];
  try { names = fs.readdirSync(dir).filter((e) => e.startsWith(own) && e.endsWith('.json')).sort(); } catch { return []; }
  const texts = [];
  for (const e of names) {
    const full = path.join(dir, e);
    const claim = `${full}.taken-${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    try { fs.renameSync(full, claim); } catch { continue; } // another prompt got it
    try {
      const r = JSON.parse(fs.readFileSync(claim, 'utf8'));
      if (r && typeof r.text === 'string' && r.text.trim()) texts.push(r.text);
    } catch { /* corrupt: drop */ }
    try { fs.unlinkSync(claim); } catch { /* best effort */ }
  }
  return texts;
}

function readStdin() {
  try { if (!process.stdin.isTTY) return fs.readFileSync(0, 'utf8'); } catch { /* none */ }
  return '';
}

function spawnWorker(payload) {
  const child = require('child_process').spawn(process.execPath,
    [path.join(__dirname, 'deferred-worker.js'), JSON.stringify(payload)],
    { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

/**
 * Hook entry point. Returns true when the work was handed to a detached worker
 * (the caller then exits 0), false when the caller must do the work itself
 * (worker run, inline run, or the spawn failed).
 * @param {{name:string, script:string, args?:string[], inline?:boolean, spawn?:Function, input?:string}} o
 */
function deferOrRun(o) {
  if (process.env.DEVOPS_DEFERRED_PHASE || o.inline) return false;
  const raw = o.input !== undefined ? o.input : readStdin();
  let sessionId = '';
  try { sessionId = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw).session_id || ''; } catch { /* no payload */ }
  const payload = { name: o.name, script: o.script, args: o.args || [], input: raw, cwd: process.cwd(), sessionId };
  try {
    (o.spawn || spawnWorker)(payload);
    return true;
  } catch { return false; }
}

module.exports = { PREFIX, resultFile, write, collect, deferOrRun, MAX_AGE_MS };
