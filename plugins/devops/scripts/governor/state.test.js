const fs = require('fs');
const os = require('os');
const path = require('path');
const St = require('./state');
const Q = require('./queue');
const { derive } = require('./sample');
const L = require('./libraries');
const { paths, loadConfig, DEFAULTS, merge } = require('./config');

let dir;
let p;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-')); p = paths(dir); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('state file', () => {
  it('writes atomically and reads back with the format version', () => {
    St.writeState(p, { heartbeat: 1, throttles: [{ jobId: 'a' }] });
    const s = St.readState(p);
    expect(s.format).toBe(St.FORMAT);
    expect(s.newer).toBe(false);
    expect(s.throttles[0].jobId).toBe('a');
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('flags a state written by a newer format', () => {
    St.writeJson(p.state, { format: St.FORMAT + 1 });
    expect(St.readState(p).newer).toBe(true);
  });
  it('broken or missing files read as fallback', () => {
    fs.writeFileSync(p.state, '{nope');
    expect(St.readState(p)).toBe(null);
    expect(St.readJson(path.join(dir, 'missing.json'), { x: 1 })).toEqual({ x: 1 });
  });
  it('config: defaults, deep merge, broken file ignored, wrong types ignored', () => {
    expect(loadConfig(p).enabled).toBe(true);
    fs.writeFileSync(p.config, JSON.stringify({ enabled: false, budget: { highPct: 90 }, tickMs: 'fast' }));
    const c = loadConfig(p);
    expect(c.enabled).toBe(false);
    expect(c.budget.highPct).toBe(90);
    expect(c.budget.lowPct).toBe(65);
    expect(c.tickMs).toBe(DEFAULTS.tickMs);
    fs.writeFileSync(p.config, '{{');
    expect(loadConfig(p).enabled).toBe(true);
  });
});

describe('singleton lock (takeover only on a dead holder)', () => {
  it('first starter wins, second backs off while the first lives', () => {
    expect(St.acquireLock(p, { pid: 1, version: '1.0.0', now: 0, alive: () => true }).ok).toBe(true);
    const r = St.acquireLock(p, { pid: 2, version: '1.0.0', now: 5000, alive: () => true });
    expect(r.ok).toBe(false);
    expect(r.handover).toBeFalsy();
  });
  it('a stale heartbeat on a LIVE holder is NOT a takeover (R6)', () => {
    St.acquireLock(p, { pid: 1, version: '1.0.0', now: 0, alive: () => true });
    expect(St.acquireLock(p, { pid: 2, version: '1.0.0', now: 10 * 60000, alive: () => true }).ok).toBe(false);
  });
  it('a dead holder is taken over', () => {
    St.writeJson(p.lock, { pid: 1, version: '1.0.0', startMs: 500, heartbeat: 0 });
    expect(St.acquireLock(p, { pid: 2, version: '1.0.0', now: 1000, alive: (pid) => pid === 2 })).toMatchObject({ ok: true, takeover: true });
    expect(St.readJson(p.lock).pid).toBe(2);
  });
  it('a reused pid (alive but different start time) is taken over', () => {
    St.writeJson(p.lock, { pid: 7, version: '1.0.0', startMs: 500, heartbeat: 0 });
    const reused = St.acquireLock(p, { pid: 8, version: '1.0.0', now: 3000, alive: () => true, startOf: (pid) => (pid === 7 ? 999999 : 0) });
    expect(reused.ok).toBe(true);
    expect(St.readJson(p.lock).pid).toBe(8);
  });
  it('R1: an unknown start time (startOf → 0, win32) never evicts a live holder', () => {
    St.writeJson(p.lock, { pid: 7, version: '1.0.0', startMs: 500, heartbeat: 0 });
    expect(St.acquireLock(p, { pid: 8, version: '1.0.0', now: 3000, alive: () => true, startOf: () => 0 }).ok).toBe(false);
    expect(St.readJson(p.lock).pid).toBe(7);
    expect(St.processStart(-1)).toBe(0);
  });
  it('a newer version asks the live holder to hand over; an older one never evicts', () => {
    St.acquireLock(p, { pid: 1, version: '0.246.0', now: 0, startMs: 1, alive: () => true });
    const r = St.acquireLock(p, { pid: 2, version: '0.247.0', now: 1000, alive: () => true, startOf: () => 1 });
    expect(r).toMatchObject({ ok: false, handover: true });
    expect(St.handoverRequested(p, '0.246.0', 2000)).toBe(true);
    expect(St.handoverRequested(p, '0.247.0', 2000)).toBe(false);
    St.acquireLock(p, { pid: 3, version: '2.0.0', now: 3000, startMs: 1, alive: () => true });
    expect(St.acquireLock(p, { pid: 4, version: '1.9.9', now: 4000, alive: () => true, startOf: () => 1 }).ok).toBe(false);
  });
  it('heartbeat and release only touch our own lock', () => {
    St.acquireLock(p, { pid: 1, version: '1', now: 0, alive: () => true });
    expect(St.heartbeat(p, 2, '1', 100)).toBe(false);
    expect(St.heartbeat(p, 1, '1', 100)).toBe(true);
    St.releaseLock(p, 2);
    expect(fs.existsSync(p.lock)).toBe(true);
    St.releaseLock(p, 1);
    expect(fs.existsSync(p.lock)).toBe(false);
  });
  it('compareVersions', () => {
    expect(St.compareVersions('0.247.0', '0.246.9')).toBe(1);
    expect(St.compareVersions('1.0.0', '1.0')).toBe(0);
    expect(St.compareVersions(undefined, '0.0.1')).toBe(-1);
  });
});

