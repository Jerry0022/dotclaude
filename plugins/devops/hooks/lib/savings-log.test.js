import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { record, MAX_BYTES } = require('./savings-log.js');
const llm = require('../../../local-llm/hooks/lib/savings-log.js');

const dirs = [];
function tmpLog() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'savings-'));
  dirs.push(d);
  process.env.DEVOPS_SAVINGS_LOG = path.join(d, 'sub', 'log.jsonl');
  return process.env.DEVOPS_SAVINGS_LOG;
}
afterEach(() => { delete process.env.DEVOPS_SAVINGS_LOG; for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('savings-log', () => {
  it('writes one labelled-estimate JSONL line', () => {
    const f = tmpLog();
    expect(record('token-guard', 'blocked', 1234.6, { kind: 'read' })).toBe(true);
    const o = JSON.parse(fs.readFileSync(f, 'utf8').trim());
    expect(o).toMatchObject({ v: 1, source: 'token-guard', op: 'blocked', estimate: true, estTokens: 1235, kind: 'read' });
  });
  it('caps the file by dropping the oldest half', () => {
    const f = tmpLog();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, (JSON.stringify({ old: 'x'.repeat(200) }) + '\n').repeat(Math.ceil(MAX_BYTES / 200) + 5));
    record('local-llm', 'delegated', 5);
    expect(fs.statSync(f).size).toBeLessThan(MAX_BYTES);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    expect(JSON.parse(lines[lines.length - 1]).op).toBe('delegated');
    for (const l of lines) JSON.parse(l);
  });
  it('never throws on an unwritable path', () => {
    const f = tmpLog();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(f), 'blocker'), 'x');
    process.env.DEVOPS_SAVINGS_LOG = path.join(path.dirname(f), 'blocker', 'log.jsonl'); // parent is a file
    expect(record('a', 'b', 1)).toBe(false);
  });
  it('the local-llm copy stays identical', () => {
    const a = fs.readFileSync(new URL('./savings-log.js', import.meta.url), 'utf8');
    const b = fs.readFileSync(new URL('../../../local-llm/hooks/lib/savings-log.js', import.meta.url), 'utf8');
    expect(b).toBe(a);
    expect(typeof llm.record).toBe('function');
  });
});
