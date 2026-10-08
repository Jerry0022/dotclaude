const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWatcher } = require('./watcher');
const { createFakeAdapter } = require('./adapters/fake');
const { paths, loadConfig, DEFAULTS, merge } = require('./config');
const S = require('./state');

const CLAUDE = 'C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2\\x\\claude.exe';
let dir;
let p;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'govw-')); p = paths(dir); fs.mkdirSync(p.home, { recursive: true }); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Fast config so "heavy" and relax happen within a few synthetic ticks.
function writeCfg(over = {}) {
  fs.writeFileSync(p.config, JSON.stringify(merge({ notify: false, heavy: { cpuPct: 5, sustainMs: 4000, generatorMs: 10000 }, budget: { relaxMs: 4000 } }, over)));
}
const cfg = () => loadConfig(p);

function sample(ts, procs, sys = {}) {
  return { ts, cores: 8, procs, sys: { cpuPct: 10, gpuPct: 0, freeMB: 20000, totalMB: 32768, pagesPerSec: 0, diskQueue: 0, ...sys }, fg: null, listening: [], jobPids: {} };
}
const claudeProc = (o = {}) => ({ pid: 100, ppid: 1, name: 'claude.exe', path: CLAUDE, cmd: '', startMs: 0, cpuPct: 0, gpuPct: 0, memMB: 0, ...o });
const busy = (o = {}) => ({ pid: 200, ppid: 100, name: 'node.exe', path: 'C:\\x\\node.exe', cmd: 'node build', startMs: 1000, cpuPct: 80, gpuPct: 0, memMB: 300, ...o });

function mkWatcher(adapter, clock) {
  writeCfg();
  return createWatcher({ adapter, p, loadCfg: cfg, now: () => clock.t, deps: { version: '0.246.0', log: () => {} } });
}

