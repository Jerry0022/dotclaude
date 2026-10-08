const P = require('./policy');
const { DEFAULTS, merge } = require('./config');

const cfg = merge(DEFAULTS, {});
const S = 1000;
const MIN = 60 * S;

function proc(o) { return { ppid: 0, name: 'x.exe', path: null, cmd: '', startMs: 0, cpuPct: 0, gpuPct: 0, ioBps: 0, memMB: 0, ...o }; }

describe('isOsProcess', () => {
  const win = { platform: 'win32', systemRoot: 'C:\\Windows' };
  it('Windows: under SystemRoot or Defender = OS, no signature lookup', () => {
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\Windows\\System32\\svchost.exe' }), win)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18\\MsMpEng.exe' }), win)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 10, path: 'C:\\Games\\x.exe' }), win)).toBe(false);
    expect(P.isOsProcess(proc({ pid: 10, name: 'MsMpEng.exe', path: null }), win)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 10, name: 'game.exe', path: null }), win)).toBe(false);
    expect(P.isOsProcess(proc({ pid: 4, name: 'System' }), win)).toBe(true);
  });
  it('Linux: kernel threads and system.slice', () => {
    const lx = { platform: 'linux' };
    expect(P.isOsProcess(proc({ pid: 55, ppid: 2 }), lx)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 55, cgroup: '/system.slice/sshd.service' }), lx)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 55, cgroup: '/user.slice/user-1000.slice/user@1000.service/x.scope' }), lx)).toBe(false);
  });
  it('macOS: /System and /usr/libexec paths', () => {
    const mac = { platform: 'darwin' };
    expect(P.isOsProcess(proc({ pid: 77, path: '/System/Library/CoreServices/WindowServer' }), mac)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 77, path: '/usr/libexec/x' }), mac)).toBe(true);
    expect(P.isOsProcess(proc({ pid: 77, path: '/Applications/Game.app/Contents/MacOS/Game' }), mac)).toBe(false);
  });
});

describe('appKey', () => {
  it('single game dir, library root, container folder, vendor folder', () => {
    const dirs = ['C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Anno 1800/'];
    expect(P.appKey('C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\Anno 1800\\Bin\\Win64\\Anno1800.exe', [], dirs)).toBe('c:/program files (x86)/ubisoft/ubisoft game launcher/games/anno 1800');
    expect(P.appKey('C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\upc.exe', [], dirs)).toBe('c:/program files (x86)/ubisoft');
    expect(P.appKey('D:\\SteamLibrary\\steamapps\\common\\Cool Game\\cool.exe', ['D:\\SteamLibrary\\steamapps\\common'])).toBe('d:/steamlibrary/steamapps/common/cool game');
    expect(P.appKey('C:/Program Files/WindowsApps/Foo_1.0__abc/app/foo.exe')).toBe('c:/program files/windowsapps/foo_1.0__abc');
    expect(P.appKey('C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe')).toBe('c:/program files/blender foundation');
    expect(P.appKey('/Applications/Game.app/Contents/MacOS/Game')).toBe('/applications/game.app');
    expect(P.appKey(null)).toBe(null);
    expect(P.appLabel('/applications/game.app')).toBe('game');
  });
  it('listed matches key substrings and exact names', () => {
    expect(P.listed(['blender'], 'c:/program files/blender foundation', 'blender.exe')).toBe(true);
    expect(P.listed(['obs64.exe'], 'c:/x', 'OBS64.exe')).toBe(true);
    expect(P.listed([], 'c:/x', 'a')).toBe(false);
  });
});

