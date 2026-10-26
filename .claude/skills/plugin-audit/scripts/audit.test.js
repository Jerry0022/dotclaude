import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { netEstimate, nextStepLine } = require('./audit.js');

// Regression (2026-10-26, v0.320.0): the ship-triggered audit finished and the
// session only offered the report as an open point instead of opening it.
describe('nextStepLine', () => {
  it('tells the session to open the report itself, naming the run dir', () => {
    const line = nextStepLine('C:/x/runs/0.320.0-t');
    expect(line).toContain('WITHOUT asking');
    expect(line).toContain('steps 2-5');
    expect(line).toContain('C:/x/runs/0.320.0-t');
    expect(line).toMatch(/never put it on the card as an open point/i);
  });
});

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

  it('adds savings-log estimates, never block counts, and becomes comparable', () => {
    const m = mining(3, 900, 100);
    m.benefit.tokenGuard = { estimated: true, blocks: 50, avoidedEstimate: 400 };
    m.benefit.localLlm = { estimated: true, estTokens: 250 };
    const n = netEstimate(footprint, m);
    expect(n.comparable).toBe(true);
    expect(n.benefitTokens).toBe(750);
    expect(n.estimate).toBe(750 - 900);
    expect(n.breakdown.estimatedBenefitTokens).toBe(650);
    expect(n.uncertainty).toBeTruthy();
  });

  it('ignores unestimated guard entries (frequency only)', () => {
    const m = mining(3, 900, 100);
    m.benefit.tokenGuard = { measurable: false, blocks: 50 };
    const n = netEstimate(footprint, m);
    expect(n.comparable).toBe(false);
    expect(n.benefitTokens).toBe(100);
  });
});
