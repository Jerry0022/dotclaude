/**
 * @module governor/log
 * @description Bounded JSON-lines event log of the governor — enough to debug
 *   the last few sessions, never enough to fill the disk.
 *
 *   - One file per watcher run: logs/run-<ISO start>-<pid>.jsonl. Hooks write
 *     into the running watcher's file (named in state.json), else into
 *     logs/hooks.jsonl (rotated at log.hooksMaxMB to hooks.1.jsonl).
 *   - Retention, applied when a run starts: newest log.keepRuns run files;
 *     then oldest run files go until everything is <= log.maxTotalMB.
 *   - Per-file cap log.maxFileMB: one `log-truncated` line, then only errors
 *     and start/stop for the rest of that run.
 *   - Events only (decisions), never raw samples; identical event+fields
 *     within log.dedupeMs are counted and written once as `repeated: n`.
 *   - Lines carry ts, src, ev and the caller's fields; strings are cut to
 *     200 chars. Callers pass no environment and no file contents.
 *   Never throws; one short synchronous append per line, no fsync.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MB = 1024 * 1024;
const ALWAYS = new Set(['start', 'stop', 'log-truncated']);
const DEFAULTS = { keepRuns: 10, maxTotalMB: 20, maxFileMB: 2, hooksMaxMB: 1, dedupeMs: 30000 };

const opts = (cfg) => ({ ...DEFAULTS, ...((cfg && cfg.log) || {}) });

function clip(v) {
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 20).map(clip);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v).slice(0, 30)) o[k] = clip(x); return o; }
  return v;
}

function line(src, ev, fields, ts) {
  return `${JSON.stringify({ ts: new Date(ts).toISOString(), src, ev, ...clip(fields || {}) })}\n`;
}

function size(file) { try { return fs.statSync(file).size; } catch { return 0; } }

function runFiles(dir) {
  try { return fs.readdirSync(dir).filter((n) => /^run-.*\.jsonl$/.test(n)).sort(); } catch { return []; }
}

/** Retention: keep `keepRuns` newest run files (current included), then cap the total size. */
function prune(dir, cfg, current) {
  const o = opts(cfg);
  try {
    let runs = runFiles(dir);
    const excess = runs.length - o.keepRuns;
    for (const n of runs.slice(0, Math.max(0, excess))) if (n !== current) fs.rmSync(path.join(dir, n), { force: true });
    runs = runFiles(dir);
    const others = ['hooks.jsonl', 'hooks.1.jsonl'].reduce((s, n) => s + size(path.join(dir, n)), 0);
    let total = others + runs.reduce((s, n) => s + size(path.join(dir, n)), 0);
    for (const n of runs) {
      if (total <= o.maxTotalMB * MB) break;
      if (n === current) continue;
      total -= size(path.join(dir, n));
      fs.rmSync(path.join(dir, n), { force: true });
    }
  } catch { /* never throw */ }
}

/**
 * A logger bound to one file.
 * @returns {{file:string, event:(ev:string, fields?:object, level?:'info'|'error') => void, flush:() => void}}
 */
function createLogger({ file, src, cfg, now = Date.now, rotateAt = 0 }) {
  const o = opts(cfg);
  const seen = new Map(); // key -> {at, count, ev, fields}
  let truncated = size(file) >= o.maxFileMB * MB;
  const write = (ev, fields, level) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (rotateAt && size(file) >= rotateAt) fs.renameSync(file, file.replace(/\.jsonl$/, '.1.jsonl'));
      if (!rotateAt && !truncated && size(file) >= o.maxFileMB * MB) {
        truncated = true;
        fs.appendFileSync(file, line(src, 'log-truncated', { maxFileMB: o.maxFileMB }, now()));
      }
      if (truncated && level !== 'error' && !ALWAYS.has(ev)) return;
      fs.appendFileSync(file, line(src, ev, level === 'error' ? { level, ...fields } : fields, now()));
    } catch { /* never throw */ }
  };
  const flushKey = (key) => {
    const s = seen.get(key);
    if (s && s.count > 0) write(s.ev, { ...s.fields, repeated: s.count }, s.level);
    seen.delete(key);
  };
  return {
    file,
    event(ev, fields = {}, level = 'info') {
      try {
        const t = now();
        const key = `${ev}\n${JSON.stringify(fields)}`;
        const s = seen.get(key);
        if (s && t - s.at < o.dedupeMs) { s.count++; return; }
        if (s) flushKey(key);
        seen.set(key, { at: t, count: 0, ev, fields, level });
        for (const [k, x] of seen) if (k !== key && t - x.at >= o.dedupeMs) flushKey(k);
        write(ev, fields, level);
      } catch { /* never throw */ }
    },
    flush() { try { for (const k of [...seen.keys()]) flushKey(k); } catch {} },
  };
}

/** The watcher's run log: new file, retention applied first. */
function openRun(logsDir, cfg, { pid = process.pid, startMs = Date.now(), now } = {}) {
  const name = `run-${new Date(startMs).toISOString().replace(/[:.]/g, '-')}-${pid}.jsonl`;
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
  prune(logsDir, { log: { ...opts(cfg), keepRuns: Math.max(1, opts(cfg).keepRuns - 1) } }, null); // room for the new file
  const logger = createLogger({ file: path.join(logsDir, name), src: 'watcher', cfg, now });
  logger.name = name;
  return logger;
}