describe('attribution', () => {
  const procs = [
    proc({ pid: 100, ppid: 1, name: 'claude.exe', path: 'C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2\\x\\claude.exe', startMs: 0 }),
    proc({ pid: 101, ppid: 100, name: 'node.exe', cmd: 'node mcp-server/index.js', startMs: 1 * S }),
    proc({ pid: 102, ppid: 100, name: 'bash.exe', startMs: 100 * S }),
    proc({ pid: 103, ppid: 102, name: 'node.exe', cmd: 'node vitest', startMs: 101 * S }),
    proc({ pid: 200, ppid: 1, name: 'game.exe', path: 'D:\\Games\\g.exe', startMs: 5 * S }),
    proc({ pid: 300, ppid: 100, name: 'reused.exe', startMs: -50 * S }),
  ];
  it('Desktop app Claude.exe is NOT a root; the CLI is', () => {
    expect(P.isClaudeRoot(proc({ name: 'Claude.exe', path: 'C:\\Program Files\\WindowsApps\\Claude_2.19_x64__p\\app\\Claude.exe', cmd: '"...Claude.exe"' }))).toBe(false);
    expect(P.isClaudeRoot(proc({ name: 'Claude.exe', path: 'C:\\Program Files\\WindowsApps\\Claude_2.19_x64__p\\app\\Claude.exe', cmd: '...Claude.exe --type=renderer' }))).toBe(false);
    expect(P.isClaudeRoot(procs[0])).toBe(true);
    expect(P.isClaudeRoot(proc({ name: 'node', cmd: 'node /x/@anthropic-ai/claude-code/cli.js' }))).toBe(true);
  });
  it('collects CLI descendants and extra roots by ancestry; ignores pid reuse', () => {
    const a = P.attributedPids(procs);
    expect([...a].sort((x, y) => x - y)).toEqual([100, 101, 102, 103]);
    expect(P.attributedPids(procs, { extraRoots: [200] }).has(200)).toBe(true);
    expect(P.attributedPids(procs, { extraRoots: [200], claudeRoots: false }).has(100)).toBe(false);
  });
  it('sessionMap maps descendants to their session', () => {
    const m = P.sessionMap(procs, { s1: 100 });
    expect(m.get(103)).toBe('s1');
    expect(m.has(200)).toBe(false);
  });
  it('MCP servers and session-start processes are infra', () => {
    const attributed = P.attributedPids(procs);
    const ctx = { attributed, sessionStarts: [0], graceMs: 20 * S, selfPids: new Set([999]) };
    expect(P.classify(procs[0], ctx)).toBe('infra');
    expect(P.classify(procs[1], ctx)).toBe('infra');
    expect(P.classify(procs[3], ctx)).toBe('claude');
    expect(P.classify(proc({ pid: 999 }), ctx)).toBe('self');
    expect(P.classify(procs[4], ctx)).toBe('foreign');
    expect(P.classify({ ...procs[4], os: true }, ctx)).toBe('os');
    expect(P.classify(proc({ pid: 5, name: 'Ollama.exe' }), { attributed: new Set(), activeServices: new Set(['ollama.exe']) })).toBe('service');
  });
  it('self-loop service names: in flight (counter) or < 60 s after end; service names are known', () => {
    const svc = cfg.claudeServices;
    const now = 1000 * S;
    expect(P.activeServiceNames(svc, { 'local-llm': [{ count: 1, updatedAt: now }] }, now, cfg.selfLoopMs).has('ollama.exe')).toBe(true);
    expect(P.activeServiceNames(svc, { 'local-llm': [{ count: 0, endedAt: now - 30 * S }] }, now, cfg.selfLoopMs).size).toBeGreaterThan(0);
    expect(P.activeServiceNames(svc, { 'local-llm': [{ count: 0, endedAt: now - 61 * S }] }, now, cfg.selfLoopMs).size).toBe(0);
    expect(P.activeServiceNames(svc, { 'local-llm': [{ count: 1, updatedAt: now - 40 * MIN }] }, now, cfg.selfLoopMs).size).toBe(0);
    expect(P.serviceNames(svc).has('anythingllm.exe')).toBe(true);
  });
  it('groups a tool-call subtree into one job with summed load and its session', () => {
    const ps = [
      proc({ pid: 100, ppid: 1, name: 'claude.exe', path: 'x\\claude-code\\claude.exe' }),
      proc({ pid: 102, ppid: 100, name: 'bash.exe', startMs: 100 * S }),
      proc({ pid: 103, ppid: 102, cpuPct: 20, memMB: 300, startMs: 101 * S }),
      proc({ pid: 104, ppid: 103, cpuPct: 15, gpuPct: 30, memMB: 200, startMs: 102 * S }),
    ];
    const classes = new Map([[100, 'infra'], [102, 'claude'], [103, 'claude'], [104, 'claude']]);
    const jobs = P.groupJobs(ps, classes, new Set([104]), new Map([[102, 's1']]));
    const j = [...jobs.values()][0];
    expect([j.rootPid, j.cpuPct, j.gpuPct, j.memMB, j.listening, j.session]).toEqual([102, 35, 30, 500, true, 's1']);
  });
});

describe('trackJobs', () => {
  const job = (o) => new Map([['j', { id: 'j', rootPid: 1, startMs: 0, pids: [{ pid: 1, startMs: 0 }], cpuPct: 0, gpuPct: 0, ioBps: 0, memMB: 0, listening: false, session: 's1', ...o }]]);
  function run(load, seconds, ctx = {}) {
    let t = {};
    for (let s = 0; s <= seconds; s += 2) t = P.trackJobs(t, job(load), s * S, cfg, ctx);
    return t.j;
  }
  it('needs 20 s over a CPU/GPU/disk threshold; RAM alone is not heavy', () => {
    expect(run({ cpuPct: 30 }, 18).heavy).toBe(false);
    expect(run({ cpuPct: 30 }, 20).heavy).toBe(true);
    expect(run({ gpuPct: 25 }, 20).heavy).toBe(true);
    expect(run({ ioBps: 50 * 1024 * 1024 }, 20).heavy).toBe(true);
    expect(run({ ioBps: 50 * 1024 * 1024 }, 20, { diskBusy: false }).heavy).toBe(false);
    expect(run({ iops: 800 }, 20).heavy).toBe(true); // many small accesses, few MB/s
    expect(run({ iops: 800 }, 20, { diskBusy: false }).heavy).toBe(false);
    expect(run({ iops: 200 }, 20).heavy).toBe(false);
    expect(run({ memMB: 8000 }, 60).heavy).toBe(false);
  });
  it('heavy stays sticky once reached', () => {
    let t = {};
    for (let s = 0; s <= 22; s += 2) t = P.trackJobs(t, job({ cpuPct: 30 }), s * S, cfg);
    t = P.trackJobs(t, job({ cpuPct: 1 }), 60 * S, cfg);
    expect(t.j.heavy).toBe(true);
  });
  it('kinds: server, foreground (same session), generator, build; max level', () => {
    expect(run({ cpuPct: 30, listening: true }, 200).kind).toBe('server');
    expect(run({ cpuPct: 30 }, 60, { foreground: [{ startedAt: 0, sessionId: 's1' }] }).kind).toBe('foreground');
    expect(run({ cpuPct: 30 }, 60, { foreground: [{ startedAt: 0, sessionId: 's2' }] }).kind).toBe('build');
    const g = run({ cpuPct: 30 }, 150);
    expect(g.kind).toBe('generator');
    expect(P.maxLevel(g)).toBe(P.LEVEL.PAUSE);
    expect(P.maxLevel(run({ cpuPct: 30, gpuPct: 50 }, 150))).toBe(P.LEVEL.CAP);
    expect(P.maxLevel(run({ cpuPct: 30, listening: true }, 200))).toBe(P.LEVEL.CAP);
  });
});

