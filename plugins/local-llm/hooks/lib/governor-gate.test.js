const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('./governor-gate');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'govllm-')); process.env.DOTCLAUDE_GOVERNOR_HOME = dir; });
afterEach(() => { delete process.env.DOTCLAUDE_GOVERNOR_HOME; fs.rmSync(dir, { recursive: true, force: true }); });

const state = (o) => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ heartbeat: 1000, pressure: { priority: [], over: [] }, ...o }));

describe('local-llm governor gate', () => {
  it('fails open without a governor or with a stale one', () => {
    expect(G.check(1000).defer).toBe(false);
    state({ pressure: { priority: ['gpu'], over: [] } });
    expect(G.check(1000 + 20000).defer).toBe(false);
  });
  it('defers on GPU/RAM priority or over budget, not on CPU-only priority', () => {
    state({ pressure: { priority: ['gpu'], over: [] }, priorityBy: 'c:/games/x' });
    expect(G.check(1000)).toEqual({ defer: true, reason: 'priority on gpu (c:/games/x)' });
    state({ pressure: { priority: ['cpu'], over: [] } });
    expect(G.check(1000).defer).toBe(false);
    state({ pressure: { priority: [], over: ['ram'] } });
    expect(G.check(1000).defer).toBe(true);
  });
  it('writes the in-flight marker', () => {
    G.mark(true, 5);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'inflight', 'local-llm.json'), 'utf8'))).toEqual({ active: true, startedAt: 5 });
    G.mark(false, 9);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'inflight', 'local-llm.json'), 'utf8'))).toEqual({ active: false, endedAt: 9 });
  });
});
