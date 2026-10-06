/**
 * @module governor/adapters/win32
 * @description Windows adapter: a thin JSON-lines client of ONE long-lived
 *   win-helper.ps1 (PowerShell start + Add-Type cost seconds, so never one
 *   PowerShell per action). The helper reverts everything it applied when
 *   its stdin closes, so a crashed watcher leaves nothing suspended.
 */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, 'win-helper.ps1');

class Helper {
  constructor(script = SCRIPT) { this.script = script; this.proc = null; this.pending = new Map(); this.seq = 0; this.buf = ''; this.timeouts = 0; this.onEvent = () => {}; }

  start(readyMs = 180000) {
    return new Promise((resolve, reject) => {
      const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      this.proc = p;
      const timer = setTimeout(() => { reject(new Error('helper not ready')); try { p.kill(); } catch {} }, readyMs);
      this.pending.set(0, { resolve: (d) => { clearTimeout(timer); this.pid = d && d.pid; resolve(d); }, reject });
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d) => this.onData(d));
      p.on('exit', () => {
        this.proc = null;
        for (const [, w] of this.pending) w.reject(new Error('helper exited'));
        this.pending.clear();
      });
      p.stdin.on('error', () => {});
    });
  }

  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const w = this.pending.get(msg.id);
      if (!w) continue;
      this.pending.delete(msg.id);
      if (msg.ok) w.resolve(msg.data); else w.reject(new Error(msg.error || 'helper error'));
    }
  }

  get alive() { return Boolean(this.proc); }

  call(op, args = {}, timeoutMs = 60000) {
    if (!this.proc) return Promise.reject(new Error('helper not running'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A wedged helper: after MAX_TIMEOUTS consecutive timeouts kill it; the watcher restarts it and re-releases.
        this.onEvent('helper-timeout', { op, consecutive: this.timeouts + 1 });
        if (++this.timeouts >= Helper.MAX_TIMEOUTS && this.proc) { this.onEvent('helper-killed', { after: this.timeouts }); try { this.proc.kill(); } catch {} }
        reject(new Error(`helper ${op} timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (d) => { clearTimeout(timer); this.timeouts = 0; resolve(d); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
    });
  }

  /** Graceful: ask the helper to revert everything and exit, then wait for its exit op. */
  async stop(waitMs = 15000) {
    const p = this.proc;
    if (!p) return;
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { p.kill(); } catch {} resolve(); }, waitMs);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      this.call('exit', {}, waitMs).then(() => {}).catch(() => {});
    });
  }
}

function createWin32Adapter(cfg, opts = {}) {
  const h = new Helper();
  if (opts.onEvent) h.onEvent = (n, f) => { try { opts.onEvent(n, f); } catch {} };
  return {
    name: 'win32',
    get selfPids() { return [process.pid, h.pid].filter(Boolean); },
    get alive() { return h.alive; },
    start: () => h.start(),
    stop: () => h.stop(),
    sample: (opts = {}) => h.call('sample', { gpu: opts.gpu !== false }, 60000),
    // Key-based: the helper keeps key -> {pid -> {startMs, suspended, capped}} and merges pids.
    apply: (key, level, pids) => h.call('apply', { key, level, pids, cpuPct: cfg.cap.cpuPct }),
    release: (key, pids) => h.call('release', { key, pids: pids || [] }),
    notify: (title, text) => h.call('notify', { title, text }, 15000).catch(() => null),
  };
}

Helper.MAX_TIMEOUTS = 3;

module.exports = { createWin32Adapter, Helper };