describe('updatePriority', () => {
  const game = (o = {}) => proc({ pid: 50, name: 'g.exe', path: 'C:\\Games\\Foo\\g.exe', ...o });
  const ctx = (o = {}) => ({ cfg, libraryRoots: [], libraryDirs: [], learned: {}, manual: false, foreground: null, ...o });
  const fgq = (pid = 50) => ({ pid, fullscreen: false, idleMs: 10 * MIN }); // owns the foreground, user idle → per resource
  it('priority only on the loaded CPU/GPU/disk resource — never RAM', () => {
    expect(P.updatePriority({}, [game({ gpuPct: 60 })], 0, ctx({ foreground: fgq() })).active).toEqual({ gpu: 'c:/games/foo' });
    const r = P.updatePriority({}, [game({ cpuPct: 15, memMB: 9000 })], 0, ctx({ foreground: fgq() }));
    expect(Object.keys(r.active)).toEqual(['cpu']);
  });
  it('no priority below threshold', () => {
    expect(P.updatePriority({}, [game({ cpuPct: 5 })], 0, ctx()).active).toEqual({});
  });
  it('decays 10 min after last load, also after exit', () => {
    let st = P.updatePriority({}, [game({ cpuPct: 50 })], 0, ctx({ foreground: fgq() }));
    st = P.updatePriority(st, [game({ cpuPct: 1 })], 9 * MIN, ctx());
    expect(st.active.cpu).toBeTruthy();
    st = P.updatePriority(st, [], 9.9 * MIN, ctx());
    expect(st.active.cpu).toBeTruthy();
    st = P.updatePriority(st, [], 10.1 * MIN, ctx());
    expect(st.active).toEqual({});
  });
  it('foreground interactive app with load → yield on ALL resources (RAM included as system resource, not as trigger)', () => {
    const fg = { pid: 50, fullscreen: false, idleMs: 1000 };
    const r = P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ foreground: fg }));
    expect(r.all).toBe(true);
    expect(Object.keys(r.active).sort()).toEqual(['cpu', 'disk', 'gpu', 'ram']);
    expect(P.updatePriority({}, [game({ memMB: 9000 })], 0, ctx({ foreground: fg })).all).toBe(false);
    expect(P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ foreground: { ...fg, idleMs: 10 * MIN } })).all).toBe(false);
  });
  it('library and GameConfigStore apps get priority when foreground or with recent load, not merely for running', () => {
    const steam = (o = {}) => proc({ pid: 9, name: 'cool.exe', path: 'D:\\Lib\\steamapps\\common\\Foo\\foo.exe', ...o });
    const roots = ['D:\\Lib\\steamapps\\common'];
    expect(P.updatePriority({}, [steam()], 0, ctx({ libraryRoots: roots })).active).toEqual({});
    const fg = P.updatePriority({}, [steam()], 0, ctx({ libraryRoots: roots, foreground: { pid: 9, fullscreen: false, idleMs: 100 } }));
    expect(Object.keys(fg.active).sort()).toEqual(['cpu', 'disk', 'gpu', 'ram']);
    const load = P.updatePriority({}, [steam({ gpuPct: 50 })], 0, ctx({ libraryRoots: roots }));
    expect(load.active.gpu).toBeTruthy();
  });
  it('unknown app load earns priority only in the foreground and while the resource is contended; known apps always', () => {
    const calm = { cpu: 30, gpu: 20 };
    expect(P.updatePriority({}, [game({ cpuPct: 15, gpuPct: 40 })], 0, ctx({ sysUse: calm, foreground: fgq() })).active).toEqual({});
    expect(P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ sysUse: { cpu: 70, gpu: 20 }, foreground: fgq() })).active).toEqual({ cpu: 'c:/games/foo' });
    expect(P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ sysUse: { cpu: 70, gpu: 20 } })).active).toEqual({}); // background: budget only
    const fg = { pid: 50, fullscreen: false, idleMs: 1000 };
    expect(P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ sysUse: calm, foreground: fg })).all).toBe(false);
    const learned = { 'c:/games/foo': { resources: ['cpu', 'gpu', 'disk'] } };
    expect(P.updatePriority({}, [game({ gpuPct: 40 })], 0, ctx({ sysUse: calm, learned })).active.gpu).toBe('c:/games/foo');
    expect(P.updatePriority({}, [game({ cpuPct: 15 })], 0, ctx({ sysUse: calm, learned, foreground: fg })).all).toBe(true);
  });
  it('browsers, chat hosts and script runtimes never earn priority by measured load, even when contended', () => {
    const busy = { cpu: 95, gpu: 95 };
    const fg = (pid) => ({ pid, fullscreen: false, idleMs: 100 });
    const edge = proc({ pid: 60, name: 'msedge.exe', path: 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', cpuPct: 40, gpuPct: 50 });
    const edgeSt = P.updatePriority({}, [edge], 0, ctx({ sysUse: busy, foreground: fg(60) }));
    expect(edgeSt.active).toEqual({});
    expect(edgeSt.all).toBe(false);
    const node = proc({ pid: 61, name: 'node.exe', path: 'C:\Program Files\nodejs\node.exe', cpuPct: 60 });
    expect(P.updatePriority({}, [node], 0, ctx({ sysUse: busy })).active).toEqual({});
    let st = {};
    const py = proc({ pid: 62, name: 'python.exe', path: 'C:\Py\python.exe', gpuPct: 80 });
    for (let s = 0; s <= 70; s += 5) st = P.updatePriority(st, [py], s * S, ctx({ sysUse: busy, foreground: fg(62) }));
    expect(st.newlyLearned).toEqual([]);
    expect(P.updatePriority({}, [edge], 0, ctx({ cfg: merge(cfg, { alwaysPriority: ['msedge.exe'] }) })).active.cpu).toBeTruthy();
  });
  it('alwaysPriority grants priority; neverPriority ignores', () => {
    expect(P.updatePriority({}, [game()], 0, ctx({ cfg: merge(cfg, { alwaysPriority: ['c:/games'] }) })).active.cpu).toBeTruthy();
    expect(P.updatePriority({}, [game({ cpuPct: 90 })], 0, ctx({ cfg: merge(cfg, { neverPriority: ['g.exe'] }) })).active).toEqual({});
  });
  it('learns only a foreground app with 3D load, after 60 s (15 s fullscreen); once', () => {
    const fg = { pid: 50, fullscreen: false, idleMs: 0 };
    let st = {};
    let at = null;
    for (let s = 0; s <= 70; s += 5) { st = P.updatePriority(st, [game({ gpuPct: 80 })], s * S, ctx({ foreground: fg })); if (st.newlyLearned.length && at === null) at = s; }
    expect(at).toBe(60);
    let fsAt = null;
    let fsSt = {};
    for (let s = 0; s <= 20; s += 5) { fsSt = P.updatePriority(fsSt, [game({ gpuPct: 80 })], s * S, ctx({ foreground: { ...fg, fullscreen: true } })); if (fsSt.newlyLearned.length && fsAt === null) fsAt = s; }
    expect(fsAt).toBe(15);
  });
  it('never learns CPU-only, background, launcher, browser or service apps', () => {
    const fg = { pid: 50, fullscreen: false, idleMs: 0 };
    const cpuOnly = (seed) => { let st = seed; for (let s = 0; s <= 70; s += 5) st = P.updatePriority(st, [game({ cpuPct: 90 })], s * S, ctx({ foreground: fg })); return st; };
    expect(cpuOnly({}).newlyLearned).toEqual([]);
    let bg = {};
    for (let s = 0; s <= 70; s += 5) bg = P.updatePriority(bg, [game({ gpuPct: 80 })], s * S, ctx());
    expect(bg.newlyLearned).toEqual([]);
    const launcher = (o) => proc({ pid: 50, name: 'Steam.exe', path: 'C:\\Program Files (x86)\\Steam\\steam.exe', ...o });
    let lt = {};
    for (let s = 0; s <= 70; s += 5) lt = P.updatePriority(lt, [launcher({ gpuPct: 80 })], s * S, ctx());
    expect(lt.newlyLearned).toEqual([]); // a launcher is never learned/from-start
    let st = {};
    for (let s = 0; s <= 70; s += 5) st = P.updatePriority(st, [proc({ pid: 50, name: 'ollama.exe', path: 'C:/svc/ollama.exe', gpuPct: 80 })], s * S, ctx({ foreground: fg, noLearn: new Set(['ollama.exe']) }));
    expect(st.newlyLearned).toEqual([]);
  });
  it('a learned app keeps priority while foreground', () => {
    const r = P.updatePriority({}, [game({ cpuPct: 50 })], 0, ctx({ learned: { 'c:/games/foo': { resources: ['gpu'] } }, foreground: { pid: 50, idleMs: 100 } }));
    expect(r.active.gpu).toBe('c:/games/foo');
  });
  it('manual switch → all resources', () => {
    const r = P.updatePriority({}, [], 0, ctx({ manual: true }));
    expect([r.all, r.allBy, Object.keys(r.active).length]).toEqual([true, 'manual', 4]);
  });
});

