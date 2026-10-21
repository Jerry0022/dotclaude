import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { mine, modelFamily } = require('./lib/mining.js');
const { tokensOfChars } = require('./lib/util.js');
const repoRoot = path.resolve(here, '../../../..');

describe('plugin-audit mining', () => {
  it('attributes tokens on the fixture transcript', async () => {
    const m = await mine({ root: repoRoot, projectsDir: path.join(here, '__fixtures__/transcripts'), days: 36500 });
    expect(m.totals.sessions).toBe(1); // agent-*.jsonl is ignored
    // m1 appears twice (same message id) and counts once: 160 + 200
    expect(m.totals.tokens).toBe(360);
    expect(m.totals.compactions).toBe(1);
    // 350-char hook context (+ the guard refusal text) carry hook tags; the untagged string does not
    expect(m.totals.hookContextTokens).toBeGreaterThanOrEqual(100);
    expect(m.totals.hookContextTokens).toBeLessThan(100 + tokensOfChars(200));
    expect(m.totals.mcpResultTokens).toBe(20);
    expect(m.totals.pluginSubagentTokens).toBe(1000);
    expect(m.benefit.delegation.spawns).toBe(1);
    expect(m.benefit.delegation.byModel.sonnet.tokens).toBe(1000);
    expect(m.benefit.delegation.savedOpusEquivalentTokens).toBe(400);
    expect(m.benefit.rework.frustrationPrompts).toBe(1);
    expect(m.byProject['proj-a'].sessions).toBe(1);
  });

  it('reports gate catches as frequency and savings of token-guard / local-llm as not measurable', async () => {
    const m = await mine({ root: repoRoot, projectsDir: path.join(here, '__fixtures__/transcripts'), days: 36500 });
    expect(m.benefit.gateCatches.kind).toBe('frequency');
    expect(m.benefit.gateCatches.byRule['card-relayed']).toBe(1);
    expect(m.benefit.tokenGuard.measurable).toBe(false);
    expect(m.benefit.localLlm.measurable).toBe(false);
  });

  it('an empty window yields zero sessions without failing', async () => {
    const m = await mine({ root: repoRoot, projectsDir: path.join(here, '__fixtures__/transcripts'), since: '2999-01-01' });
    expect(m.totals.sessions).toBe(0);
  });

  it('maps model names to families', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('sonnet')).toBe('sonnet');
    expect(modelFamily(undefined)).toBe('unknown');
  });
});