/** Hook/CLI logger: the live watcher's run file when state is fresh, else hooks.jsonl. */
function hookLogger(p, cfg, src, { now = Date.now } = {}) {
  try {
    const st = JSON.parse(fs.readFileSync(p.state, 'utf8'));
    const fresh = st && now() - (st.heartbeat || 0) < ((cfg && cfg.admission && cfg.admission.staleMs) || 60000);
    if (fresh && st.logFile && /^run-[\w.-]+\.jsonl$/.test(st.logFile)) {
      const file = path.join(p.logs, st.logFile);
      if (fs.existsSync(file)) return createLogger({ file, src, cfg, now });
    }
  } catch { /* no state */ }
  return createLogger({ file: path.join(p.logs, 'hooks.jsonl'), src, cfg, now, rotateAt: opts(cfg).hooksMaxMB * MB });
}

/** Human-readable lines of the newest `runs` run files (+ hooks.jsonl). */
function readable(logsDir, runs = 1) {
  const out = [];
  const files = [...runFiles(logsDir).slice(-Math.max(1, runs))];
  if (fs.existsSync(path.join(logsDir, 'hooks.jsonl'))) files.push('hooks.jsonl');
  for (const n of files) {
    out.push(`== ${n} (${Math.round(size(path.join(logsDir, n)) / 1024)} KB)`);
    let text = '';
    try { text = fs.readFileSync(path.join(logsDir, n), 'utf8'); } catch {}
    for (const l of text.split('\n')) {
      if (!l.trim()) continue;
      try {
        const { ts, src, ev, ...rest } = JSON.parse(l);
        const kv = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
        out.push(`${String(ts).slice(11, 19)} ${src.padEnd(7)} ${ev.padEnd(16)} ${kv}`);
      } catch { out.push(l); }
    }
  }
  return out;
}

/**
 * Plain-text digest of the last `hours` of logs (run files + hooks): runs (start, version, stop
 * reason), priority minutes per app and over-budget minutes per resource (one `summary` line ≈ one
 * active minute), throttles and release reasons, gate decisions and defers, top disk users, errors.
 * Bounded: the newest 20 runs and the top 10 of every list.
 * @returns {string[]}
 */
function report(logsDir, { hours = 24, now = Date.now() } = {}) {
  const since = now - hours * 3600000;
  const files = [...runFiles(logsDir), 'hooks.1.jsonl', 'hooks.jsonl'];
  const runs = [];
  const maps = { prio: new Map(), over: new Map(), throttles: new Map(), releases: new Map(), admits: new Map(), defers: new Map(), disk: new Map(), errors: new Map() };
  const add = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
  let summaries = 0;
  for (const n of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(logsDir, n), 'utf8'); } catch { continue; }
    let run = null;
    for (const l of text.split('\n')) {
      if (!l.trim()) continue;
      let e;
      try { e = JSON.parse(l); } catch { continue; }
      if (!(Date.parse(e.ts) >= since)) continue;
      const times = Number(e.repeated) > 0 ? Number(e.repeated) : 1;
      if (e.level === 'error') add(maps.errors, e.ev, times);
      if (e.ev === 'start') { run = { start: e.ts, version: e.version, stop: null }; runs.push(run); } else if (e.ev === 'stop') {
        if (run) run.stop = e.why; else runs.push({ start: null, version: null, stop: e.why });
      } else if (e.ev === 'summary') {
        summaries++;
        for (const a of e.priority || []) add(maps.prio, a);
        for (const r of e.over || []) add(maps.over, r);
        const top = new Set((e.diskTop || []).map((d) => { const m = String(d).match(/^(.*):([\w?]+):\d+ops\//); return m ? `${m[1]} (${m[2]})` : null; }).filter(Boolean));
        for (const d of top) add(maps.disk, d);
      } else if (e.ev === 'throttle') add(maps.throttles, `${e.name || '?'} [${(e.resources || []).join(',')}] level ${e.level}`, times);
      else if (e.ev === 'release') add(maps.releases, e.reason || '?', times);
      else if (e.ev === 'admit') add(maps.admits, `${e.decision}:${e.reason}`, times);
      else if (e.ev === 'queue-defer' || e.ev === 'llm-defer') add(maps.defers, `${e.kind || e.ev} — ${e.reason || '?'}`, times);
    }
  }
  const top = (m, unit = '') => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `  ${String(v).padStart(5)}${unit}  ${k}`);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const out = [`governor report — last ${hours} h (since ${new Date(since).toISOString().slice(0, 16)}Z)`];
  out.push(`runs: ${runs.length}`);
  for (const r of runs.slice(-20)) out.push(`  ${r.start ? r.start.slice(0, 16) : '?'}  v${r.version || '?'}  → ${r.stop || 'no stop line (running or crashed)'}`);
  out.push(`active minutes (summary lines): ${summaries}`);
  out.push('priority minutes per app:', ...top(maps.prio, ' min'));
  out.push('over-budget minutes per resource:', ...top(maps.over, ' min'));
  out.push(`throttles: ${sum(maps.throttles)}`, ...top(maps.throttles));
  out.push(`releases: ${sum(maps.releases)}`, ...top(maps.releases));
  out.push('gate decisions:', ...top(maps.admits));
  out.push(`gate defers: ${sum(maps.defers)}`, ...top(maps.defers));
  out.push('top disk users (minutes in the top 3):', ...top(maps.disk, ' min'));
  out.push(`errors: ${sum(maps.errors)}`, ...top(maps.errors));
  return out;
}

module.exports = { createLogger, openRun, hookLogger, prune, readable, runFiles, report, DEFAULTS };