describe('updateBudget', () => {
  const sys = (o) => ({ cpuPct: 10, gpuPct: 0, diskMs: 1, diskQueue: 0, totalMB: 32768, freeMB: 20000, pagesPerSec: 0, ...o });
  function feed(prev, o, from, to) { let st = prev; for (let s = from; s <= to; s += 2) st = P.updateBudget(st, sys(o), s * S, cfg); return st; }
  it('CPU 80/65 hysteresis and smoothing', () => {
    let st = feed({}, { cpuPct: 85 }, 0, 12);
    expect(st.over.cpu).toBe(true);
    st = feed(st, { cpuPct: 70 }, 14, 30);
    expect(st.over.cpu).toBe(true);
    st = feed(st, { cpuPct: 60 }, 32, 50);
    expect(st.over.cpu).toBe(false);
    st = feed({}, { cpuPct: 20 }, 0, 10);
    expect(P.updateBudget(st, sys({ cpuPct: 100 }), 12 * S, cfg).over.cpu).toBe(false);
  });
  it('RAM: free < 15 % of total, or < 4096 MB, or hard paging', () => {
    expect(feed({}, { totalMB: 65536, freeMB: 9000 }, 0, 12).over.ram).toBe(true);
    expect(feed({}, { totalMB: 65536, freeMB: 11000 }, 0, 12).over.ram).toBe(false);
    expect(feed({}, { totalMB: 16384, freeMB: 3500 }, 0, 12).over.ram).toBe(true);
    expect(feed({}, { totalMB: 16384, freeMB: 4500 }, 0, 12).over.ram).toBe(false);
    expect(feed({}, { pagesPerSec: 5000 }, 0, 12).over.ram).toBe(true);
  });
  it('disk (DRAM-less NVMe): over only at >= 95 % active AND slow (latency > 20 ms or queue > 2), 20 s mean; hysteresis', () => {
    expect(feed({}, { diskBusyPct: 100, diskMs: 1, diskQueue: 0 }, 0, 30).over.disk).toBe(false); // busy but fast
    expect(feed({}, { diskBusyPct: 90, diskMs: 300, diskQueue: 10 }, 0, 30).over.disk).toBe(false); // below 95 %
    let st = feed({}, { diskBusyPct: 98, diskMs: 40, diskQueue: 0 }, 0, 30);
    expect(st.over.disk).toBe(true);
    expect(feed({}, { diskBusyPct: 98, diskMs: 1, diskQueue: 3 }, 0, 30).over.disk).toBe(true); // queue confirms too
    st = feed(st, { diskBusyPct: 90, diskMs: 15, diskQueue: 0 }, 32, 60); // >= 85 % and latency >= half: stays over
    expect(st.over.disk).toBe(true);
    st = feed(st, { diskBusyPct: 90, diskMs: 5, diskQueue: 0.5 }, 62, 90); // latency and queue both under half → ok
    expect(st.over.disk).toBe(false);
    st = feed(feed({}, { diskBusyPct: 98, diskMs: 40 }, 0, 30), { diskBusyPct: 50, diskMs: 40 }, 32, 60); // active < 85 → ok
    expect(st.over.disk).toBe(false);
    st = feed({}, { diskBusyPct: 40, diskMs: 1 }, 0, 20);
    expect(P.updateBudget(st, sys({ diskBusyPct: 100, diskMs: 200, diskQueue: 9 }), 22 * S, cfg).over.disk).toBe(false); // one spike
    expect(feed({}, { diskBusyPct: NaN }, 0, 20).over.disk).toBe(false);
    expect(feed({}, { diskBusyPct: 98, diskMs: NaN, diskQueue: NaN }, 0, 30).over.disk).toBe(true); // no latency/queue reading: active decides
    expect(feed({}, { diskBusyPct: 90 }, 0, 12).mean.diskMs).toBe(1);
  });
  it('RAM paging is averaged over 30 s: one spike never flips RAM over', () => {
    const st = feed({}, { pagesPerSec: 0 }, 0, 30);
    expect(P.updateBudget(st, sys({ pagesPerSec: 20000 }), 32 * S, cfg).over.ram).toBe(false);
    expect(feed({}, { pagesPerSec: 5000 }, 0, 30).over.ram).toBe(true);
  });
});

