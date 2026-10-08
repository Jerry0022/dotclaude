// Covers the three governor hooks end to end as child processes:
// fail open, timing, foreground record/clear, admission defer → queue.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS = path.resolve(__dirname, '..');
const PRE = path.join(HOOKS, 'pre-tool-use', 'pre.governor.gate.js');
const POST = path.join(HOOKS, 'post-tool-use', 'post.governor.clear.js');
const SS = path.join(HOOKS, 'session-start', 'ss.governor.attach.js');
const win = process.platform === 'win32';

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'govhook-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

function run(script, payload) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, DOTCLAUDE_GOVERNOR_HOME: home, DOTCLAUDE_GOVERNOR_NO_SPAWN: '1' },
    encoding: 'utf8',
  });
  return { ...r, ms: Date.now() - t0 };
}

const bash = (command, o = {}) => ({ session_id: 's1', tool_use_id: 'tu1', tool_name: 'Bash', tool_input: { command }, cwd: home, ...o });

describe('governor hooks', () => {
  it('fail open on unusable stdin', () => {
    for (const s of [SS, PRE, POST]) {
      for (const bad of ['', 'null', '{nope', '[]']) {
        const r = run(s, bad);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe('');
      }
    }
  });

  it.runIf(win)('records a foreground call and clears it after', () => {
    const r = run(PRE, bash('git status'));
    expect(r.status).toBe(0);
    const fg = path.join(home, 'foreground', 's1-tu1.json');
    expect(fs.existsSync(fg)).toBe(true);
    run(POST, bash('git status'));
    expect(fs.existsSync(fg)).toBe(false);
    run(PRE, bash('sleep 100', { tool_input: { command: 'sleep 100', run_in_background: true } }));
    expect(fs.existsSync(fg)).toBe(false);
  });

  const freshState = (o = {}) => fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ format: 1, heartbeat: Date.now(), pressure: { priority: [], over: [] }, sys: { freeMB: 30000 }, ...o }));

  it.runIf(win)('allow/defer table (D1 false positives now allowed)', () => {
    const cases = [
      ['git status', 0], ['git log --oneline', 0], ['gh pr list', 0], ['ffmpeg -version', 0], ['node --version', 0], ['ls -la', 0],
      ['npm test', 0], // no pressure → allow
    ];
    freshState();
    for (const [cmd, status] of cases) {
      const r = run(PRE, bash(cmd, { tool_use_id: `c${cmd.length}` }));
      expect([cmd, r.status]).toEqual([cmd, status]);
    }
    // Under CPU priority: light commands and tests stay allowed, a generator (loads cpu) defers.
    freshState({ pressure: { priority: ['cpu'], over: [] }, priorityBy: 'c:/games/foo' });
    expect(run(PRE, bash('git status', { tool_use_id: 'g2' })).status).toBe(0);
    expect(run(PRE, bash('npm test', { tool_use_id: 'n2' })).status).toBe(0);
    expect(run(PRE, bash('docker build .', { tool_use_id: 'd2' })).status).toBe(2);
    // ffmpeg loads gpu; a gpu-priority state defers it but not npm test (no gpu).
    freshState({ pressure: { priority: ['gpu'], over: [] }, priorityBy: 'c:/games/foo' });
    expect(run(PRE, bash('npm test', { tool_use_id: 'n3' })).status).toBe(0);
    expect(run(PRE, bash('ffmpeg -i a.mp4 b.mkv', { tool_use_id: 'f3' })).status).toBe(2);
  });

  it.runIf(win)('defers a heavy start under priority: exit 2, recorded (not run), message tells Claude', () => {
    freshState({ pressure: { priority: ['cpu'], over: [] }, priorityBy: 'c:/games/foo' });
    const r = run(PRE, bash('ffmpeg -i a.wav b.mp3'));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Recorded as [\w-]+/);
    expect(r.stderr).toMatch(/report them as open/);
    expect(r.stderr).toMatch(/Pressed: CPU/);
    expect(r.stderr).toMatch(/cli\.js" wait [\w-]+/);
    const q = fs.readdirSync(path.join(home, 'queue')).filter((n) => n.endsWith('.json'));
    expect(q.length).toBe(1);
    const e = JSON.parse(fs.readFileSync(path.join(home, 'queue', q[0]), 'utf8'));
    expect(e).toMatchObject({ command: 'ffmpeg -i a.wav b.mp3', cwd: home, status: 'queued' });
    expect(fs.existsSync(path.join(home, 'foreground', 's1-tu1.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'reservations'))).toBe(false); // reservations dropped
  });

  it.runIf(win)('the defer message never advertises an opt-out env var', () => {
    freshState({ pressure: { priority: ['cpu'], over: [] } });
    const r = run(PRE, bash('ffmpeg -i a.wav b.mp3'));
    expect(r.stderr).not.toMatch(/DOTCLAUDE_GOVERNOR/);
  });

  it.runIf(win)('resume hook offers ready commands for this repo, once', () => {
    const RESUME = path.join(HOOKS, 'user-prompt-submit', 'prompt.governor.resume.js');
    fs.mkdirSync(path.join(home, 'queue'), { recursive: true });
    fs.writeFileSync(path.join(home, 'queue', 'e1.json'), JSON.stringify({ id: 'e1', command: 'npm run build', cwd: home, branch: 'feat', head: 'abcdef12', status: 'ready', created_at: Date.now() }));
    const r = run(RESUME, { session_id: 's1', cwd: home, prompt: 'hi' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/can run again/);
    expect(r.stdout).toMatch(/npm run build/);
    expect(fs.existsSync(path.join(home, 'queue', 'e1.json'))).toBe(false); // consumed
    expect(run(RESUME, { session_id: 's1', cwd: home, prompt: 'again' }).stdout).toBe('');
  });

  it.runIf(win)('disabled config skips everything', () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ enabled: false }));
    freshState({ pressure: { priority: ['cpu'], over: [] } });
    expect(run(PRE, bash('docker build .')).status).toBe(0);
    expect(fs.existsSync(path.join(home, 'queue'))).toBe(false);
    run(SS, { session_id: 's1', cwd: home });
    expect(fs.existsSync(path.join(home, 'sessions'))).toBe(false);
  });

  it.runIf(win)('SessionStart registers the session with the claude pid from CLAUDE_PID (R6)', () => {
    const r = spawnSync(process.execPath, [SS], {
      input: JSON.stringify({ session_id: 'abc-1', cwd: home }),
      env: { ...process.env, DOTCLAUDE_GOVERNOR_HOME: home, DOTCLAUDE_GOVERNOR_NO_SPAWN: '1', CLAUDE_PID: '4242' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const s = JSON.parse(fs.readFileSync(path.join(home, 'sessions', 'abc-1.json'), 'utf8'));
    expect(s).toMatchObject({ sessionId: 'abc-1', cwd: home, claudePid: 4242 });
  });

  it.runIf(win)('E: the defer message names the culprit and a bounded wait command; that command passes the gate', () => {
    freshState({ pressure: { priority: [], over: ['ram'] }, culprit: { ram: { name: 'OneDrive.Sync.Service.exe', cls: 'foreign', text: 'RAM: OneDrive.Sync.Service.exe 33.0 GB' } } });
    const r = run(PRE, bash('docker build .', { tool_use_id: 'w1' }));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Pressed: RAM: OneDrive\.Sync\.Service\.exe 33\.0 GB/);
    const m = r.stderr.match(/node "([^"]+cli\.js)" wait ([\w-]+)/);
    expect(m).toBeTruthy();
    expect(fs.existsSync(m[1])).toBe(true);
    expect(run(PRE, bash(`node "${m[1]}" wait ${m[2]}`, { tool_use_id: 'w2' })).status).toBe(0);
  });

  it.runIf(win)('hooks stay fast (median of 5 < 300 ms per call beyond bare node start)', () => {
    const bare = [];
    const hook = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      spawnSync(process.execPath, ['-e', '0']);
      bare.push(Date.now() - t0);
      hook.push(run(PRE, bash('npm test', { tool_use_id: `t${i}` })).ms);
    }
    const med = (xs) => xs.sort((a, b) => a - b)[2];
    expect(med(hook) - med(bare)).toBeLessThan(300);
  });
});
