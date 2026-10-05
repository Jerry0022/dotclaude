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

describe('singleton lock', () => {
  const alive = (set) => (pid) => set.has(pid);
  it('first starter wins, second backs off while the first heartbeats', () => {
    expect(St.acquireLock(p, { pid: 1, version: '1.0.0', now: 0, alive: alive(new Set([1])) }).ok).toBe(true);
    const r = St.acquireLock(p, { pid: 2, version: '1.0.0', now: 5000, alive: alive(new Set([1, 2])) });
    expect(r.ok).toBe(false);
    expect(r.handover).toBeFalsy();
  });
  it('dead holder or stale heartbeat → takeover', () => {
    St.acquireLock(p, { pid: 1, version: '1.0.0', now: 0, alive: () => true });
    const dead = St.acquireLock(p, { pid: 2, version: '1.0.0', now: 1000, alive: (pid) => pid === 2 });
    expect(dead).toMatchObject({ ok: true, takeover: true });
    const stale = St.acquireLock(p, { pid: 3, version: '1.0.0', now: 60000, alive: () => true });
    expect(stale.ok).toBe(true);
    expect(St.readJson(p.lock).pid).toBe(3);
    expect(St.heartbeat(p, 2, '1.0.0', 61000)).toBe(false);
    expect(St.heartbeat(p, 3, '1.0.0', 61000)).toBe(true);
  });
  it('a newer version asks the live holder to hand over', () => {
    St.acquireLock(p, { pid: 1, version: '0.246.0', now: 0, alive: () => true });
    const r = St.acquireLock(p, { pid: 2, version: '0.247.0', now: 1000, alive: () => true });
    expect(r).toMatchObject({ ok: false, handover: true });
    expect(St.handoverRequested(p, '0.246.0', 2000)).toBe(true);
    expect(St.handoverRequested(p, '0.247.0', 2000)).toBe(false);
    St.releaseLock(p, 1);
    expect(St.acquireLock(p, { pid: 2, version: '0.247.0', now: 3000, alive: () => true }).ok).toBe(true);
  });
  it('an older version never takes over a live newer holder', () => {
    St.acquireLock(p, { pid: 1, version: '2.0.0', now: 0, alive: () => true });
    expect(St.acquireLock(p, { pid: 2, version: '1.9.9', now: 1000, alive: () => true })).toMatchObject({ ok: false });
    expect(fs.existsSync(p.handover)).toBe(false);
  });
  it('release only removes our own lock', () => {
    St.acquireLock(p, { pid: 1, version: '1', now: 0, alive: () => true });
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
  it('withDirLock runs fn and cleans up, even when a stale lock dir exists', () => {
    const d = path.join(dir, 'reservations');
    fs.mkdirSync(`${d}.lock`, { recursive: true });
    const old = (Date.now() - 10000) / 1000;
    fs.utimesSync(`${d}.lock`, old, old);
    expect(St.withDirLock(d, () => 42)).toBe(42);
    expect(fs.existsSync(`${d}.lock`)).toBe(false);
  });
});

describe('queue', () => {
  const cfg = merge(DEFAULTS, {});
  it('drift check: worktree gone, branch changed, HEAD moved', () => {
    const e = Q.newEntry({ command: 'npm test', cwd: '/x', branch: 'feat', head: 'abc123', now: 0 });
    expect(Q.driftCheck(e, { exists: true, branch: 'feat', head: 'abc123' })).toEqual({ ok: true });
    expect(Q.driftCheck(e, { exists: false })).toMatchObject({ ok: false, reason: 'worktree-gone' });
    expect(Q.driftCheck(e, { exists: true, branch: 'main', head: 'abc123' }).reason).toMatch(/^branch-changed/);
    expect(Q.driftCheck(e, { exists: true, branch: 'feat', head: 'def456' }).reason).toMatch(/^head-moved/);
    expect(Q.driftCheck(Q.newEntry({ command: 'x', cwd: '/y', now: 0 }), { exists: true, branch: 'a', head: 'b' }).ok).toBe(true);
  });
  it('expires after 24 h, FIFO, starvation after 30 min once', () => {
    const a = Q.newEntry({ command: 'a', cwd: '/', now: 1000 });
    const b = Q.newEntry({ command: 'b', cwd: '/', now: 2000 });
    expect(Q.pickNext([b, a], 3000, cfg).command).toBe('a');
    expect(Q.isExpired(a, 1000 + 24 * 3600000, cfg)).toBe(true);
    expect(Q.pickNext([a, b], 1500 + 24 * 3600000, cfg).command).toBe('b');
    expect(Q.starving(a, 1000 + 29 * 60000, cfg)).toBe(false);
    expect(Q.starving(a, 1000 + 31 * 60000, cfg)).toBe(true);
    expect(Q.starving({ ...a, starvationNotified: true }, 1000 + 31 * 60000, cfg)).toBe(false);
  });
  it('persists entries as files', () => {
    const e = Q.newEntry({ command: 'npm test', cwd: dir, now: 5 });
    Q.save(p.queue, e);
    expect(Q.list(p.queue).map((x) => x.id)).toEqual([e.id]);
    Q.remove(p.queue, e.id);
    expect(Q.list(p.queue)).toEqual([]);
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
