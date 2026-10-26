import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { staleRevert } = require('./stale-revert.js');

let repo;
const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (f, t) => fs.writeFileSync(path.join(repo, f), t);

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-revert-'));
  g('init', '-q', '-b', 'main');
  write('a.txt', 'v1'); write('old.ts', 'legacy');
  g('add', '-A'); g('commit', '-qm', 'v1');
  write('a.txt', 'v2'); write('CHANGELOG.md', '# v2'); fs.rmSync(path.join(repo, 'old.ts')); write('new.ts', 'modern');
  g('add', '-A'); g('commit', '-qm', 'v2');
});
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

describe('staleRevert (#877)', () => {
  test('files back on an older base state, a deleted newer file and a re-added old one → stale', () => {
    write('a.txt', 'v1'); fs.rmSync(path.join(repo, 'CHANGELOG.md')); write('old.ts', 'legacy');
    const r = staleRevert(repo, ['a.txt', 'CHANGELOG.md', 'old.ts'], 'main');
    expect(r).toEqual({ stale: true, reverted: ['a.txt', 'CHANGELOG.md', 'old.ts'], own: [] });
  });

  test('any own content makes it real work', () => {
    write('a.txt', 'v1'); write('mine.txt', 'new idea');
    const r = staleRevert(repo, ['a.txt', 'mine.txt'], 'main');
    expect(r.stale).toBe(false);
    expect(r.own).toEqual(['mine.txt']);
  });

  test('deletions alone are a normal change, not a stale checkout', () => {
    fs.rmSync(path.join(repo, 'CHANGELOG.md'));
    expect(staleRevert(repo, ['CHANGELOG.md'], 'main').stale).toBe(false);
  });

  test('an edit to a new value, no paths, or an unknown base → not stale', () => {
    write('a.txt', 'v3');
    expect(staleRevert(repo, ['a.txt'], 'main').stale).toBe(false);
    expect(staleRevert(repo, [], 'main').stale).toBe(false);
    expect(staleRevert(repo, ['a.txt'], 'origin/nope').stale).toBe(false);
  });
});
