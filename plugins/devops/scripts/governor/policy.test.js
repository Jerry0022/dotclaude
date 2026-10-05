const P = require('./policy');
const { DEFAULTS, merge } = require('./config');

const cfg = merge(DEFAULTS, {});
const S = 1000;
const MIN = 60 * S;

function proc(o) { return { ppid: 0, name: 'x.exe', path: null, cmd: '', startMs: 0, cpuPct: 0, gpuPct: 0, ioBps: 0, memMB: 0, ...o }; }

describe('isOsProcess', () => {
  const win = { platform: 'win32', systemRoot: 'C:\\Windows' };
  it('Windows: under SystemRoot AND Microsoft-signed', () => {
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\Windows\\System32\\svchost.exe', signer: 'CN=Microsoft Windows' }), win)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\Windows\\Temp\\evil.exe', signer: null }), win)).toBe(false);
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\Games\\x.exe', signer: 'CN=Microsoft Corporation' }), win)).toBe(false);
  });
  it('Windows: Defender counts as OS, unknown path falls back to name list', () => {
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18\\MsMpEng.exe', signer: 'CN=Microsoft Corporation' }), win)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 10, name: 'MsMpEng.exe', path: null }), win)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 10, name: 'game.exe', path: null }), win)).toBe(false);
    expect(P.isOsProcess(proc({ pid: 4, name: 'System' }), win)).toBe(true);
  });
  it('Linux: kernel threads and system.slice', () => {
    const lx = { platform: 'linux' };
    expect(P.isOsProcess(proc({ pid: 55, ppid: 2 }), lx)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 55, cgroup: '/system.slice/sshd.service' }), lx)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 55, cgroup: '/user.slice/user-1000.slice/user@1000.service/app.slice/x.scope' }), lx)).toBe(false);
  });
  it('macOS: /System AND Apple-signed', () => {
    const mac = { platform: 'darwin' };
    expect(P.isOsProcess(proc({ pid: 77, path: '/System/Library/CoreServices/WindowServer', signer: 'Apple' }), mac)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 77, path: '/System/x', signer: 'Evil Inc' }), mac)).toBe(false);
    expect(P.isOsProcess(proc({ pid: 77, path: '/Applications/Game.app/Contents/MacOS/Game' }), mac)).toBe(false);
  });
  it('unsupported platform: never OS', () => {
    expect(P.isOsProcess(proc({ pid: 1 }), { platform: 'aix' })).toBe(false);
  });
});

describe('appKey', () => {
  it('remembers games by their folder below the library root', () => {
    const roots = ['D:\\SteamLibrary\\steamapps\\common'];
    expect(P.appKey('D:\\SteamLibrary\\steamapps\\common\\Cool Game\\bin\\win64\\cool.exe', roots)).toBe('d:/steamlibrary/steamapps/common/cool game');
  });
  it('vendor folder below Program Files, LocalAppData programs, /Applications, /opt', () => {
    expect(P.appKey('C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe')).toBe('c:/program files/blender foundation');
    expect(P.appKey('C:\\Users\\a\\AppData\\Local\\Programs\\Tool\\x\\t.exe')).toBe('c:/users/a/appdata/local/programs/tool');
    expect(P.appKey('/Applications/Game.app/Contents/MacOS/Game')).toBe('/applications/game.app');
    expect(P.appKey('/opt/thing/bin/run')).toBe('/opt/thing');
    expect(P.appKey('/usr/bin/foo')).toBe('/usr/bin');
    expect(P.appKey(null)).toBe(null);
    expect(P.appLabel('/applications/game.app')).toBe('game');
  });
  it('listed matches key substrings and exact names', () => {
    expect(P.listed(['blender'], 'c:/program files/blender foundation', 'blender.exe')).toBe(true);
    expect(P.listed(['obs64.exe'], 'c:/x', 'OBS64.exe')).toBe(true);
    expect(P.listed([], 'c:/x', 'a')).toBe(false);
  });
});

