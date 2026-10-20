const B = require('./run-benchmark');
const T = require('../hooks/lib/anythingllm-tier-cache');

const merge = B.TESTS.find((t) => t.name === 'mergeSorted');
const score = (src) => B.scoreChecks(src, merge.checks, merge.bodyChecks);

describe('run-benchmark mergeSorted scoring', () => {
  it('does not pass a `return a;` stub', () => {
    const stub = 'function mergeSorted(a: number[], b: number[]): number[] { return a; }';
    expect(score(stub)).toBeLessThan(0.8);
  });
  it('passes a real two-pointer merge', () => {
    const ok = `function mergeSorted(a: number[], b: number[]): number[] {
  const out: number[] = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) out.push(a[i] <= b[j] ? a[i++] : b[j++]);
  return out.concat(a.slice(i), b.slice(j));
}`;
    expect(score(ok)).toBeGreaterThanOrEqual(0.8);
  });
});

describe('tier-cache blocksGeneration', () => {
  const fresh = (o) => ({ model: 'm1', ranAt: new Date().toISOString(), tier: 'low', score: 0.2, ...o });
  it('blocks a valid LOW result', () => expect(T.blocksGeneration(fresh(), 'm1')).toBe(true));
  it('does not block after a model switch', () => expect(T.blocksGeneration(fresh(), 'm2')).toBe(false));
  it('does not block a stale result', () => {
    expect(T.blocksGeneration(fresh({ ranAt: '2020-01-01T00:00:00Z' }), 'm1')).toBe(false);
  });
  it('keeps blocking when the model is unknown; ignores non-low', () => {
    expect(T.blocksGeneration(fresh(), null)).toBe(true);
    expect(T.blocksGeneration(fresh({ tier: 'high' }), 'm1')).toBe(false);
  });
});
