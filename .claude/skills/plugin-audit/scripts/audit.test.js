import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { netEstimate } = require('./audit.js');

const footprint = { components: [{ name: 'skills', tokens: 1000 }, { name: 'hooks (measured)', tokens: 50 }] };
const mining = (sessions, injected, saved) => ({
  totals: { sessions, pluginInContextTokens: injected },
  benefit: { delegation: { savedOpusEquivalentTokens: saved } },
});

describe('netEstimate', () => {
  it('takes the measured transcript cost and never double-counts the static footprint', () => {
    const n = netEstimate(footprint, mining(10, 5000, 800));
    expect(n.costTokens).toBe(5000);
    expect(n.benefitTokens).toBe(800);
  });

  it('falls back to the static footprint when no session was mined', () => {
    expect(netEstimate(footprint, mining(0, 0, 0)).costTokens).toBe(1000);
  });

  it('reports no net number, because most benefits are not logged', () => {
    const n = netEstimate(footprint, mining(3, 900, 100));
    expect(n.estimate).toBeNull();
    expect(n.comparable).toBe(false);
  });
});
