/**
 * @module governor/state
 * @description File state of the governor: atomic JSON writes (tmp+rename),
 *   the versioned state file, the watcher singleton lock (exclusive create,
 *   heartbeat, stale takeover, version handover) and a tiny mkdir lock for
 *   hook-side reservations. No policy here.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FORMAT = 1;

function readJson(file, fallback = null) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return v && typeof v === 'object' ? v : fallback;
  } catch { return fallback; }
}

const RENAME_RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);

function pause(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } }
}

/**
 * Atomic write: tmp file + rename. The tmp file never outlives a failure — a failed write or a
 * rename that still fails after the retries (Windows: a reader or scanner holding the target open
 * makes rename fail briefly with EPERM/EACCES/EBUSY) removes it before rethrowing. Leftovers of a
 * killed process are swept by sweep() on watcher start.
 */
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); return; } catch (e) {
        if (i >= 10 || !RENAME_RETRY.has(e.code)) throw e;
        pause(5 * (i + 1));
      }
    }
  } catch (e) { removeFile(tmp); throw e; }
}

function removeFile(file) { try { fs.unlinkSync(file); return true; } catch { return false; } }

/** All JSON files of a directory as [{file, data}] (unreadable ones skipped). */
function readDir(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const data = readJson(path.join(dir, n));
    if (data) out.push({ file: path.join(dir, n), data });
  }
  return out;
}

function listDir(dir) { try { return fs.readdirSync(dir).map((n) => path.join(dir, n)); } catch { return []; } }

/**
 * Housekeeping on watcher start. Removes what is older than maxAgeMs (default 1 h): *.tmp files of
 * interrupted atomic writes, foreground records, session records whose Claude pid is gone; and
 * queue entries past queueExpiryMs (a younger deferred command may still be waiting for its
 * session). Never throws.
 * @returns {{tmp:number, foreground:number, sessions:number, queue:number, total:number}}
 */
function sweep(p, now, { maxAgeMs = 3600000, queueExpiryMs = 24 * 3600000, alive = isAlive } = {}) {
  const out = { tmp: 0, foreground: 0, sessions: 0, queue: 0, total: 0 };
  try {
    const old = (file) => { try { return now - fs.statSync(file).mtimeMs > maxAgeMs; } catch { return false; } };
    for (const dir of [p.home, p.sessions, p.foreground, p.queue, p.inflight, ...listDir(p.inflight)]) {
      for (const f of listDir(dir)) if (f.endsWith('.tmp') && old(f) && removeFile(f)) out.tmp++;
    }
    for (const { file, data } of readDir(p.foreground)) if (now - (data.startedAt || 0) > maxAgeMs && removeFile(file)) out.foreground++;
    for (const { file, data } of readDir(p.sessions)) if (now - (data.startedAt || 0) > maxAgeMs && !alive(data.claudePid) && removeFile(file)) out.sessions++;
    for (const { file, data } of readDir(p.queue)) if (now - (data.created_at || 0) >= queueExpiryMs && removeFile(file)) out.queue++;
  } catch { /* never throw */ }
  out.total = out.tmp + out.foreground + out.sessions + out.queue;
  return out;
}

/** The state file; `newer: true` when written by a newer format (an older watcher must back off). */
function readState(p) {
  const s = readJson(p.state);
  if (!s) return null;
  return { ...s, newer: Number(s.format) > FORMAT };
}

function writeState(p, state) { writeJson(p.state, { ...state, format: FORMAT }); }

function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Process start time (ms) for pid-reuse checks, or 0 when unknown. Best effort. */
function processStart(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 0;
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
      const btime = Number((fs.readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)/m) || [])[1]);
      if (Number.isFinite(ticks) && Number.isFinite(btime)) return (btime + ticks / 100) * 1000;
    }
  } catch { /* unknown */ }
  return 0;
}

/**
 * Take the watcher lock. Exclusive create wins; a holder is taken over ONLY
 * when its process is gone (pid not alive, or alive but started after the
 * lock was written — pid reuse). A stale heartbeat on a live pid is NOT a
 * takeover (R6: a busy watcher must not be evicted). A live holder with an
 * older plugin version gets a handover request instead.
 * @returns {{ok:boolean, holder?:object, handover?:boolean, takeover?:boolean}}
 */
function acquireLock(p, { pid, version, now, startMs = now, alive = isAlive, startOf }) {
  fs.mkdirSync(path.dirname(p.lock), { recursive: true });
  const me = { pid, version, startedAt: now, startMs, heartbeat: now };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(p.lock, JSON.stringify(me), { flag: 'wx' });
      return { ok: true, takeover: attempt > 0 };
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, error: e.code };
    }
    const holder = readJson(p.lock);
    let dead;
    if (!holder) {
      let mtime = 0;
      try { mtime = fs.statSync(p.lock).mtimeMs; } catch { continue; }
      dead = now - mtime >= 2000; // empty file left mid-write: dead only once it is no longer being written
    } else {
      // startOf() === 0 means "unknown" (win32 has no cheap lookup): never evidence of reuse.
      const seen = startOf ? startOf(holder.pid) : 0;
      const reused = seen > 0 && Number.isFinite(holder.startMs) && Math.abs(seen - holder.startMs) > 2000;
      dead = !alive(holder.pid) || reused;
    }
    if (!dead) {
      if (holder && compareVersions(version, holder.version) > 0) {
        writeJson(p.handover, { pid, version, at: now });
        return { ok: false, holder, handover: true };
      }
      return { ok: false, holder };
    }
    const aside = `${p.lock}.stale-${pid}-${now}`;
    try { fs.renameSync(p.lock, aside); removeFile(aside); } catch { /* another starter won the rename */ }
  }
  return { ok: false };
}

/** Rewrite the heartbeat; false when the lock is no longer ours (taken over). */
function heartbeat(p, pid, version, now) {
  const holder = readJson(p.lock);
  if (!holder || holder.pid !== pid) return false;
  writeJson(p.lock, { ...holder, version, heartbeat: now });
  return true;
}

function releaseLock(p, pid) {
  const holder = readJson(p.lock);
  if (holder && holder.pid === pid) removeFile(p.lock);
}

/** A newer watcher asked us to step down. */
function handoverRequested(p, version, now, maxAgeMs = 60000) {
  const h = readJson(p.handover);
  return Boolean(h && compareVersions(h.version, version) > 0 && now - (h.at || 0) < maxAgeMs);
}

module.exports = {
  FORMAT, readJson, writeJson, removeFile, readDir, readState, writeState, sweep,
  compareVersions, isAlive, processStart, acquireLock, heartbeat, releaseLock, handoverRequested,
};
