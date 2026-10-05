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
      const reused = startOf && Number.isFinite(holder.startMs) && Math.abs((startOf(holder.pid) || 0) - holder.startMs) > 2000;
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
  FORMAT, readJson, writeJson, removeFile, readDir, readState, writeState,
  compareVersions, isAlive, processStart, acquireLock, heartbeat, releaseLock, handoverRequested,
};
