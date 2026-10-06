const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require('./log');
const { paths, loadConfig, merge } = require('./config');
const { createWatcher } = require('./watcher');
const { createFakeAdapter } = require('./adapters/fake');

let dir;
let logs;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'govlog-')); logs = path.join(dir, 'logs'); fs.mkdirSync(logs, { recursive: true }); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const mkRun = (i, bytes = 10) => fs.writeFileSync(path.join(logs, `run-2026-10-0${Math.floor(i / 10)}T00-00-${String(i % 10).padStart(2, '0')}-000Z-${100 + i}.jsonl`), 'x'.repeat(bytes));

describe('governor log retention', () => {
  it('keeps the newest 10 of 11 run files', () => {
    for (let i = 0; i < 11; i++) mkRun(i);
    L.prune(logs, {});
    const left = L.runFiles(logs);
    expect(left.length).toBe(10);
    expect(left[0]).toMatch(/-101\.jsonl$/); // the oldest (100) went
  });
  it('openRun prunes to keepRuns INCLUDING the new run', () => {
    for (let i = 0; i < 11; i++) mkRun(i);
    const lg = L.openRun(logs, {}, { pid: 999, startMs: Date.UTC(2026, 9, 9) });
    lg.event('start', { v: 1 });
    expect(L.runFiles(logs).length).toBe(10);
    expect(L.runFiles(logs)).toContain(lg.name);
  });
  it('total size cap prunes the oldest runs first, never the current one', () => {
    for (let i = 0; i < 5; i++) mkRun(i, 1024 * 1024); // 5 MB
    L.prune(logs, { log: { maxTotalMB: 3 } }, L.runFiles(logs)[0]);
    const left = L.runFiles(logs);
    expect(left.reduce((s, n) => s + fs.statSync(path.join(logs, n)).size, 0)).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(left).toContain('run-2026-10-00T00-00-00-000Z-100.jsonl'); // protected current
  });
});

describe('governor log writing', () => {
  it('per-file cap: one log-truncated line, then only errors and start/stop', () => {
    const file = path.join(logs, 'run-x.jsonl');
    const lg = L.createLogger({ file, src: 't', cfg: { log: { maxFileMB: 0.001, dedupeMs: 0 } } });
    for (let i = 0; i < 50; i++) lg.event('throttle', { i });
    lg.event('apply-failed', { e: 1 }, 'error');
    lg.event('stop', { why: 'x' });
    const evs = lines(file).map((l) => l.ev);
    expect(evs.filter((e) => e === 'log-truncated').length).toBe(1);
    const after = evs.slice(evs.indexOf('log-truncated') + 1);
    expect(after).toEqual(['apply-failed', 'stop']);
  });
  it('dedupes identical event+fields within 30 s and flushes the count', () => {
    let t = 0;
    const file = path.join(logs, 'run-d.jsonl');
    const lg = L.createLogger({ file, src: 't', cfg: {}, now: () => t });
    for (let i = 0; i < 5; i++) { t = i * 1000; lg.event('priority-gained', { resource: 'gpu' }); }
    lg.event('other', {});
    t = 40000; lg.event('priority-gained', { resource: 'gpu' });
    const l = lines(file);
    expect(l.filter((x) => x.ev === 'priority-gained' && !x.repeated).length).toBe(2);
    expect(l.find((x) => x.repeated)).toMatchObject({ ev: 'priority-gained', repeated: 4 });
  });
  it('hooks.jsonl rotates to hooks.1.jsonl at the size cap (one backup)', () => {
    const p = paths(dir);
    fs.writeFileSync(path.join(logs, 'hooks.jsonl'), 'x'.repeat(2048));
    const lg = L.hookLogger(p, { log: { hooksMaxMB: 0.001 } }, 'gate');
    lg.event('admit', { decision: 'allow' });
    expect(fs.statSync(path.join(logs, 'hooks.1.jsonl')).size).toBe(2048);
    expect(lines(path.join(logs, 'hooks.jsonl'))[0]).toMatchObject({ src: 'gate', ev: 'admit' });
  });
  it('hooks write into the live watcher run file named in fresh state', () => {
    const p = paths(dir);
    fs.writeFileSync(path.join(logs, 'run-a.jsonl'), '');
    fs.writeFileSync(p.state, JSON.stringify({ heartbeat: Date.now(), logFile: 'run-a.jsonl' }));
    L.hookLogger(p, {}, 'gate').event('admit', {});
    expect(lines(path.join(logs, 'run-a.jsonl'))[0].src).toBe('gate');
    fs.writeFileSync(p.state, JSON.stringify({ heartbeat: Date.now() - 10 * 60000, logFile: 'run-a.jsonl' }));
    L.hookLogger(p, {}, 'gate').event('admit', {});
    expect(fs.existsSync(path.join(logs, 'hooks.jsonl'))).toBe(true);
  });
  it('clips long strings to 200 chars and never throws on an unwritable target', () => {
    const file = path.join(logs, 'run-c.jsonl');
    L.createLogger({ file, src: 't', cfg: {} }).event('admit', { command: 'x'.repeat(5000) });
    expect(lines(file)[0].command.length).toBeLessThanOrEqual(201);
    expect(() => L.createLogger({ file: path.join(dir, 'nope', '\0bad'), src: 't', cfg: {} }).event('x', {})).not.toThrow();
  });
  it('readable() prints the newest runs as one line per event', () => {
    const file = path.join(logs, 'run-2026-10-06T00-00-00-000Z-1.jsonl');
    L.createLogger({ file, src: 'watcher', cfg: {} }).event('throttle', { key: 'k', level: 1 });
    const out = L.readable(logs, 3);
    expect(out[0]).toMatch(/^== run-2026/);
    expect(out[1]).toMatch(/watcher\s+throttle\s+key=k level=1/);
  });
});