describe('queue (record only, no execution)', () => {
  const cfg = merge(DEFAULTS, {});
  it('expires after 24 h; starvation after 30 min once (not once ready)', () => {
    const a = Q.newEntry({ command: 'a', cwd: '/', now: 1000 });
    expect(Q.isExpired(a, 1000 + 24 * 3600000, cfg)).toBe(true);
    expect(Q.starving(a, 1000 + 29 * 60000, cfg)).toBe(false);
    expect(Q.starving(a, 1000 + 31 * 60000, cfg)).toBe(true);
    expect(Q.starving({ ...a, starvationNotified: true }, 1000 + 31 * 60000, cfg)).toBe(false);
    expect(Q.starving(Q.markReady(a, 2000), 1000 + 31 * 60000, cfg)).toBe(false);
  });
  it('markReady, and readyFor filters by status, expiry and repo (cwd)', () => {
    const r = Q.markReady(Q.newEntry({ command: 'npm test', cwd: '/repo', branch: 'f', head: 'abc', now: 1000 }), 2000);
    expect(r.status).toBe('ready');
    const other = Q.markReady(Q.newEntry({ command: 'x', cwd: '/elsewhere', now: 1000 }), 2000);
    const queued = Q.newEntry({ command: 'y', cwd: '/repo', now: 1000 });
    const got = Q.readyFor([r, other, queued], 3000, cfg, { cwd: '/repo' });
    expect(got.map((e) => e.command)).toEqual(['npm test']);
    expect(Q.readyFor([r], 1000 + 25 * 3600000, cfg, { cwd: '/repo' })).toEqual([]);
    expect(Q.readyFor([Q.markReady(Q.newEntry({ command: 'z', cwd: null, now: 1000 }), 2000)], 3000, cfg, { cwd: '/repo' }).length).toBe(1);
  });
  it('R10: prefers the deferring session; others in the repo only once it is gone; dedupe by command+cwd', () => {
    const mine = Q.markReady(Q.newEntry({ command: 'npm test', cwd: '/repo', sessionId: 'A', now: 1 }), 2);
    const dupe = Q.markReady(Q.newEntry({ command: 'npm test', cwd: '/repo', sessionId: 'A', now: 3 }), 4);
    expect(Q.readyFor([mine, dupe], 10, cfg, { cwd: '/repo', sessionId: 'A' }).length).toBe(1);
    expect(Q.readyFor([mine], 10, cfg, { cwd: '/repo', sessionId: 'B', liveSessions: new Set(['A']) })).toEqual([]);
    expect(Q.readyFor([mine], 10, cfg, { cwd: '/repo', sessionId: 'B', liveSessions: new Set() }).length).toBe(1);
  });
  it('record() reuses an existing command+cwd entry instead of duplicating', () => {
    const a = Q.record(p.queue, Q.newEntry({ command: 'npm test', cwd: '/r', now: 1 }), 2, cfg);
    Q.save(p.queue, Q.markReady(a, 3));
    const b = Q.record(p.queue, Q.newEntry({ command: 'npm test', cwd: '/r', now: 4 }), 5, cfg);
    expect(b.id).toBe(a.id);
    expect(Q.list(p.queue).length).toBe(1);
    expect(Q.list(p.queue)[0].status).toBe('queued');
  });
  it('persists entries as files', () => {
    const e = Q.newEntry({ command: 'npm test', cwd: dir, now: 5 });
    Q.save(p.queue, e);
    expect(Q.list(p.queue).map((x) => x.id)).toEqual([e.id]);
    Q.remove(p.queue, e.id);
    expect(Q.list(p.queue)).toEqual([]);
  });
});