describe('plan', () => {
  const tj = (id, heavySince, o = {}) => ({ id, heavy: true, heavySince, startMs: heavySince, res: ['cpu'], kind: 'build', gpu: false, ...o });
  it('priority: every heavy job on that resource yields at once to its max level', () => {
    const jobs = { a: tj('a', 0), b: tj('b', 10, { kind: 'generator' }), c: tj('c', 5, { res: ['gpu'] }) };
    expect(P.plan(jobs, {}, { priority: ['cpu'], over: [] }, 100 * S, cfg).desired).toEqual({ a: { level: 1, resources: ['cpu'] }, b: { level: 2, resources: ['cpu'] } });
  });
  it('servers and foreground jobs only capped', () => {
    const jobs = { s: tj('s', 0, { kind: 'server' }), f: tj('f', 0, { kind: 'foreground' }) };
    const d = P.plan(jobs, {}, { priority: ['cpu'], over: [] }, 0, cfg).desired;
    expect([d.s.level, d.f.level]).toEqual([1, 1]);
  });
  it('non-heavy never yields', () => {
    expect(P.plan({ a: { ...tj('a', 0), heavy: false } }, {}, { priority: ['cpu'], over: ['cpu'] }, 0, cfg).desired).toEqual({});
  });
  it('over budget: newest first, one step per escalateMs', () => {
    const jobs = { old: tj('old', 0, { kind: 'generator' }), mid: tj('mid', 10), new: tj('new', 20) };
    let r = P.plan(jobs, {}, { priority: [], over: ['cpu'] }, 100 * S, cfg);
    expect(r.desired).toEqual({ new: { level: 1, resources: ['cpu'] } });
    expect(P.plan(jobs, r.desired, { priority: [], over: ['cpu'] }, 105 * S, cfg, r.last).desired).toEqual(r.desired);
    r = P.plan(jobs, r.desired, { priority: [], over: ['cpu'] }, 110 * S, cfg, r.last);
    expect(Object.keys(r.desired).sort()).toEqual(['mid', 'new']);
  });
  it('relief: each throttled job steps down on its own once none of its resources was pressed for 30 s', () => {
    const jobs = { old: tj('old', 0), new: tj('new', 20), gen: tj('gen', 5, { kind: 'generator' }), disk: tj('disk', 30, { res: ['disk'] }) };
    const cur = { old: { level: 1, resources: ['cpu'] }, new: { level: 1, resources: ['cpu'] }, gen: { level: 2, resources: ['cpu'] }, disk: { level: 1, resources: ['disk'] } };
    let r = P.plan(jobs, cur, { priority: [], over: ['disk'] }, 100 * S, cfg, {}); // adopted: the relief clock starts now
    expect(r.desired).toEqual(cur);
    r = P.plan(jobs, r.desired, { priority: [], over: ['disk'] }, 120 * S, cfg, r.last);
    expect(r.desired).toEqual(cur);
    r = P.plan(jobs, r.desired, { priority: [], over: ['disk'] }, 130 * S, cfg, r.last);
    // both CPU caps lift together, the paused generator steps to a cap; the disk cap stays while disk presses
    expect(r.desired).toEqual({ gen: { level: 1, resources: ['cpu'] }, disk: { level: 1, resources: ['disk'] } });
    r = P.plan(jobs, r.desired, { priority: [], over: [] }, 150 * S, cfg, r.last);
    expect(Object.keys(r.desired)).toEqual(['gen', 'disk']);
    r = P.plan(jobs, r.desired, { priority: [], over: [] }, 160 * S, cfg, r.last);
    expect(r.desired).toEqual({});
  });
  it('keeps a throttle while its resource presses; drops dead jobs', () => {
    const cur = { a: { level: 1, resources: ['gpu'] }, gone: { level: 2, resources: ['cpu'] } };
    expect(P.plan({ a: tj('a', 0, { res: ['gpu'] }) }, cur, { priority: ['gpu'], over: [] }, 500 * S, cfg, { changeAt: 0 }).desired).toEqual({ a: { level: 1, resources: ['gpu'] } });
  });
  it('pressureOf', () => {
    expect(P.pressureOf({ active: { gpu: 'x' } }, { over: { cpu: true, ram: false } })).toEqual({ priority: ['gpu'], over: ['cpu'] });
  });
});

