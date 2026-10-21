import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const state = require('./lib/state.js');

function sh(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('plugin-audit state', () => {
  it('anchors the state dir at the MAIN repo root from inside a worktree', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-state-')));
    const main = path.join(base, 'main');
    const wt = path.join(base, 'wt');
    fs.mkdirSync(main);
    sh(['init', '-q', '-b', 'main'], main);
    sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], main);
    sh(['worktree', 'add', '-q', '-b', 'feat', wt], main);
    delete process.env.PLUGIN_AUDIT_STATE_DIR;
    const fromMain = state.stateDir(main, undefined);
    const fromWorktree = state.stateDir(wt, undefined);
    expect(fromWorktree).toBe(fromMain);
    expect(fs.realpathSync(path.dirname(path.dirname(fromWorktree)))).toBe(main);
    expect(fromWorktree.split(path.sep).slice(-2)).toEqual(['.claude', 'plugin-audit']);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('writes last.json with version, minor and decade; history appends', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-last-'));
    const last = state.writeLast(dir, { version: '0.290.1', trigger: 'ship', ranAt: '2026-10-20T00:00:00Z' });
    expect(last).toEqual({ version: '0.290.1', minor: 290, decade: 29, ranAt: '2026-10-20T00:00:00Z', trigger: 'ship' });
    expect(state.readLast(dir)).toEqual(last);
    state.appendHistory(dir, { version: '0.280.0' });
    state.appendHistory(dir, { version: '0.290.1' });
    expect(state.readHistory(dir).map((h) => h.version)).toEqual(['0.280.0', '0.290.1']);
    const run = state.newRunDir(dir, '0.290.1');
    expect(path.basename(run)).toMatch(/^0\.290\.1-/);
    expect(fs.existsSync(run)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
