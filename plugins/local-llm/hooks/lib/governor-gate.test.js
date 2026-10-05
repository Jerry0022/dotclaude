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
  it('counter-based marker survives concurrent requests (no race)', () => {
    const file = path.join(dir, 'inflight', 'local-llm', `${process.pid}.json`);
    G.begin(5);
    G.begin(6);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ count: 2, updatedAt: 6 });
    G.end(7); // one of two ends; still in flight
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ count: 1, updatedAt: 7 });
    G.end(9); // last one ends
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ count: 0, endedAt: 9 });
  });
  it('during() brackets an async body even on throw', async () => {
    const file = path.join(dir, 'inflight', 'local-llm', `${process.pid}.json`);
    await expect(G.during(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).count).toBe(0);
  });
});