describe('commandSegments & classifyCommand', () => {
  it('matches only the leading command of each segment', () => {
    expect(P.commandSegments('cd x && npm test')).toEqual([['cd', 'x'], ['npm', 'test']]);
    expect(P.commandSegments('FOO=1 npm run build | tee log')).toEqual([['npm', 'run', 'build'], ['tee', 'log']]);
    expect(P.commandSegments("echo 'npm test' && ls")).toEqual([['echo', '""'], ['ls']]);
  });
  it('strips heredoc bodies so their content is not matched', () => {
    const segs = P.commandSegments('cat <<EOF\nnpm test\nffmpeg x\nEOF\necho done');
    expect(segs.some((t) => t[0] === 'npm' || t[0] === 'ffmpeg')).toBe(false);
    expect(segs).toContainEqual(['echo', 'done']);
  });
  it('heavy kinds', () => {
    expect(P.commandKind('cd x && npm test')).toBe('npm test');
    expect(P.commandKind('npm run build')).toBe('npm build');
    expect(P.commandKind('npx vitest run a.test.js')).toBe('vitest');
    expect(P.commandKind('cargo build --release')).toBe('cargo build');
    expect(P.commandKind('docker compose up -d')).toBe('docker');
    expect(P.commandKind('ffmpeg -i a.mp4 b.mkv')).toBe('ffmpeg');
    expect(P.classifyCommand('ffmpeg -i a.mp4 b.mkv').resources).toContain('gpu');
  });
  it('git, gh and info flags are never heavy (D1 false positives)', () => {
    for (const c of ['git status', 'git log', 'gh pr list', 'ffmpeg -version', 'ffmpeg --help', 'node --version', 'go version', 'cargo --help', 'ls -la']) {
      expect(P.commandKind(c)).toBe(null);
    }
  });
  it('escapes: minimal, segment-anchored; nohup is not an escape', () => {
    expect(P.classifyCommand('wsl -e make').escape).toBe(true);
    expect(P.classifyCommand('schtasks /create /tn x').escape).toBe(true);
    expect(P.classifyCommand('Start-Process foo -Verb RunAs').escape).toBe(true);
    expect(P.classifyCommand('sc create svc binPath= x').escape).toBe(true);
    expect(P.classifyCommand('systemd-run --user x').escape).toBe(true);
    expect(P.classifyCommand('nohup npm start').escape).toBe(false);
    expect(P.classifyCommand('echo wslconfig').escape).toBe(false);
    expect(P.classifyCommand('sc query svc').escape).toBe(false);
  });
});

describe('admit', () => {
  const now = 1000 * S;
  const st = (o = {}) => ({ heartbeat: now - S, pressure: { priority: [], over: [] }, sys: { freeMB: 20000 }, ...o });
  it('light commands pass even under pressure', () => {
    expect(P.admit({ command: 'git status', now, state: st({ pressure: { priority: ['cpu'], over: [] } }), cfg }).decision).toBe('allow');
  });
  it('defers only when a resource the command loads is pressed', () => {
    expect(P.admit({ command: 'npm test', now, state: st({ pressure: { priority: ['gpu'], over: [] }, priorityBy: 'c:/games' }), cfg }).decision).toBe('allow'); // npm test loads cpu/disk/ram, not gpu
    expect(P.admit({ command: 'ollama run x', now, state: st({ pressure: { priority: ['gpu'], over: [] }, priorityBy: 'c:/games' }), cfg })).toMatchObject({ decision: 'defer', reason: 'priority:c:/games' });
    expect(P.admit({ command: 'ffmpeg -i a.wav b.mp3', now, state: st({ pressure: { priority: ['cpu'], over: [] } }), cfg }).reason).toBe('priority:app');
    expect(P.admit({ command: 'docker build .', now, state: st({ pressure: { priority: [], over: ['disk'] } }), cfg }).reason).toBe('budget:disk');
  });
  it('builds, tests and browser checks never wait for pressure (only for RAM)', () => {
    const all = st({ pressure: { priority: ['cpu', 'gpu', 'disk', 'ram'], over: ['cpu', 'disk'] }, priorityBy: 'c:/games' });
    for (const cmd of ['npm test', 'npx vitest run a.test.ts', 'npx playwright test', 'npx tsc --noEmit', 'npm run build', 'cargo build']) {
      expect([cmd, P.admit({ command: cmd, now, state: all, cfg }).decision]).toEqual([cmd, 'allow']);
    }
  });
  it('escape routes defer only while pressed', () => {
    expect(P.admit({ command: 'schtasks /run /tn x', now, state: st(), cfg }).decision).toBe('allow');
    expect(P.admit({ command: 'schtasks /run /tn x', now, state: st({ pressure: { priority: ['cpu'], over: [] } }), cfg }).decision).toBe('defer');
  });
  it('plain free-RAM check with expected MB (no reservations)', () => {
    expect(P.admit({ command: 'npm test', now, state: st({ sys: { freeMB: 6000 } }), cfg })).toMatchObject({ decision: 'allow', reason: 'slot' });
    expect(P.admit({ command: 'npm test', now, state: st({ sys: { freeMB: 6000 } }), kinds: { 'npm test': { peakMB: 3000 } }, cfg })).toMatchObject({ decision: 'defer', reason: 'ram' });
  });
  it('no or stale watcher → allow (fail open)', () => {
    expect(P.admit({ command: 'npm test', now, state: null, cfg }).reason).toBe('watcher-absent');
    expect(P.admit({ command: 'npm test', now, state: st({ heartbeat: now - 2 * MIN, pressure: { priority: ['cpu'], over: [] } }), cfg }).decision).toBe('allow');
  });
});