describe('attribution and classification', () => {
  const procs = [
    proc({ pid: 100, ppid: 1, name: 'claude.exe', startMs: 0 }),
    proc({ pid: 101, ppid: 100, name: 'node.exe', cmd: 'node mcp-server/index.js', startMs: 1 * S }),
    proc({ pid: 102, ppid: 100, name: 'bash.exe', startMs: 100 * S }),
    proc({ pid: 103, ppid: 102, name: 'node.exe', cmd: 'node vitest', startMs: 101 * S }),
    proc({ pid: 200, ppid: 1, name: 'game.exe', path: 'D:\\Games\\g.exe', startMs: 5 * S }),
    proc({ pid: 300, ppid: 100, name: 'reused.exe', startMs: -50 * S }), // started before its "parent": pid reuse
    proc({ pid: 400, ppid: 999, name: 'orphan.exe', startMs: 200 * S }),
  ];
  it('collects claude descendants, job members and extra roots; ignores pid reuse', () => {
    const a = P.attributedPids(procs, { jobPids: [400] });
    expect([...a].sort()).toEqual([100, 101, 102, 103, 400]);
    expect(P.attributedPids(procs, { extraRoots: [200] }).has(200)).toBe(true);
  });
  it('claude, MCP servers and session-start processes are infra, never claude jobs', () => {
    const attributed = P.attributedPids(procs);
    const ctx = { attributed, sessionStarts: [0], graceMs: 20 * S, selfPids: new Set([999]) };
    expect(P.classify(procs[0], ctx)).toBe('infra');
    expect(P.classify(procs[1], ctx)).toBe('infra');
    expect(P.classify(procs[3], ctx)).toBe('claude');
    expect(P.classify(proc({ pid: 999 }), ctx)).toBe('self');
    expect(P.classify(procs[4], ctx)).toBe('foreign');
    expect(P.classify({ ...procs[4], os: true }, ctx)).toBe('os');
    expect(P.classify(proc({ pid: 104, ppid: 100, startMs: 10 * S }), { ...ctx, attributed: new Set([104]) })).toBe('infra');
  });
  it('self-loop: a driven service counts as Claude only while a request is in flight or < 60 s ago', () => {
    const services = cfg.claudeServices;
    const now = 1000 * S;
    expect(P.activeServiceNames(services, { 'local-llm': { active: true } }, now, cfg.selfLoopMs).has('ollama.exe')).toBe(true);
    expect(P.activeServiceNames(services, { 'local-llm': { active: false, endedAt: now - 30 * S } }, now, cfg.selfLoopMs).size).toBeGreaterThan(0);
    expect(P.activeServiceNames(services, { 'local-llm': { active: false, endedAt: now - 61 * S } }, now, cfg.selfLoopMs).size).toBe(0);
    expect(P.activeServiceNames(services, {}, now, cfg.selfLoopMs).size).toBe(0);
    const ctx = { attributed: new Set(), activeServices: new Set(['ollama.exe']) };
    expect(P.classify(proc({ pid: 5, name: 'Ollama.exe' }), ctx)).toBe('service');
  });
  it('groups a tool call subtree into one job with summed load', () => {
    const ps = [
      proc({ pid: 100, ppid: 1, name: 'claude.exe' }),
      proc({ pid: 102, ppid: 100, name: 'bash.exe', startMs: 100 * S }),
      proc({ pid: 103, ppid: 102, cpuPct: 20, memMB: 300, startMs: 101 * S }),
      proc({ pid: 104, ppid: 103, cpuPct: 15, gpuPct: 30, memMB: 200, startMs: 102 * S }),
    ];
    const classes = new Map([[100, 'infra'], [102, 'claude'], [103, 'claude'], [104, 'claude']]);
    const jobs = P.groupJobs(ps, classes, new Set([104]));
    expect(jobs.size).toBe(1);
    const j = [...jobs.values()][0];
    expect(j.rootPid).toBe(102);
    expect(j.cpuPct).toBe(35);
    expect(j.gpuPct).toBe(30);
    expect(j.memMB).toBe(500);
    expect(j.listening).toBe(true);
    expect(j.pids.map((p) => p.pid).sort()).toEqual([102, 103, 104]);
  });
});