describe('24 h review: atomic writer, sweep, cheap sampling', () => {
  it('G: a failed atomic write leaves no tmp file behind', () => {
    const target = path.join(dir, 'x.json');
    fs.mkdirSync(path.join(target, 'sub'), { recursive: true }); // a directory where the file should go: rename fails
    expect(() => St.writeJson(target, { a: 1 })).toThrow();
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('G: sweep removes dead sessions and expired queue entries, keeps live sessions and waiting entries', () => {
    const now = Date.now();
    fs.mkdirSync(p.sessions, { recursive: true });
    fs.mkdirSync(p.queue, { recursive: true });
    fs.writeFileSync(path.join(p.sessions, 'live.json'), JSON.stringify({ claudePid: 4242, startedAt: 0 }));
    fs.writeFileSync(path.join(p.sessions, 'dead.json'), JSON.stringify({ claudePid: 999999, startedAt: 0 }));
    fs.writeFileSync(path.join(p.queue, 'q1.json'), JSON.stringify({ id: 'q1', created_at: now - 2 * 3600000 }));
    fs.writeFileSync(path.join(p.queue, 'q2.json'), JSON.stringify({ id: 'q2', created_at: now - 25 * 3600000 }));
    expect(St.sweep(p, now, { alive: (pid) => pid === 4242 })).toMatchObject({ sessions: 1, queue: 1, total: 2 });
    expect(fs.readdirSync(p.sessions)).toEqual(['live.json']);
    expect(fs.readdirSync(p.queue)).toEqual(['q1.json']);
  });
  it('D: a snapshot without a process list keeps the last list and rates; the next full scan spans both', () => {
    const a = { ts: 0, cores: 1, procs: [{ pid: 1, startMs: 0, cpuMs: 0 }], sys: { pagesIn: 0 } };
    const b = { ts: 3000, cores: 1, procs: [{ pid: 1, startMs: 0, cpuMs: 1500 }], sys: { pagesIn: 0 } };
    const c = { ts: 6000, cores: 1, procs: null, sys: { pagesIn: 600 } };
    const d = { ts: 9000, cores: 1, procs: [{ pid: 1, startMs: 0, cpuMs: 3000 }], sys: { pagesIn: 600 } };
    const db = derive(derive(null, a), b);
    expect(db.procs[0].cpuPct).toBe(50);
    const dc = derive(db, c);
    expect([dc.procs[0].cpuPct, dc.sys.pagesPerSec, dc.freshProcs]).toEqual([50, 200, false]);
    expect(derive(dc, d).procs[0].cpuPct).toBeCloseTo(25, 5); // 1500 ms CPU over the 6 s since the last full scan
  });
});

describe('sample.derive', () => {
  it('computes machine CPU %, IO rate, disk latency and paging from counters', () => {
    const a = { ts: 0, cores: 4, procs: [{ pid: 1, startMs: 10, cpuMs: 0, ioBytes: 0 }], sys: { disk: { num: 0, base: 0, freq: 1e7 }, pagesIn: 0 } };
    const b = { ts: 1000, cores: 4, procs: [{ pid: 1, startMs: 10, cpuMs: 2000, ioBytes: 5e6 }, { pid: 2, startMs: 900, cpuMs: 500 }], sys: { disk: { num: 1e5, base: 10, freq: 1e7 }, pagesIn: 3000 } };
    const d = derive(derive(null, a), b);
    expect(d.procs[0].cpuPct).toBe(50);
    expect(d.procs[0].ioBps).toBe(5e6);
    expect(d.procs[1].cpuPct).toBe(0);
    expect(d.sys.diskMs).toBeCloseTo(1, 5);
    expect(d.sys.pagesPerSec).toBe(3000);
  });
  it('disk active time = busiest physical disk; IO operations per second per process', () => {
    const a = { ts: 0, cores: 1, procs: [{ pid: 1, startMs: 0, cpuMs: 0, ioOps: 100 }], sys: { disks: [{ name: '0 C:', idle: 0, ts: 0 }, { name: '1 D:', idle: 0, ts: 0 }] } };
    const b = { ts: 1000, cores: 1, procs: [{ pid: 1, startMs: 0, cpuMs: 0, ioOps: 700 }], sys: { disks: [{ name: '0 C:', idle: 8e6, ts: 1e7 }, { name: '1 D:', idle: 1e6, ts: 1e7 }] } };
    const d = derive(derive(null, a), b);
    expect(d.sys.diskBusyPct).toBeCloseTo(90, 5);
    expect(d.procs[0].iops).toBe(600);
    expect(derive(null, b).sys.diskBusyPct).toBeNaN();
    const gone = derive(derive(null, a), { ...b, sys: { disks: [{ name: '2 E:', idle: 0, ts: 1e7 }] } });
    expect(gone.sys.diskBusyPct).toBeNaN();
  });
  it('a reused pid gets no rate; Linux disk ticks', () => {
    const a = { ts: 0, cores: 1, procs: [{ pid: 1, startMs: 0, cpuMs: 0 }], sys: { disk: { ticksMs: 0, ios: 0 } } };
    const b = { ts: 1000, cores: 1, procs: [{ pid: 1, startMs: 999999, cpuMs: 900 }], sys: { disk: { ticksMs: 40, ios: 20 } } };
    const d = derive(derive(null, a), b);
    expect(d.procs[0].cpuPct).toBe(0);
    expect(d.sys.diskMs).toBe(2);
  });
});

describe('libraries', () => {
  it('parses Steam libraryfolders.vdf', () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
    expect(L.parseVdfPaths(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  });
  it('parses reg query values', () => {
    const out = '\r\nHKEY_CURRENT_USER\\System\\GameConfigStore\\Children\\abc\r\n    MatchedExeFullPath    REG_SZ    D:\\Games\\X\\x.exe\r\n\r\nEnd of search: 1 match(es) found.\r\n';
    expect(L.parseRegValues(out, 'MatchedExeFullPath')).toEqual(['D:\\Games\\X\\x.exe']);
    expect(L.parseRegValues(out, 'Install Dir')).toEqual([]);
  });
  it('windowsLibraries tolerates a failing reg', () => {
    const l = L.windowsLibraries(() => { throw new Error('no reg'); });
    expect(l.roots.some((r) => /XboxGames/.test(r))).toBe(true);
    expect(l.exes).toEqual([]);
  });
});