describe('24 h review: host tree, background tools, culprits', () => {
  const DESK = 'C:/Program Files/WindowsApps/Claude_2.26454.0.0_x64__pzs8sxrjxfjjc/app/Claude.exe';
  it('A: the Desktop app is recognised by name + WindowsApps\\Claude_ path, any version', () => {
    expect(P.isClaudeDesktop({ name: 'Claude.exe', path: DESK })).toBe(true);
    expect(P.isClaudeDesktop({ name: 'Claude.exe', path: DESK.replace('2.26454.0.0', '9.1.0.0') })).toBe(true);
    expect(P.isClaudeDesktop({ name: 'claude.exe', path: 'C:/Users/J/AppData/Roaming/Claude/claude-code/2/x/claude.exe' })).toBe(false);
    expect(P.isClaudeDesktop({ name: 'node.exe', path: DESK })).toBe(false);
  });
  it('A: host tree = Desktop processes + non-OS ancestors of a Claude root + all descendants; OS parents never', () => {
    const isOs = (x) => /^C:\/Windows\//i.test(x.path || '');
    const procs = [
      { pid: 1, ppid: 0, name: 'explorer.exe', path: 'C:/Windows/explorer.exe', startMs: 0 },
      { pid: 10, ppid: 1, name: 'Claude.exe', path: DESK, startMs: 10 },
      { pid: 11, ppid: 10, name: 'node.exe', path: 'C:/Program Files/nodejs/node.exe', cmd: 'vite', startMs: 20 },
      { pid: 12, ppid: 11, name: 'esbuild.exe', path: 'C:/p/node_modules/@esbuild/win32-x64/esbuild.exe', startMs: 21 },
      { pid: 20, ppid: 1, name: 'Code.exe', path: 'C:/Users/J/AppData/Local/Programs/Microsoft VS Code/Code.exe', startMs: 5 },
      { pid: 21, ppid: 20, name: 'claude.exe', path: 'C:/Users/J/.local/bin/claude.exe', startMs: 30 },
      { pid: 22, ppid: 20, name: 'pwsh.exe', path: 'C:/Program Files/PowerShell/7/pwsh.exe', startMs: 31 },
      { pid: 30, ppid: 1, name: 'game.exe', path: 'D:/Games/x/game.exe', startMs: 40 },
    ];
    expect([...P.hostPids(procs, isOs)].sort((a, b) => a - b)).toEqual([10, 11, 12, 20, 21, 22]);
    expect(P.hostPids(procs.filter((x) => x.pid === 30 || x.pid === 1), isOs).size).toBe(0);
  });
  it('A: background tools never earn priority from load, not even in the foreground; noLearn extends the set', () => {
    const fg = (pid) => ({ pid, fullscreen: false, idleMs: 100 });
    const ctx = (o = {}) => ({ cfg, libraryRoots: [], libraryDirs: [], learned: {}, manual: false, foreground: null, sysUse: { cpu: 95, gpu: 95 }, diskPressed: true, ...o });
    const tools = [
      proc({ pid: 1, name: 'bash.exe', path: 'C:/Program Files/Git/usr/bin/bash.exe', cpuPct: 50 }),
      proc({ pid: 2, name: 'OneDrive.Sync.Service.exe', path: 'C:/Program Files/Microsoft OneDrive/25.1/OneDrive.Sync.Service.exe', ioBps: 100e6 }),
      proc({ pid: 3, name: '7zG.exe', path: 'C:/Program Files/7-Zip/7zG.exe', cpuPct: 80 }),
      proc({ pid: 4, name: 'GoogleUpdater.exe', path: 'C:/Program Files (x86)/Google/GoogleUpdater/updater.exe', cpuPct: 30 }),
      proc({ pid: 5, name: 'Unity Hub.exe', path: 'C:/Program Files/Unity Hub/Unity Hub.exe', ioBps: 100e6 }),
    ];
    for (const t of tools) expect([t.name, P.updatePriority({}, [t], 0, ctx({ foreground: fg(t.pid) })).active]).toEqual([t.name, {}]);
    const sync = proc({ pid: 6, name: 'sync.exe', path: 'C:/Sync/sync.exe', cpuPct: 50 });
    expect(P.updatePriority({}, [sync], 0, ctx({ foreground: fg(6) })).active.cpu).toBeTruthy();
    expect(P.updatePriority({}, [sync], 0, ctx({ foreground: fg(6), cfg: merge(cfg, { noLearn: ['c:/sync'] }) })).active).toEqual({});
    expect(P.isBackgroundTool('c:/program files/github desktop', 'GitHubDesktop.exe')).toBe(false);
  });
  it('E/F: culprit per resource — the priority app, else the dominant consumer grouped by class + name', () => {
    const classes = new Map([[1, 'foreign'], [2, 'foreign'], [3, 'claude'], [4, 'self']]);
    const procs = [
      proc({ pid: 1, name: 'OneDrive.Sync.Service.exe', memMB: 33 * 1024, iops: 900, ioBps: 4 * 1048576 }),
      proc({ pid: 2, name: 'OneDrive.Sync.Service.exe', memMB: 1024 }),
      proc({ pid: 3, name: 'node.exe', cpuPct: 60, memMB: 2000 }),
      proc({ pid: 4, name: 'node.exe', cpuPct: 99 }),
      proc({ pid: 0, name: 'System Idle Process', cpuPct: 95 }),
    ];
    const c = P.culprits(procs, classes, ['ram', 'cpu', 'disk', 'gpu'], { gpu: 'c:/games/foo' });
    expect(c.ram).toMatchObject({ name: 'OneDrive.Sync.Service.exe', cls: 'foreign', text: 'RAM: OneDrive.Sync.Service.exe 34.0 GB' });
    expect(c.cpu.text).toBe('CPU: node.exe (claude) 60 %');
    expect(c.disk.text).toBe('disk: OneDrive.Sync.Service.exe 900 IO/s, 4 MB/s');
    expect(c.gpu).toMatchObject({ cls: 'priority', text: 'GPU: foo has priority' });
    expect(P.isHog(c.ram, 'ram', cfg, 65536)).toBe(true);
    expect(P.isHog(c.ram, 'ram', cfg, 256 * 1024)).toBe(false);
    expect(P.isHog(c.cpu, 'cpu', cfg, 65536)).toBe(false); // Claude's own job: never a toast
    expect(P.isHog(c.disk, 'disk', cfg, 65536)).toBe(true);
    expect(P.pressedText({ pressed: ['ram'], reason: 'budget:ram' }, { culprit: c })).toBe(c.ram.text);
    expect(P.pressedText({ pressed: ['cpu'], reason: 'budget:cpu' }, {})).toBe('CPU');
  });
  it('E: admit names the pressed resources; `governor wait` itself is light for the gate', () => {
    const now = 1e9;
    const st = { heartbeat: now, pressure: { priority: [], over: ['disk', 'ram'] }, sys: { freeMB: 30000 } };
    expect(P.admit({ command: 'docker build .', now, state: st, cfg }).pressed).toEqual(['disk', 'ram']);
    expect(P.admit({ command: 'npm ci', now, state: { ...st, sys: { freeMB: 100 } }, cfg })).toMatchObject({ decision: 'defer', reason: 'ram', pressed: ['ram'] });
    for (const c of ['node "C:/x/scripts/governor/cli.js" wait abc-123', 'node "C:/x/cli.js" wait --command "npm ci" --timeout 10m']) {
      expect(P.classifyCommand(c)).toMatchObject({ kind: null, escape: false });
      expect(P.admit({ command: c, now, state: st, cfg }).decision).toBe('allow');
    }
  });
});

