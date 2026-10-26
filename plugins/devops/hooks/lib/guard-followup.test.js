import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const f = require('./guard-followup.js');

const cwd = process.cwd() + '-followup-test';
afterEach(() => { try { fs.unlinkSync(f.pendingFile(cwd)); } catch { /* none */ } });

function run(tool, input, pending = { tool: 'Read', input: { file_path: '/big' }, est: 20000 }) {
  f.mark(cwd, pending.tool, pending.input, pending.est, 'read');
  const lines = [];
  const ok = f.check(cwd, tool, input, (op, n, extra) => lines.push({ op, n, extra }));
  return { ok, lines };
}

describe('guard-followup', () => {
  it('logs a measured narrowed entry for a Read with limit after a blocked full Read', () => {
    const { ok, lines } = run('Read', { file_path: '/big', limit: 100 });
    expect(ok).toBe(true);
    expect(lines[0]).toMatchObject({ op: 'narrowed', n: 18800, extra: { estimate: false, narrowedBy: 'limit', measured: 'followup' } });
  });
  it('logs a scoped Grep after a blocked broad Grep', () => {
    const { ok, lines } = run('Grep', { pattern: 'x', path: 'src' }, { tool: 'Grep', input: { pattern: 'x' }, est: 15000 });
    expect(ok).toBe(true);
    expect(lines[0].extra.narrowedBy).toBe('path');
  });
  it('logs nothing for an identical retry or an unrelated call', () => {
    expect(run('Read', { file_path: '/big' }).ok).toBe(false);
    expect(run('Read', { file_path: '/other' }).ok).toBe(false);
    expect(run('Bash', { command: 'ls' }).ok).toBe(false);
  });
  it('consumes the note: a second check logs nothing', () => {
    run('Read', { file_path: '/big', limit: 50 });
    expect(f.check(cwd, 'Read', { file_path: '/big', limit: 50 }, () => {})).toBe(false);
  });
  it('recognises a head cut on Bash', () => {
    const { ok } = run('Bash', { command: 'git log | head -20' }, { tool: 'Bash', input: { command: 'git log' }, est: 9000 });
    expect(ok).toBe(true);
  });
});