describe('trackJobs: heavy is measured (20 s) and kinds', () => {
  const job = (o) => new Map([['j', { id: 'j', rootPid: 1, startMs: 0, pids: [{ pid: 1, startMs: 0 }], cpuPct: 0, gpuPct: 0, ioBps: 0, memMB: 0, listening: false, ...o }]]);
  function run(load, seconds, ctx = {}, start = {}) {
    let t = start;
    for (let s = 0; s <= seconds; s += 2) t = P.trackJobs(t, job(load), s * S, cfg, ctx);
    return t.j;
  }
  it('needs 20 s over a threshold', () => {
    expect(run({ cpuPct: 30 }, 18).heavy).toBe(false);
    expect(run({ cpuPct: 30 }, 20).heavy).toBe(true);
    expect(run({ cpuPct: 20 }, 60).heavy).toBe(false);
    expect(run({ gpuPct: 25 }, 20).heavy).toBe(true);
    expect(run({ ioBps: 50 * 1024 * 1024 }, 20).heavy).toBe(true);
    expect(run({ ioBps: 50 * 1024 * 1024 }, 20, { diskBusy: false }).heavy).toBe(false);
    expect(run({ memMB: 8000 }, 60).heavy).toBe(false);
  });
  it('a short dip does not reset the 20 s window, a long one does', () => {
    let t = {};
    for (let s = 0; s <= 10; s += 2) t = P.trackJobs(t, job({ cpuPct: 30 }), s * S, cfg);
    t = P.trackJobs(t, job({ cpuPct: 0 }), 12 * S, cfg);
    for (let s = 14; s <= 22; s += 2) t = P.trackJobs(t, job({ cpuPct: 30 }), s * S, cfg);
    expect(t.j.heavy).toBe(true);
    let u = {};
    for (let s = 0; s <= 10; s += 2) u = P.trackJobs(u, job({ cpuPct: 30 }), s * S, cfg);
    for (let s = 12; s <= 30; s += 2) u = P.trackJobs(u, job({ cpuPct: 0 }), s * S, cfg);
    for (let s = 32; s <= 44; s += 2) u = P.trackJobs(u, job({ cpuPct: 30 }), s * S, cfg);
    expect(u.j.heavy).toBe(false);
  });
  it('heavy stays sticky once reached (a capped job does not flap)', () => {
    let t = {};
    for (let s = 0; s <= 22; s += 2) t = P.trackJobs(t, job({ cpuPct: 30 }), s * S, cfg);
    t = P.trackJobs(t, job({ cpuPct: 1 }), 60 * S, cfg);
    expect(t.j.heavy).toBe(true);
  });
  it('kinds: server, foreground, generator (> 2 min heavy), build', () => {
    expect(run({ cpuPct: 30, listening: true }, 200).kind).toBe('server');
    expect(run({ cpuPct: 30 }, 200, { foreground: [{ startedAt: 0 }] }).kind).toBe('foreground');
    expect(run({ cpuPct: 30 }, 60).kind).toBe('build');
    const g = run({ cpuPct: 30 }, 150);
    expect(g.kind).toBe('generator');
    expect(P.maxLevel(g)).toBe(P.LEVEL.PAUSE);
    const gg = run({ cpuPct: 30, gpuPct: 50 }, 150);
    expect(gg.gpu).toBe(true);
    expect(P.maxLevel(gg)).toBe(P.LEVEL.CAP);
    expect(P.maxLevel(run({ cpuPct: 30, listening: true }, 200))).toBe(P.LEVEL.CAP);
    expect(P.maxLevel(run({ cpuPct: 30 }, 200, { foreground: [{ startedAt: 0 }] }))).toBe(P.LEVEL.CAP);
    expect(run({ cpuPct: 30 }, 60, { foreground: [{ startedAt: 50 * S }] }).kind).toBe('build');
  });
  it('dead jobs drop out', () => {
    const t = P.trackJobs({ old: { id: 'old' } }, job({}), 0, cfg);
    expect(Object.keys(t)).toEqual(['j']);
  });
});

