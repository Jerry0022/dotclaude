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

  it.runIf(win)('allows a heavy start with a fresh watcher and no pressure, writing a reservation', () => {
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ format: 1, heartbeat: Date.now(), pressure: { priority: [], over: [] }, sys: { freeMB: 30000 } }));
    const r = run(PRE, bash('npm test'));
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(home, 'reservations', 's1-tu1.json'))).toBe(true);
    run(POST, bash('npm test'));
    expect(fs.existsSync(path.join(home, 'reservations', 's1-tu1.json'))).toBe(false);
  });

  it.runIf(win)('defers a heavy start under priority: exit 2, queued with cwd', () => {
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ format: 1, heartbeat: Date.now(), pressure: { priority: ['cpu'], over: [] }, priorityBy: 'c:/games/foo', sys: { freeMB: 30000 } }));
    const r = run(PRE, bash('npm run build'));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Queued as/);
    expect(r.stderr).toMatch(/report them as open/);
    const q = fs.readdirSync(path.join(home, 'queue')).filter((n) => n.endsWith('.json'));
    expect(q.length).toBe(1);
    const e = JSON.parse(fs.readFileSync(path.join(home, 'queue', q[0]), 'utf8'));
    expect(e).toMatchObject({ command: 'npm run build', cwd: home, shell: 'bash', status: 'queued' });
    expect(fs.existsSync(path.join(home, 'foreground', 's1-tu1.json'))).toBe(false);
  });

  it.runIf(win)('disabled config and inline opt-out skip everything', () => {
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ format: 1, heartbeat: Date.now(), pressure: { priority: ['cpu'], over: [] } }));
    expect(run(PRE, bash('DOTCLAUDE_GOVERNOR=off npm test')).status).toBe(0);
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ enabled: false }));
    expect(run(PRE, bash('npm test')).status).toBe(0);
    expect(fs.existsSync(path.join(home, 'queue'))).toBe(false);
    run(SS, { session_id: 's1', cwd: home });
    expect(fs.existsSync(path.join(home, 'sessions'))).toBe(false);
  });

  it.runIf(win)('SessionStart registers the session', () => {
    const r = run(SS, { session_id: 'abc-1', cwd: home });
    expect(r.status).toBe(0);
    const s = JSON.parse(fs.readFileSync(path.join(home, 'sessions', 'abc-1.json'), 'utf8'));
    expect(s).toMatchObject({ sessionId: 'abc-1', cwd: home });
    expect(Number.isInteger(s.hookPpid)).toBe(true);
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
