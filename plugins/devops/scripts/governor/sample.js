/**
 * @module governor/sample
 * @description Turns two raw adapter snapshots into rates (pure). Adapters
 *   report cumulative counters — CPU ms, IO bytes, disk latency numerator /
 *   base, paged-in pages — because the formatted OS counters either round to
 *   zero (Windows AvgDisksecPerTransfer) or are localized. A process only
 *   gets a rate when it is the same process in both snapshots (pid + start).
 *
 * raw = { ts, cores, procs:[{pid, ppid, name, path, cmd, startMs, cpuMs, ioBytes, memMB, gpuPct}],
 *         sys:{ cpuPct, gpuPct, disk:{num, base, freq} | {ticksMs, ios} | {ms}, diskQueue,
 *               totalMB, freeMB, pagesIn }, fg, listening }
 */
'use strict';

function diskMs(prev, cur) {
  if (!cur) return NaN;
  if (Number.isFinite(cur.ms)) return cur.ms;
  if (!prev) return NaN;
  if (Number.isFinite(cur.num) && Number.isFinite(cur.base) && cur.freq > 0) {
    const db = cur.base - prev.base;
    return db > 0 ? ((cur.num - prev.num) / cur.freq / db) * 1000 : 0;
  }
  if (Number.isFinite(cur.ticksMs) && Number.isFinite(cur.ios)) {
    const di = cur.ios - prev.ios;
    return di > 0 ? (cur.ticksMs - prev.ticksMs) / di : 0;
  }
  return NaN;
}

/** @returns {{ts, procs:object[], sys:object, fg, listening:Set<number>}} */
function derive(prev, raw) {
  const cores = raw.cores || 1;
  const dt = prev ? raw.ts - prev.ts : 0;
  const before = new Map(((prev && prev.procs) || []).map((p) => [p.pid, p]));
  const procs = (raw.procs || []).map((p) => {
    const b = before.get(p.pid);
    const same = b && Math.abs((b.startMs || 0) - (p.startMs || 0)) < 2000;
    const cpuPct = same && dt > 0 && Number.isFinite(p.cpuMs) ? Math.max(0, ((p.cpuMs - b.cpuMs) / (dt * cores)) * 100) : (p.cpuPct || 0);
    const ioBps = same && dt > 0 && Number.isFinite(p.ioBytes) ? Math.max(0, ((p.ioBytes - b.ioBytes) / dt) * 1000) : 0;
    return { ...p, cpuPct: Math.min(100, cpuPct), ioBps };
  });
  const s = raw.sys || {};
  const ps = (prev && prev.sys) || {};
  const pagesPerSec = dt > 0 && Number.isFinite(s.pagesIn) && Number.isFinite(ps.pagesIn) ? Math.max(0, ((s.pagesIn - ps.pagesIn) / dt) * 1000) : 0;
  const sys = {
    cpuPct: s.cpuPct, gpuPct: s.gpuPct || 0, diskMs: diskMs(ps.disk, s.disk), diskQueue: s.diskQueue || 0,
    totalMB: s.totalMB, freeMB: s.freeMB, pagesPerSec, disk: s.disk, pagesIn: s.pagesIn,
  };
  return { ts: raw.ts, procs, sys, fg: raw.fg || null, listening: new Set(raw.listening || []) };
}

module.exports = { derive, diskMs };