describe('updatePriority', () => {
  const game = (o = {}) => proc({ pid: 50, name: 'g.exe', path: 'C:\\Games\\Foo\\g.exe', ...o });
  const ctx = (o = {}) => ({ cfg, libraryRoots: [], learned: {}, manual: false, foreground: null, ...o });
  it('gives priority only on the loaded resource', () => {
    const r = P.updatePriority({}, [game({ gpuPct: 60 })], 0, ctx());
    expect(r.active).toEqual({ gpu: 'c:/games/foo' });
    expect(r.all).toBe(false);
    const r2 = P.updatePriority({}, [game({ cpuPct: 15, memMB: 3000 })], 0, ctx());
    expect(Object.keys(r2.active).sort()).toEqual(['cpu', 'ram']);
  });
  it('no priority below the noticeable threshold', () => {
    expect(P.updatePriority({}, [game({ cpuPct: 5 })], 0, ctx()).active).toEqual({});
  });
  it('decays 10 min after the last noticeable load, also after exit', () => {
    let st = P.updatePriority({}, [game({ cpuPct: 50 })], 0, ctx());
    st = P.updatePriority(st, [game({ cpuPct: 1 })], 9 * MIN, ctx());
    expect(st.active.cpu).toBeTruthy();
    st = P.updatePriority(st, [], 9.9 * MIN, ctx());
    expect(st.active.cpu).toBeTruthy();
    st = P.updatePriority(st, [], 10.1 * MIN, ctx());
    expect(st.active).toEqual({});
    expect(st.apps).toEqual({});
  });
  it('foreground interactive app with load → yield on ALL resources', () => {
    const fg = { pid: 50, fullscreen: false, idleMs: 1000 };
    const r = P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ foreground: fg }));
    expect(r.all).toBe(true);
    expect(Object.keys(r.active).sort()).toEqual(['cpu', 'disk', 'gpu', 'ram']);
    const idle = P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ foreground: { ...fg, idleMs: 10 * MIN } }));
    expect(idle.all).toBe(false);
    const noload = P.updatePriority({}, [game({ cpuPct: 1 })], 0, ctx({ foreground: fg }));
    expect(noload.all).toBe(false);
  });
  it('game libraries and learned apps grant priority from process start', () => {
    const lib = P.updatePriority({}, [proc({ pid: 9, path: 'D:\\Lib\\steamapps\\common\\Foo\\foo.exe' })], 0, ctx({ libraryRoots: ['D:\\Lib\\steamapps\\common'] }));
    expect(Object.keys(lib.active).sort()).toEqual(['cpu', 'disk', 'gpu', 'ram']);
    const exe = P.updatePriority({}, [proc({ pid: 9, path: 'E:\\X\\x.exe' })], 0, ctx({ libraryExes: new Set(['e:\\x\\x.exe']) }));
    expect(exe.active.cpu).toBeTruthy();
    const learned = P.updatePriority({}, [game()], 0, ctx({ learned: { 'c:/games/foo': { resources: ['gpu'] } } }));
    expect(learned.active).toEqual({ gpu: 'c:/games/foo' });
    const always = P.updatePriority({}, [game()], 0, ctx({ cfg: merge(cfg, { alwaysPriority: ['c:/games/foo'] }) }));
    expect(always.active.cpu).toBeTruthy();
  });
  it('never-priority apps are ignored', () => {
    const r = P.updatePriority({}, [game({ cpuPct: 90 })], 0, ctx({ cfg: merge(cfg, { neverPriority: ['g.exe'] }) }));
    expect(r.active).toEqual({});
  });
  it('manual switch → all resources', () => {
    const r = P.updatePriority({}, [], 0, ctx({ manual: true }));
    expect(r.all).toBe(true);
    expect(r.allBy).toBe('manual');
    expect(Object.keys(r.active).length).toBe(4);
  });
  it('learns after 60 s of load, after 15 s fullscreen + 3D; only once', () => {
    let st = {};
    let learnedAt = null;
    for (let s = 0; s <= 70; s += 5) {
      st = P.updatePriority(st, [game({ cpuPct: 50 })], s * S, ctx());
      if (st.newlyLearned.length && learnedAt === null) learnedAt = s;
    }
    expect(learnedAt).toBe(60);
    let fs3d = {};
    let at = null;
    const fg = { pid: 50, fullscreen: true, idleMs: 0 };
    for (let s = 0; s <= 30; s += 5) {
      fs3d = P.updatePriority(fs3d, [game({ gpuPct: 80 })], s * S, ctx({ foreground: fg }));
      if (fs3d.newlyLearned.length && at === null) at = s;
      else if (fs3d.newlyLearned.length) throw new Error('learned twice');
    }
    expect(at).toBe(15);
    const fromLib = P.updatePriority({}, [proc({ pid: 9, cpuPct: 90, path: 'D:\\L\\Foo\\foo.exe' })], 0, ctx({ libraryRoots: ['D:\\L'] }));
    expect(fromLib.newlyLearned).toEqual([]);
  });
});