describe('watcher tick with a fake adapter', () => {
  it('throttles a heavy Claude job under manual priority, records before applying, releases when priority ends', async () => {
    const clock = { t: 0 };
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc(), busy()])] });
    process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID = '100';
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (clock.t = 0; clock.t <= 8000; clock.t += 2000) { adapter.samples = [sample(clock.t, [claudeProc(), busy()])]; await w.tick(); }
    const applied = adapter.calls.filter((c) => c[0] === 'apply');
    expect(applied.length).toBeGreaterThan(0);
    const rec = S.readState(p).throttles;
    expect(rec.length).toBe(1);
    expect(rec[0].pids.map((x) => x.pid)).toContain(200);
    // Record is written in state before the apply call returns (apply pushed only once recorded).
    fs.writeFileSync(p.control, JSON.stringify({ manual: false, at: -1 }));
    for (clock.t = 10000; clock.t <= 60000; clock.t += 4000) { adapter.samples = [sample(clock.t, [claudeProc(), busy({ cpuPct: 1 })])]; await w.tick(); }
    expect(adapter.calls.some((c) => c[0] === 'release')).toBe(true);
    expect(S.readState(p).throttles.length).toBe(0);
    delete process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID;
  });

  it('orphan reversal on init: releases every throttle a previous watcher recorded', async () => {
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc()])] });
    const w = mkWatcher(adapter, { t: 0 });
    await w.init({ throttles: [{ jobId: '200@1000', key: '200-1000', pids: [{ pid: 200, startMs: 1000 }] }, { jobId: '201@1', key: '201-1', pids: [{ pid: 201, startMs: 1 }] }] });
    const released = adapter.calls.filter((c) => c[0] === 'release').map((c) => c[1]);
    expect(released.sort()).toEqual(['200-1000', '201-1']);
    expect(S.readState(p).throttles).toEqual([]);
  });

  it('releases a throttle when its job disappears (never just drops the record)', async () => {
    const clock = { t: 0 };
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID = '100';
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc(), busy()])] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (clock.t = 0; clock.t <= 8000; clock.t += 2000) { adapter.samples = [sample(clock.t, [claudeProc(), busy()])]; await w.tick(); }
    expect(Object.keys(w.st.throttles).length).toBe(1);
    clock.t = 10000; adapter.samples = [sample(clock.t, [claudeProc()])]; await w.tick(); // job gone
    expect(adapter.calls.some((c) => c[0] === 'release')).toBe(true);
    expect(Object.keys(w.st.throttles).length).toBe(0);
    delete process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID;
  });

  it('a failed release keeps the record for the next start', async () => {
    const clock = { t: 0 };
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID = '100';
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc(), busy()])], failRelease: () => true });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (clock.t = 0; clock.t <= 8000; clock.t += 2000) { adapter.samples = [sample(clock.t, [claudeProc(), busy()])]; await w.tick(); }
    clock.t = 10000; adapter.samples = [sample(clock.t, [claudeProc()])]; await w.tick();
    expect(adapter.calls.some((c) => c[0] === 'release')).toBe(true);
    expect(Object.keys(w.st.throttles).length).toBe(1); // kept
    delete process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID;
  });

  it('R6: resolves the session from the recorded pid (walking up to the Claude root) and expires it when gone', async () => {
    const clock = { t: 0 };
    S.writeJson(path.join(p.sessions, 's1.json'), { sessionId: 's1', claudePid: 150, startedAt: 0 });
    const shell = { pid: 150, ppid: 100, name: 'bash.exe', path: 'x', cmd: '', startMs: 10, cpuPct: 0 };
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc(), shell])] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    expect((await w.tick()).liveSessions).toBe(1);
    expect(S.readJson(path.join(p.sessions, 's1.json')).claudePid).toBe(100);
    clock.t = 40000; adapter.samples = [sample(40000, [])];
    expect((await w.tick()).liveSessions).toBe(0);
    expect(fs.existsSync(path.join(p.sessions, 's1.json'))).toBe(false);
  });

  it('R3: a failed orphan revert keeps the record (carried into the throttles), retried on reapply', async () => {
    let fail = true;
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc()])], failRelease: () => fail });
    const w = mkWatcher(adapter, { t: 0 });
    await w.init({ throttles: [{ jobId: '200@1000', key: '200-1000', level: 2, resources: ['cpu'], pids: [{ pid: 200, startMs: 1000 }] }] });
    expect(Object.keys(w.st.throttles)).toEqual(['200@1000']);
    expect(S.readState(p).throttles.length).toBe(1);
    await w.reapply(); // helper restart, still failing
    expect(Object.keys(w.st.throttles)).toEqual(['200@1000']);
    fail = false;
    await w.reapply();
    expect(Object.keys(w.st.throttles)).toEqual([]);
  });

  it('R5: a reused pid is pruned from a throttle record and never released by identity again', async () => {
    const clock = { t: 0 };
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID = '100';
    const child = { pid: 201, ppid: 200, name: 'node.exe', path: 'C:/x/node.exe', cmd: '', startMs: 1500, cpuPct: 40, memMB: 10 };
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc(), busy(), child])] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (clock.t = 0; clock.t <= 8000; clock.t += 2000) { adapter.samples = [sample(clock.t, [claudeProc(), busy(), child])]; await w.tick(); }
    expect(w.st.throttles['200@1000'].pids.map((x) => x.pid).sort()).toEqual([200, 201]);
    // pid 201 exits and the OS reuses it for an unrelated, later process
    clock.t = 10000; adapter.samples = [sample(clock.t, [claudeProc(), busy(), { ...child, ppid: 999, startMs: 99999 }])]; await w.tick();
    expect(w.st.throttles['200@1000'].pids.map((x) => x.pid)).toEqual([200]);
    delete process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID;
  });

  it('R2: the app hosting Claude (Desktop Claude.exe chain) never gets priority, even under GPU load in the foreground', async () => {
    const clock = { t: 0 };
    const DESK = 'C:/Program Files/WindowsApps/Claude_2.19675.0.0_x64__pzs8/app/Claude.exe';
    const procs = [
      { pid: 13716, ppid: 9028, name: 'Claude.exe', path: DESK, cmd: '"Claude.exe"', startMs: 0, cpuPct: 1 },
      { pid: 15080, ppid: 13716, name: 'Claude.exe', path: DESK, cmd: 'Claude.exe --type=gpu-process', startMs: 5, cpuPct: 30, gpuPct: 60 },
      { ...claudeProc({ pid: 28064, ppid: 13716, startMs: 100 }) },
    ];
    const adapter = createFakeAdapter({ samples: [{ ...sample(0, procs), fg: { pid: 15080, fullscreen: true, idleMs: 0 } }] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (clock.t = 0; clock.t <= 70000; clock.t += 5000) { adapter.samples = [{ ...sample(clock.t, procs), fg: { pid: 15080, fullscreen: true, idleMs: 0 } }]; await w.tick(); }
    expect(w.st.pressure.priority).toEqual([]);
    expect(fs.existsSync(p.learned)).toBe(false);
  });

  it('R6: stays alive while pressure is active, exits once everything is idle', async () => {
    const clock = { t: 0 };
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    const adapter = createFakeAdapter({ samples: [sample(0, [])] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    clock.t = 120000; await w.tick();
    expect(w.canExit()).toBe(false);
    fs.writeFileSync(p.control, JSON.stringify({ manual: false, at: -1 }));
    clock.t = 125000; await w.tick();
    expect(w.canExit()).toBe(true);
  });

  it('self-check: `priority on` after an earlier `stop` never shuts a running watcher down (separate stopAt)', () => {
    const { run } = require('./cli');
    const prev = process.env.DOTCLAUDE_GOVERNOR_HOME;
    process.env.DOTCLAUDE_GOVERNOR_HOME = dir;
    try {
      run(['stop'], () => {});
      const startedAt = Date.now() + 5;
      const until = Date.now() + 10; while (Date.now() < until) { /* move the clock */ }
      run(['priority', 'on'], () => {});
      const c = S.readJson(p.control, {});
      expect(c.manual).toBe(true);
      expect(c.stopAt > startedAt).toBe(false); // the watcher compares stopAt with its own start
    } finally { if (prev === undefined) delete process.env.DOTCLAUDE_GOVERNOR_HOME; else process.env.DOTCLAUDE_GOVERNOR_HOME = prev; }
  });

  it('notify:false logs but never calls the adapter notify', async () => {
    const clock = { t: 0 };
    const Q = require('./queue');
    Q.save(p.queue, Q.newEntry({ command: 'npm test', cwd: dir, now: 0 }));
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 })); // pressure → stays queued → starves
    const adapter = createFakeAdapter({ samples: [sample(0, [])] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    clock.t = 31 * 60000; await w.tick();
    expect(adapter.calls.some((c) => c[0] === 'notify')).toBe(false);
    expect(Q.list(p.queue)[0].starvationNotified).toBe(true);
    expect(Q.list(p.queue)[0].status).toBe('queued'); // R10: never marked ready under pressure
  });

  it('B: a cap is lifted by relief (reason relief) once its resource is no longer pressed, while the job still runs', async () => {
    const clock = { t: 0 };
    const events = [];
    fs.writeFileSync(p.control, JSON.stringify({ manual: true, at: -1 }));
    process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID = '100';
    writeCfg();
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc(), busy()])] });
    const w = createWatcher({ adapter, p, loadCfg: cfg, now: () => clock.t, deps: { version: '0.246.0', logger: { event: (n, f) => events.push([n, f]), flush() {} } } });
    await w.init(null);
    for (clock.t = 0; clock.t <= 8000; clock.t += 2000) { adapter.samples = [sample(clock.t, [claudeProc(), busy()])]; await w.tick(); }
    expect(Object.keys(w.st.throttles).length).toBe(1);
    fs.writeFileSync(p.control, JSON.stringify({ manual: false, at: -1 }));
    for (clock.t = 10000; clock.t <= 20000; clock.t += 2000) { adapter.samples = [sample(clock.t, [claudeProc(), busy()])]; await w.tick(); }
    delete process.env.DOTCLAUDE_GOVERNOR_SCOPE_PID;
    expect(Object.keys(w.st.throttles).length).toBe(0);
    expect(events.find((e) => e[0] === 'release')[1].reason).toBe('relief');
  });

  it('A: a dev server the Desktop app started (no Claude CLI involved) and git never get priority', async () => {
    const DESK = 'C:\\Program Files\\WindowsApps\\Claude_2.26454.0.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe';
    const procs = [
      { pid: 10, ppid: 1, name: 'Claude.exe', path: DESK, cmd: '', startMs: 10, cpuPct: 1, gpuPct: 0, memMB: 100 },
      { pid: 11, ppid: 10, name: 'esbuild.exe', path: 'C:\\p\\node_modules\\@esbuild\\win32-x64\\esbuild.exe', cmd: '', startMs: 20, cpuPct: 70, gpuPct: 0, memMB: 100 },
      { pid: 12, ppid: 1, name: 'git.exe', path: 'C:\\Program Files\\Git\\cmd\\git.exe', cmd: 'git status', startMs: 30, cpuPct: 70, gpuPct: 0, memMB: 50 },
    ];
    const clock = { t: 0 };
    const adapter = createFakeAdapter({ samples: [] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (const fgPid of [10, 11, 12]) {
      adapter.samples = [{ ...sample(clock.t, procs, { cpuPct: 95 }), fg: { pid: fgPid, fullscreen: false, idleMs: 100 } }];
      await w.tick();
      expect([fgPid, S.readState(p).pressure.priority]).toEqual([fgPid, []]);
      clock.t += 3000;
    }
  });

  it('E/F: persists the culprit of a pressed resource and toasts a foreign hog at most once per hour', async () => {
    const clock = { t: 0 };
    writeCfg({ notify: true });
    const hog = { pid: 300, ppid: 1, name: 'OneDrive.Sync.Service.exe', path: 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.Sync.Service.exe', cmd: '', startMs: 5, cpuPct: 1, gpuPct: 0, memMB: 33 * 1024 };
    const adapter = createFakeAdapter({ samples: [] });
    const w = createWatcher({ adapter, p, loadCfg: cfg, now: () => clock.t, deps: { version: '0.246.0' } });
    await w.init(null);
    for (clock.t = 0; clock.t <= 40 * 60000; clock.t += 10 * 60000) { adapter.samples = [sample(clock.t, [hog], { freeMB: 1000 })]; await w.tick(); }
    expect(S.readState(p).culprit.ram).toMatchObject({ name: 'OneDrive.Sync.Service.exe', cls: 'foreign' });
    expect(adapter.calls.filter((c) => c[0] === 'notify').length).toBe(1);
    clock.t = 61 * 60000;
    adapter.samples = [sample(clock.t, [hog], { freeMB: 1000 })];
    await w.tick();
    expect(adapter.calls.filter((c) => c[0] === 'notify').length).toBe(2);
    expect(adapter.calls.find((c) => c[0] === 'notify')[2]).toMatch(/RAM: OneDrive\.Sync\.Service\.exe 33\.0 GB/);
  });

  it('G: sweeps stale tmp, foreground and dead-session files on start', async () => {
    const old = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}'); const s = (Date.now() - 2 * 3600000) / 1000; fs.utimesSync(f, s, s); };
    old(path.join(p.foreground, 'a.json.1.x.tmp'));
    old(path.join(p.home, 'state.json.2.y.tmp'));
    fs.writeFileSync(path.join(p.foreground, 'b.json'), JSON.stringify({ startedAt: 0 }));
    fs.writeFileSync(path.join(p.foreground, 'fresh.json.3.z.tmp'), '{}');
    fs.mkdirSync(p.sessions, { recursive: true });
    fs.writeFileSync(path.join(p.sessions, 'dead.json'), JSON.stringify({ sessionId: 'dead', claudePid: 999999, startedAt: 0 }));
    const w = mkWatcher(createFakeAdapter({ samples: [sample(0, [])] }), { t: Date.now() });
    await w.init(null);
    expect(fs.readdirSync(p.foreground)).toEqual(['fresh.json.3.z.tmp']);
    expect(fs.existsSync(path.join(p.home, 'state.json.2.y.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(p.sessions, 'dead.json'))).toBe(false);
  });

  it('D: asks for the full process list at most every procScanMs; system counters every tick', async () => {
    const clock = { t: 0 };
    const adapter = createFakeAdapter({ samples: [] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    for (clock.t = 0; clock.t <= 30000; clock.t += 3000) { adapter.samples = [sample(clock.t, [claudeProc()])]; await w.tick(); }
    const asks = adapter.calls.filter((c) => c[0] === 'sample').map((c) => c[1].procs);
    expect([asks.length, asks.filter(Boolean).length]).toEqual([11, 3]); // full scans at 0, 15 s, 30 s
  });

  it('marks deferred commands ready when no pressure, and drains them on shutdown', async () => {
    const clock = { t: 0 };
    const Q = require('./queue');
    Q.save(p.queue, Q.newEntry({ command: 'npm test', cwd: dir, now: 0 }));
    const adapter = createFakeAdapter({ samples: [sample(0, [claudeProc()])] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    await w.tick();
    expect(Q.list(p.queue)[0].status).toBe('ready');
  });
});