describe('wave 5', () => {
  it('R2: hostKeys = app keys of every ancestor of a Claude root (real Desktop chain shape)', () => {
    const DESK = 'C:/Program Files/WindowsApps/Claude_2.19675.0.0_x64__pzs8sxrjxfjjc/app/Claude.exe';
    const procs = [
      { pid: 9028, ppid: 1, name: 'explorer.exe', path: 'C:/Windows/explorer.exe', startMs: 0 },
      { pid: 13716, ppid: 9028, name: 'Claude.exe', path: DESK, cmd: '"Claude.exe"', startMs: 10 },
      { pid: 15080, ppid: 13716, name: 'Claude.exe', path: DESK, cmd: 'Claude.exe --type=gpu-process', startMs: 11 },
      { pid: 28064, ppid: 13716, name: 'claude.exe', path: 'C:/Users/J/AppData/Roaming/Claude/claude-code/2.1.286/x/claude.exe', startMs: 100 },
      { pid: 777, ppid: 1, name: 'Code.exe', path: 'C:/Users/J/AppData/Local/Programs/Microsoft VS Code/Code.exe', startMs: 5 },
    ];
    const keys = P.hostKeys(procs, (x) => P.appKey(x.path));
    expect(keys.has(P.appKey(DESK))).toBe(true);
    expect(P.isClaudeRoot(procs[2])).toBe(false);
    expect(keys.has(P.appKey(procs[4].path))).toBe(false); // VS Code is not hosting this Claude
    const viaCode = [...procs, { pid: 30000, ppid: 777, name: 'claude.exe', path: 'C:/x/claude-code/claude.exe', startMs: 200 }];
    expect(P.hostKeys(viaCode, (x) => P.appKey(x.path)).has(P.appKey(procs[4].path))).toBe(true);
  });
  it('R8: foreign disk IO earns priority only while the disk budget is pressed', () => {
    const ctx = (diskPressed) => ({ cfg, libraryRoots: [], libraryDirs: [], learned: {}, manual: false, foreground: { pid: 5, fullscreen: false, idleMs: 10 * MIN }, diskPressed });
    const io = [proc({ pid: 5, name: 'sync.exe', path: 'C:/Sync/sync.exe', ioBps: 500 * 1024 * 1024 })];
    expect(P.updatePriority({}, io, 0, ctx(false)).active).toEqual({});
    expect(P.updatePriority({}, io, 0, ctx(true)).active.disk).toBeTruthy();
  });
  it('R9: shell wrappers, script prefixes, -v only as version for a known set', () => {
    expect(P.commandKind('bash -c "npm test"')).toBe('npm test');
    expect(P.commandKind('cmd /c "cargo build"')).toBe('cargo build');
    expect(P.commandKind('pwsh -NoProfile -Command "npm run build:prod"')).toBe('npm build');
    expect(P.commandKind('npm run test:unit')).toBe('npm test');
    expect(P.commandKind('node -v')).toBe(null);
    expect(P.commandKind('cargo build -v')).toBe('cargo build');
    expect(P.commandKind('ffmpeg -v quiet -i a.mp4 b.mkv')).toBe('ffmpeg');
    expect(P.commandKind('git commit -m "npm test"')).toBe(null);
  });
});

describe('self-check (wave 6)', () => {
  const tj = (id, o = {}) => ({ id, heavy: true, heavySince: 0, startMs: 0, res: ['cpu'], kind: 'build', gpu: false, ...o });
  it('a Claude-launched app the user works in (foreground / non-headless browser) is never throttled, and an existing throttle is dropped', () => {
    const jobs = new Map([['j', { id: 'j', rootPid: 1, startMs: 0, pids: [{ pid: 1, startMs: 0 }, { pid: 2, startMs: 0 }], cpuPct: 90, gpuPct: 0, ioBps: 0, memMB: 0, listening: false }]]);
    let t = {};
    for (let s = 0; s <= 30; s += 2) t = P.trackJobs(t, jobs, s * 1000, cfg, { userPids: new Set([2]) });
    expect(t.j.kind).toBe('user-app');
    expect(P.maxLevel(t.j)).toBe(0);
    expect(P.plan(t, {}, { priority: ['cpu'], over: ['cpu'] }, 60000, cfg).desired).toEqual({});
    expect(P.plan(t, { j: { level: 2, resources: ['cpu'] } }, { priority: ['cpu'], over: [] }, 60000, cfg).desired).toEqual({});
    expect(P.isUserAppProc({ name: 'chrome.exe', cmd: 'chrome.exe https://x' })).toBe(true);
    expect(P.isUserAppProc({ name: 'chrome.exe', cmd: 'chrome.exe --headless=new' })).toBe(false);
    expect(P.isUserAppProc({ name: 'node.exe', cmd: 'node build' })).toBe(false);
    expect(P.maxLevel(tj('x'))).toBe(1);
  });
  it('`npm i -g @anthropic-ai/claude-code` is not a Claude root; the installed CLI path is', () => {
    expect(P.isClaudeRoot({ name: 'npm.cmd', cmd: 'npm i -g @anthropic-ai/claude-code' })).toBe(false);
    expect(P.isClaudeRoot({ name: 'node.exe', cmd: 'node C:/npm/node_modules/@anthropic-ai/claude-code/cli.js' })).toBe(true);
  });
  it('wsl / schtasks management commands are not escape routes; workloads are', () => {
    for (const c of ['wsl --list', 'wsl -l -v', 'wsl --shutdown', 'wsl --status', 'schtasks /query /tn x', 'wsl -d Ubuntu --cd ~ --version']) expect([c, P.classifyCommand(c).escape]).toEqual([c, false]);
    for (const c of ['wsl -e make', 'wsl make', 'wsl -d Ubuntu -- npm test', 'schtasks /create /tn x', 'schtasks /run /tn x']) expect([c, P.classifyCommand(c).escape]).toEqual([c, true]);
  });
});