describe('updateBudget: 80/65 hysteresis, smoothing, RAM % and MB, disk latency', () => {
  const sys = (o) => ({ cpuPct: 10, gpuPct: 0, diskMs: 1, diskQueue: 0, totalMB: 32768, freeMB: 20000, pagesPerSec: 0, ...o });
  function feed(prev, o, from, to) {
    let st = prev;
    for (let s = from; s <= to; s += 2) st = P.updateBudget(st, sys(o), s * S, cfg);
    return st;
  }
  it('CPU: over at > 80 smoothed, stays over until < 65', () => {
    let st = feed({}, { cpuPct: 85 }, 0, 12);
    expect(st.over.cpu).toBe(true);
    st = feed(st, { cpuPct: 70 }, 14, 30);
    expect(st.over.cpu).toBe(true);
    st = feed(st, { cpuPct: 60 }, 32, 50);
    expect(st.over.cpu).toBe(false);
    st = feed(st, { cpuPct: 75 }, 52, 70);
    expect(st.over.cpu).toBe(false);
  });
  it('smoothing ignores a single spike', () => {
    let st = feed({}, { cpuPct: 20 }, 0, 10);
    st = P.updateBudget(st, sys({ cpuPct: 100 }), 12 * S, cfg);
    expect(st.over.cpu).toBe(false);
  });
  it('GPU max engine over 80', () => {
    expect(feed({}, { gpuPct: 90 }, 0, 12).over.gpu).toBe(true);
  });
  it('RAM: free below 15 % of total', () => {
    expect(feed({}, { totalMB: 65536, freeMB: 9000 }, 0, 12).over.ram).toBe(true); // 15 % = 9830 MB
    expect(feed({}, { totalMB: 65536, freeMB: 11000 }, 0, 12).over.ram).toBe(false);
  });
  it('RAM: free below 4096 MB even when that is > 15 %', () => {
    expect(feed({}, { totalMB: 16384, freeMB: 3500 }, 0, 12).over.ram).toBe(true); // 15 % = 2458 MB
    expect(feed({}, { totalMB: 16384, freeMB: 4500 }, 0, 12).over.ram).toBe(false);
  });
  it('RAM: heavy hard paging alone is over; hysteresis needs more free to clear', () => {
    expect(feed({}, { pagesPerSec: 5000 }, 0, 12).over.ram).toBe(true);
    let st = feed({}, { totalMB: 16384, freeMB: 3500 }, 0, 12);
    st = feed(st, { totalMB: 16384, freeMB: 4500 }, 14, 30);
    expect(st.over.ram).toBe(true);
    st = feed(st, { totalMB: 16384, freeMB: 6000 }, 32, 50);
    expect(st.over.ram).toBe(false);
  });
  it('disk: baseline from the first minute, then > 4x latency with a queue', () => {
    let st = feed({}, { diskMs: 1 }, 0, 60);
    expect(st.baseline.diskMs).toBe(1);
    st = feed(st, { diskMs: 5, diskQueue: 3 }, 62, 74);
    expect(st.over.disk).toBe(true);
    st = feed(st, { diskMs: 3.5, diskQueue: 3 }, 76, 90);
    expect(st.over.disk).toBe(true);
    st = feed(st, { diskMs: 2, diskQueue: 3 }, 92, 110);
    expect(st.over.disk).toBe(false);
    expect(feed(st, { diskMs: 10, diskQueue: 0 }, 112, 130).over.disk).toBe(false);
  });
  it('no baseline yet → disk never over', () => {
    expect(feed({}, { diskMs: 100, diskQueue: 10 }, 0, 20).over.disk).toBe(false);
  });
});

