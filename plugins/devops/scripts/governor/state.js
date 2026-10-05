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

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      // Windows: a reader holding the target open makes rename fail briefly.
      if (i >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      const until = Date.now() + 15; while (Date.now() < until) { /* spin briefly */ }
    }
  }
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

/**
 * Take the watcher lock. Exclusive create wins; a holder that is dead or has
 * not heartbeated for staleMs is taken over (rename is atomic: one winner).
 * A live holder with an older version gets a handover request.
 * @returns {{ok:boolean, holder?:object, handover?:boolean, takeover?:boolean}}
 */
function acquireLock(p, { pid, version, now, staleMs = 15000, alive = isAlive }) {
  fs.mkdirSync(path.dirname(p.lock), { recursive: true });
  const me = { pid, version, startedAt: now, heartbeat: now };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(p.lock, JSON.stringify(me), { flag: 'wx' });
      return { ok: true, takeover: attempt > 0 };
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: false, error: e.code };
    }
    const holder = readJson(p.lock);
    let fresh;
    if (holder) fresh = alive(holder.pid) && now - (holder.heartbeat || 0) < staleMs;
    else {
      let mtime = now;
      try { mtime = fs.statSync(p.lock).mtimeMs; } catch { continue; }
      fresh = now - mtime < 2000; // being written right now
    }
    if (fresh) {
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

/**
 * Short mutual exclusion between hooks of parallel sessions (mkdir is
 * atomic). Gives up after timeoutMs and runs fn anyway — a hook never hangs;
 * a lock dir older than 5 s is a crashed holder's and is removed.
 */
function withDirLock(dir, fn, timeoutMs = 150) {
  const lock = `${dir}.lock`;
  const end = Date.now() + timeoutMs;
  let held = false;
  while (!held) {
    try { fs.mkdirSync(lock); held = true; } catch (e) {
      if (e.code === 'ENOENT') { fs.mkdirSync(path.dirname(lock), { recursive: true }); continue; }
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) { fs.rmdirSync(lock); continue; } } catch { continue; }
      if (Date.now() > end) break;
      const until = Date.now() + 5; while (Date.now() < until) { /* spin */ }
    }
  }
  try { return fn(); } finally { if (held) { try { fs.rmdirSync(lock); } catch {} } }
}

module.exports = {
  FORMAT, readJson, writeJson, removeFile, readDir, readState, writeState,
  compareVersions, isAlive, acquireLock, heartbeat, releaseLock, handoverRequested, withDirLock,
};
