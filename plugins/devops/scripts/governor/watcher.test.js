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

  it('attaches each live session once and resolves its claude pid', async () => {
    const clock = { t: 0 };
    S.writeJson(path.join(p.sessions, 's1.json'), { sessionId: 's1', hookPid: process.pid, hookPpid: 150, startedAt: 0 });
    const procs = [claudeProc(), { pid: 150, ppid: 100, name: 'bash.exe', path: 'x', cmd: '', startMs: 10, cpuPct: 0 }];
    const adapter = createFakeAdapter({ samples: [sample(0, procs)] });
    const w = mkWatcher(adapter, clock);
    await w.init(null);
    await w.tick();
    clock.t = 3000; adapter.samples = [sample(3000, procs)]; await w.tick();
    expect(adapter.calls.filter((c) => c[0] === 'attach').length).toBe(1);
    expect(adapter.calls.find((c) => c[0] === 'attach')[2]).toEqual([100]);
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