describe('plan: yield order and relaxation', () => {
  const tj = (id, heavySince, o = {}) => ({ id, heavy: true, heavySince, startMs: heavySince, res: ['cpu'], kind: 'build', gpu: false, ...o });
  it('priority: every heavy job on that resource yields at once, to its max level', () => {
    const jobs = { a: tj('a', 0), b: tj('b', 10, { kind: 'generator' }), c: tj('c', 5, { res: ['gpu'] }) };
    const { desired } = P.plan(jobs, {}, { priority: ['cpu'], over: [] }, 100 * S, cfg);
    expect(desired).toEqual({ a: { level: 1, resources: ['cpu'] }, b: { level: 2, resources: ['cpu'] } });
  });
  it('servers and foreground jobs are only capped, never paused', () => {
    const jobs = { s: tj('s', 0, { kind: 'server' }), f: tj('f', 0, { kind: 'foreground' }) };
    const { desired } = P.plan(jobs, {}, { priority: ['cpu'], over: [] }, 0, cfg);
    expect(desired.s.level).toBe(1);
    expect(desired.f.level).toBe(1);
  });
  it('non-heavy jobs never yield', () => {
    const { desired } = P.plan({ a: { ...tj('a', 0), heavy: false } }, {}, { priority: ['cpu'], over: ['cpu'] }, 0, cfg);
    expect(desired).toEqual({});
  });
  it('over budget: newest heavy job yields first, one step per escalateMs', () => {
    const jobs = { old: tj('old', 0, { kind: 'generator' }), mid: tj('mid', 10), new: tj('new', 20) };
    let r = P.plan(jobs, {}, { priority: [], over: ['cpu'] }, 100 * S, cfg);
    expect(r.desired).toEqual({ new: { level: 1, resources: ['cpu'] } });
    const again = P.plan(jobs, r.desired, { priority: [], over: ['cpu'] }, 105 * S, cfg, r.last);
    expect(again.desired).toEqual(r.desired);
    r = P.plan(jobs, r.desired, { priority: [], over: ['cpu'] }, 110 * S, cfg, r.last);
    expect(Object.keys(r.desired).sort()).toEqual(['mid', 'new']);
    r = P.plan(jobs, r.desired, { priority: [], over: ['cpu'] }, 120 * S, cfg, r.last);
    expect(r.desired.old.level).toBe(1);
    r = P.plan(jobs, r.desired, { priority: [], over: ['cpu'] }, 130 * S, cfg, r.last);
    expect(r.desired.old.level).toBe(2);
  });
  it('relaxes one step per 30 s, oldest first: the newest returns last', () => {
    const jobs = { old: tj('old', 0), new: tj('new', 20) };
    const cur = { old: { level: 1, resources: ['cpu'] }, new: { level: 1, resources: ['cpu'] } };
    let r = P.plan(jobs, cur, { priority: [], over: [] }, 100 * S, cfg, { changeAt: 90 * S });
    expect(r.desired).toEqual(cur);
    r = P.plan(jobs, cur, { priority: [], over: [] }, 120 * S, cfg, { changeAt: 90 * S });
    expect(Object.keys(r.desired)).toEqual(['new']);
    const r2 = P.plan(jobs, r.desired, { priority: [], over: [] }, 140 * S, cfg, r.last);
    expect(Object.keys(r2.desired)).toEqual(['new']);
    const r3 = P.plan(jobs, r.desired, { priority: [], over: [] }, 150 * S, cfg, r.last);
    expect(r3.desired).toEqual({});
  });
  it('keeps a throttle while its resource is still pressured; drops dead jobs', () => {
    const cur = { a: { level: 1, resources: ['gpu'] }, gone: { level: 2, resources: ['cpu'] } };
    const r = P.plan({ a: tj('a', 0, { res: ['gpu'] }) }, cur, { priority: ['gpu'], over: [] }, 500 * S, cfg, { changeAt: 0 });
    expect(r.desired).toEqual({ a: { level: 1, resources: ['gpu'] } });
  });
  it('pressureOf lists priority and over resources', () => {
    expect(P.pressureOf({ active: { gpu: 'x' } }, { over: { cpu: true, ram: false } })).toEqual({ priority: ['gpu'], over: ['cpu'] });
  });
});