describe('watcher summary line', () => {
  it('writes a summary every 60 s only while something is tracked or pressed — nothing when idle', async () => {
    const p = paths(dir);
    fs.writeFileSync(p.config, JSON.stringify(merge({ notify: false }, {})));
    const events = [];
    const logger = { event: (ev, f) => events.push([ev, f]), flush() {}, name: 'run-t.jsonl' };
    const clock = { t: 0 };
    const sample = (ts) => ({ ts, cores: 8, procs: [], sys: { cpuPct: 10, freeMB: 20000, totalMB: 32768 }, fg: null, listening: [] });
    const adapter = createFakeAdapter({ samples: [sample(0)] });
    const w = createWatcher({ adapter, p, loadCfg: () => loadConfig(p), now: () => clock.t, deps: { logger } });
    await w.init(null);
    for (clock.t = 0; clock.t <= 300000; clock.t += 20000) { adapter.samples = [sample(clock.t)]; await w.tick(); }
    expect(events.filter(([e]) => e === 'summary').length).toBe(0); // idle
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    for (clock.t = 320000; clock.t <= 500000; clock.t += 20000) { adapter.samples = [sample(clock.t)]; await w.tick(); }
    const sums = events.filter(([e]) => e === 'summary');
    expect(sums.length).toBeGreaterThanOrEqual(2);
    expect(sums.length).toBeLessThanOrEqual(4);
    expect(sums[0][1]).toMatchObject({ priority: ['manual'] });
    expect(events.some(([e]) => e === 'priority-gained')).toBe(true);
    expect(S_readState(p).logFile).toBe('run-t.jsonl');
  });
});

function S_readState(p) { return JSON.parse(fs.readFileSync(p.state, 'utf8')); }

describe('gate hook logs its decision (no env leak)', () => {
  it.runIf(process.platform === 'win32')('one admit line with decision, reason, kind, truncated command — no environment', () => {
    const p = paths(dir);
    fs.writeFileSync(p.state, JSON.stringify({ format: 1, heartbeat: Date.now() - 10 * 60000, pressure: { priority: [], over: [] } }));
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../../hooks/pre-tool-use/pre.governor.gate.js')], {
      input: JSON.stringify({ session_id: 's1', tool_use_id: 't1', tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: dir }),
      env: { ...process.env, DOTCLAUDE_GOVERNOR_HOME: dir, DOTCLAUDE_GOVERNOR_NO_SPAWN: '1', SECRET_TOKEN: 'sk-should-not-leak' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const text = fs.readFileSync(path.join(logs, 'hooks.jsonl'), 'utf8');
    const l = text.trim().split('\n').map((x) => JSON.parse(x));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ src: 'gate', ev: 'admit', decision: 'allow', reason: 'watcher-absent', kind: 'npm test', command: 'npm test' });
    expect(text).not.toMatch(/sk-should-not-leak|SECRET_TOKEN|PATH=/);
  });
});
