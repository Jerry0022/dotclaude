const fs = require('fs');
const os = require('os');
const path = require('path');
const { paths, loadConfig } = require('./config');
const S = require('./state');
const Q = require('./queue');
const L = require('./log');
const { waitFor, parseDuration } = require('./cli');

let dir;
let p;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'govcli-')); p = paths(dir); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const writeState = (o) => S.writeState(p, { pressure: { priority: [], over: [] }, sys: { freeMB: 30000 }, ...o });

describe('governor wait', () => {
  it('E: waits while the resource presses, prints the culprit once, exit 0 when admitted and drops the entry', async () => {
    const clock = { t: 1e12 };
    const e = Q.newEntry({ command: 'docker build .', cwd: dir, now: clock.t });
    Q.save(p.queue, e);
    const pressed = { pressure: { priority: [], over: ['ram'] }, culprit: { ram: { text: 'RAM: OneDrive.Sync.Service.exe 33.0 GB' } } };
    writeState({ heartbeat: clock.t, ...pressed });
    const sleep = async (ms) => { clock.t += ms; writeState({ heartbeat: clock.t, ...(clock.t < 1e12 + 30000 ? pressed : {}) }); };
    const lines = [];
    const code = await waitFor({ p, cfg: loadConfig(p), id: e.id, timeoutMs: 600000, pollMs: 5000, now: () => clock.t, sleep, out: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines.filter((l) => l.startsWith('waiting:'))).toEqual(['waiting: RAM: OneDrive.Sync.Service.exe 33.0 GB [budget:ram]']);
    expect(lines[lines.length - 1]).toMatch(/^admitted after 30s/);
    expect(Q.list(p.queue)).toEqual([]);
  });

  it('E: exit 2 on timeout, 1 for an unknown id; --command needs no queue entry; durations', async () => {
    const clock = { t: 1e12 };
    const st = () => writeState({ heartbeat: clock.t, pressure: { priority: ['gpu'], over: [] }, priorityBy: 'c:/games/foo' });
    st();
    const lines = [];
    const o = { p, cfg: loadConfig(p), now: () => clock.t, sleep: async (ms) => { clock.t += ms; st(); }, out: (l) => lines.push(l) };
    expect(await waitFor({ ...o, command: 'ffmpeg -i a.mp4 b.mkv', timeoutMs: 20000, pollMs: 5000 })).toBe(2);
    expect(lines[lines.length - 1]).toMatch(/^timeout after 20s/);
    expect(await waitFor({ ...o, command: 'npm test', timeoutMs: 20000 })).toBe(0); // npm test loads no GPU
    expect(await waitFor({ ...o, id: 'nope' })).toBe(1);
    expect([parseDuration('15m'), parseDuration('90'), parseDuration('1h')]).toEqual([900000, 90000, 3600000]);
    expect(parseDuration('x')).toBeNaN();
  });
});

describe('governor report', () => {
  it('F: aggregates runs, priority/over minutes, throttles, releases, defers, disk users and errors', () => {
    fs.mkdirSync(p.logs, { recursive: true });
    const now = Date.parse('2026-10-08T12:00:00Z');
    const l = (ts, ev, f = {}) => JSON.stringify({ ts, src: 'watcher', ev, ...f });
    fs.writeFileSync(path.join(p.logs, 'run-2026-10-08T10-00-00-000Z-1.jsonl'), [
      l('2026-10-08T10:00:00.000Z', 'start', { version: '0.251.0' }),
      l('2026-10-08T10:01:00.000Z', 'summary', { priority: ['c:/program files/git'], over: ['disk'], diskTop: ['msedge.exe:foreign:1854ops/6MB', 'msedge.exe:foreign:1251ops/6MB'] }),
      l('2026-10-08T10:02:00.000Z', 'summary', { priority: ['c:/program files/git'], over: ['disk', 'ram'], diskTop: [] }),
      l('2026-10-08T10:03:00.000Z', 'throttle', { name: 'node.exe', resources: ['cpu'], level: 1 }),
      l('2026-10-08T10:04:00.000Z', 'release', { reason: 'relief' }),
      l('2026-10-08T10:05:00.000Z', 'tick-error', { level: 'error', error: 'x', repeated: 3 }),
      l('2026-10-08T10:06:00.000Z', 'stop', { why: 'no session and no Claude job left' }),
      l('2026-10-06T10:06:00.000Z', 'release', { reason: 'too-old' }),
      'garbage',
    ].join('\n'));
    fs.writeFileSync(path.join(p.logs, 'hooks.jsonl'), `${l('2026-10-08T11:00:00.000Z', 'queue-defer', { kind: 'npm ci', reason: 'budget:disk' })}\n`);
    const out = L.report(p.logs, { hours: 24, now }).join('\n');
    expect(out).toMatch(/runs: 1\n.*v0\.251\.0 +→ no session/);
    expect(out).toMatch(/2 min {2}c:\/program files\/git/);
    expect(out).toMatch(/2 min {2}disk/);
    expect(out).toMatch(/1 min {2}msedge\.exe \(foreign\)/);
    expect(out).toMatch(/releases: 1\n +1 {2}relief/);
    expect(out).toMatch(/gate defers: 1\n +1 {2}npm ci — budget:disk/);
    expect(out).toMatch(/errors: 3/);
    expect(out).not.toMatch(/too-old/);
  });
});