describe('reversalPlan (orphan reversal)', () => {
  it('reverts entries whose pids still match, drops gone or reused pids', () => {
    const throttles = [
      { jobId: 'a', pids: [{ pid: 1, startMs: 1000 }] },
      { jobId: 'b', pids: [{ pid: 2, startMs: 1000 }] },
      { jobId: 'c', pids: [{ pid: 3, startMs: 1000 }] },
      { jobId: 'd', container: 'abc', pids: [] },
    ];
    const alive = new Map([[1, { startMs: 1500 }], [2, { startMs: 99999 }]]);
    const plan = P.reversalPlan(throttles, alive);
    expect(plan.map((x) => x.action)).toEqual(['revert', 'drop', 'drop', 'revert']);
    expect(P.reversalPlan(throttles, null).every((x) => x.action === 'revert')).toBe(true);
    expect(P.reversalPlan(undefined, null)).toEqual([]);
  });
});

describe('admission', () => {
  const now = 1000 * S;
  const st = (o = {}) => ({ heartbeat: now - S, pressure: { priority: [], over: [] }, sys: { freeMB: 20000 }, ...o });
  it('light commands pass without looking at state', () => {
    expect(P.admit({ command: 'git status', now, state: null, cfg }).decision).toBe('allow');
    expect(P.admit({ command: 'ls -la', now, state: st({ pressure: { priority: ['cpu'], over: [] } }), cfg }).decision).toBe('allow');
  });
  it('recognises heavy-looking commands', () => {
    expect(P.commandKind('cd x && npm test')).toBe('npm test');
    expect(P.commandKind('npm run build')).toBe('npm build');
    expect(P.commandKind('npx vitest run a.test.js')).toBe('vitest');
    expect(P.commandKind('cargo build --release')).toBe('cargo build');
    expect(P.commandKind('docker compose up -d')).toBe('docker');
    expect(P.commandKind('ffmpeg -i a.mp4 b.mkv')).toBe('ffmpeg');
    expect(P.commandKind('git log')).toBe(null);
  });
  it('defers heavy starts under priority or over budget', () => {
    const p = P.admit({ command: 'npm test', now, state: st({ pressure: { priority: ['gpu'], over: [] }, priorityBy: 'c:/games/foo' }), cfg });
    expect(p).toMatchObject({ decision: 'defer', reason: 'priority:c:/games/foo' });
    expect(P.admit({ command: 'npm test', now, state: st({ pressure: { priority: [], over: ['cpu'] } }), cfg }).reason).toBe('budget:cpu');
  });
  it('escape routes count as heavy only while pressure is active', () => {
    expect(P.isEscape('wsl -e make')).toBe(true);
    expect(P.isEscape('schtasks /create /tn x')).toBe(true);
    expect(P.isEscape('Start-Process foo -Verb RunAs')).toBe(true);
    expect(P.isEscape('sc create svc binPath= x')).toBe(true);
    expect(P.isEscape('systemd-run --user x')).toBe(true);
    expect(P.isEscape('echo wslconfig')).toBe(false);
    expect(P.admit({ command: 'schtasks /run /tn x', now, state: st(), cfg }).decision).toBe('allow');
    expect(P.admit({ command: 'schtasks /run /tn x', now, state: st({ pressure: { priority: ['cpu'], over: [] } }), cfg }).decision).toBe('defer');
  });
  it('reserves expected MB and defers when free < expected + 4096', () => {
    const ok = P.admit({ command: 'npm test', now, state: st({ sys: { freeMB: 6000 } }), cfg });
    expect(ok).toMatchObject({ decision: 'allow', reserve: true, expectedMB: 1024 });
    const learned = P.admit({ command: 'npm test', now, state: st({ sys: { freeMB: 6000 } }), kinds: { 'npm test': { peakMB: 3000 } }, cfg });
    expect(learned).toMatchObject({ decision: 'defer', reason: 'ram' });
    const reserved = P.admit({ command: 'npm test', now, state: st({ sys: { freeMB: 6000 } }), reservations: [{ mb: 1500, expiresAt: now + S }], cfg });
    expect(reserved.decision).toBe('defer');
    const expired = P.admit({ command: 'npm test', now, state: st({ sys: { freeMB: 6000 } }), reservations: [{ mb: 1500, expiresAt: now - S }], cfg });
    expect(expired.decision).toBe('allow');
  });
  it('watcher absent: allow when no pressure was known, defer when stale state still showed pressure', () => {
    expect(P.admit({ command: 'npm test', now, state: null, cfg }).reason).toBe('watcher-absent');
    const stale = st({ heartbeat: now - 2 * MIN, pressure: { priority: ['cpu'], over: [] } });
    expect(P.admit({ command: 'npm test', now, state: stale, cfg })).toMatchObject({ decision: 'defer', reason: 'uncertain' });
    const old = st({ heartbeat: now - 11 * MIN, pressure: { priority: ['cpu'], over: [] } });
    expect(P.admit({ command: 'npm test', now, state: old, cfg }).decision).toBe('allow');
  });
});

