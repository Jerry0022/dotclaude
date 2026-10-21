import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
import fs from 'node:fs';
import os from 'node:os';
const { mine, modelFamily, createSession, attributeVersions, readSavings } = require('./lib/mining.js');
const NO_LOG = path.join(os.tmpdir(), 'plugin-audit-no-savings-log.jsonl');
const { tokensOfChars } = require('./lib/util.js');
const repoRoot = path.resolve(here, '../../../..');

describe('plugin-audit mining', () => {
  it('attributes tokens on the fixture transcript', async () => {
    const m = await mine({ root: repoRoot, projectsDir: path.join(here, '__fixtures__/transcripts'), savingsLog: NO_LOG, days: 36500 });
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
    const m = await mine({ root: repoRoot, projectsDir: path.join(here, '__fixtures__/transcripts'), savingsLog: NO_LOG, days: 36500 });
    expect(m.benefit.gateCatches.kind).toBe('frequency');
    expect(m.benefit.gateCatches.byRule['card-relayed']).toBe(1);
    expect(m.benefit.tokenGuard.measurable).toBe(false);
    expect(m.benefit.localLlm.measurable).toBe(false);
  });

  it('an empty window yields zero sessions without failing', async () => {
    const m = await mine({ root: repoRoot, projectsDir: path.join(here, '__fixtures__/transcripts'), savingsLog: NO_LOG, since: '2999-01-01' });
    expect(m.totals.sessions).toBe(0);
  });

  it('maps model names to families', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('sonnet')).toBe('sonnet');
    expect(modelFamily(undefined)).toBe('unknown');
  });

  const ctx = (text) => ({ type: 'attachment', attachment: { type: 'hook_additional_context', content: [text] } });
  const spawn = (id, input) => ({ type: 'assistant', message: { id: 'm' + id, content: [{ type: 'tool_use', id, name: 'Agent', input }] } });
  const result = (id, tokens) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] }, toolUseResult: { totalTokens: tokens } });

  it('reads the plugin version marker and the spawn model marker from hook context', () => {
    const s = createSession('p', null);
    s.add(ctx('[devops] version=0.291.0'));
    s.add(ctx('Agent card ...\n[agent-model] id=t1 type=devops:core model=sonnet (audit marker - do not show)'));
    s.add(spawn('t1', { subagent_type: 'devops:core' }));
    s.add(result('t1', 500));
    s.add(spawn('t2', { subagent_type: 'devops:qa', model: 'haiku' }));
    s.add(result('t2', 100));
    s.add(spawn('t3', { subagent_type: 'devops:qa' }));
    s.add(result('t3', 50));
    const r = s.finish();
    expect(r.version).toBe('0.291.0');
    expect(r.subagents.map((a) => a.model)).toEqual(['sonnet', 'haiku', 'unknown']);
  });

  it('attributes untagged sessions to the latest earlier tagged version by time window', () => {
    const mk = (firstTs, version) => ({ firstTs, version, tokens: 10, plugin: { total: 1 } });
    const v = attributeVersions([mk('2026-10-03', null), mk('2026-10-01', '0.290.0'), mk('2026-10-02', '0.291.0'), mk('2026-09-01', null)]);
    expect(v['0.290.0']).toMatchObject({ sessions: 1, inferredSessions: 0 });
    expect(v['0.291.0']).toMatchObject({ sessions: 2, inferredSessions: 1 });
    expect(v.unknown.sessions).toBe(1);
  });

  it('turns the savings log into labelled estimates and ignores old/garbled lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-sav-'));
    const f = path.join(dir, 'log.jsonl');
    const L = (o) => JSON.stringify({ estimate: true, ts: '2026-10-20T00:00:00Z', ...o });
    fs.writeFileSync(f, [
      L({ source: 'token-guard', op: 'blocked', estTokens: 1000 }), L({ source: 'token-guard', op: 'blocked', estTokens: 500 }),
      L({ source: 'token-guard', op: 'released', estTokens: 500 }), L({ source: 'local-llm', op: 'delegated', estTokens: 300 }),
      L({ source: 'local-llm', op: 'delegated', estTokens: 9999, ts: '2020-01-01T00:00:00Z' }), 'not json',
    ].join('\n'));
    const r = readSavings(f, new Date('2026-10-01').getTime());
    expect(r.tokenGuard).toMatchObject({ blocked: 2, released: 1, avoidedEstimate: 1000 });
    expect(r.localLlm).toEqual({ delegations: 1, estTokens: 300 });
    expect(readSavings(path.join(dir, 'missing.jsonl'), 0)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