describe('attribution scope', () => {
  it('claudeRoots:false attributes only the given roots (test scope)', () => {
    const ps = [{ pid: 1, ppid: 0, name: 'claude.exe', startMs: 0 }, { pid: 2, ppid: 1, startMs: 1 }, { pid: 3, ppid: 0, startMs: 1 }, { pid: 4, ppid: 3, startMs: 2 }];
    expect([...P.attributedPids(ps, { extraRoots: [3], claudeRoots: false })].sort()).toEqual([3, 4]);
  });
});

describe('appKey with single game dirs', () => {
  it('keys a game by its install dir, so its launcher is a different app', () => {
    const dirs = ['C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Anno 1800/'];
    const anno = 'C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Anno 1800/Bin/Win64/Anno1800.exe';
    const upc = 'C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/upc.exe';
    expect(P.appKey(anno, [], dirs)).toBe('c:/program files (x86)/ubisoft/ubisoft game launcher/games/anno 1800');
    expect(P.appKey(upc, [], dirs)).toBe('c:/program files (x86)/ubisoft');
    const ctx = { cfg, libraryRoots: [], libraryDirs: dirs, learned: {}, manual: false, foreground: null };
    const r = P.updatePriority({}, [{ pid: 1, name: 'Anno1800.exe', path: anno, cpuPct: 0 }, { pid: 2, name: 'upc.exe', path: upc, cpuPct: 0 }], 0, ctx);
    expect(Object.keys(r.active).length).toBe(4);
    expect(Object.values(r.active).every((k) => k.endsWith('anno 1800'))).toBe(true);
  });
});

describe('appKey container folders', () => {
  it('keys WindowsApps / Microsoft / Common Files one level deeper', () => {
    expect(P.appKey('C:/Program Files/WindowsApps/Foo_1.0_x64__abc/app/foo.exe')).toBe('c:/program files/windowsapps/foo_1.0_x64__abc');
    expect(P.appKey('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')).toBe('c:/program files (x86)/microsoft/edge');
  });
});
