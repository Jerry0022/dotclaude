import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { autosave } = require('./session-autosave.js');

let root;
let main;
let wt;
let remote;
let state;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const noPr = () => false;
const base = () => ({ cwd: wt, stateFile: state, hasOpenPr: noPr, now: 1_000_000_000_000 });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'autosave-'));
  remote = path.join(root, 'remote.git');
  main = path.join(root, 'main');
  state = path.join(root, 'state.json');
  g(root, 'init', '--bare', '-b', 'main', 'remote.git');
  g(root, 'clone', remote, 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  g(main, 'add', '-A');
  g(main, ...id, 'commit', '-m', 'init');
  g(main, 'push', '-u', 'origin', 'main');
  g(main, 'remote', 'set-head', 'origin', 'main');
  wt = path.join(main, '.claude', 'worktrees', 'sess1');
  g(main, 'worktree', 'add', '-b', 'claude/sess1', wt);
  g(wt, 'config', 'user.name', 't');
  g(wt, 'config', 'user.email', 't@t');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('autosave', () => {
  test('clean tree: no output, no state file written', () => {
    expect(autosave(base())).toBeNull();
    expect(fs.existsSync(state)).toBe(false);
  });

  test('dirty tree: WIP commit pushed to the branch name; throttled afterwards', () => {
    fs.writeFileSync(path.join(wt, 'work.txt'), 'w');
    const r = autosave(base());
    expect(r.message).toMatch(/pushed it to origin as claude\/sess1/);
    expect(g(remote, 'log', '-1', '--format=%s', 'claude/sess1')).toMatch(/^wip\(session\)/);
    fs.writeFileSync(path.join(wt, 'more.txt'), 'm');
    expect(autosave({ ...base(), now: base().now + 60_000 })).toBeNull();
    expect(autosave({ ...base(), now: base().now + 11 * 60_000 })).not.toBeNull();
  });

  test('unpushed commit without dirt is pushed', () => {
    fs.writeFileSync(path.join(wt, 'c.txt'), 'c');
    g(wt, 'add', '-A');
    g(wt, 'commit', '-m', 'feat: c');
    expect(autosave(base()).message).toMatch(/1 unpushed/);
    expect(g(remote, 'log', '-1', '--format=%s', 'claude/sess1')).toBe('feat: c');
  });

  test('non-fast-forward goes to parked/autosave/<branch>, never forced', () => {
    fs.writeFileSync(path.join(wt, 'c.txt'), 'c');
    g(wt, 'add', '-A');
    g(wt, 'commit', '-m', 'feat: c');
    g(wt, 'push', 'origin', 'HEAD:refs/heads/claude/sess1');
    const other = path.join(root, 'other');
    g(root, 'clone', remote, 'other');
    g(other, 'checkout', 'claude/sess1');
    fs.writeFileSync(path.join(other, 'x.txt'), 'x');
    g(other, 'add', '-A');
    g(other, ...id, 'commit', '-m', 'remote moved');
    g(other, 'push', 'origin', 'claude/sess1');
    g(wt, 'fetch', 'origin');
    fs.writeFileSync(path.join(wt, 'd.txt'), 'd');
    const r = autosave(base());
    expect(r.message).toMatch(/parked\/autosave\/claude\/sess1/);
    expect(g(remote, 'log', '-1', '--format=%s', 'claude/sess1')).toBe('remote moved');
    expect(g(remote, 'log', '-1', '--format=%s', 'parked/autosave/claude/sess1')).toMatch(/^wip\(session\)/);
  });

  test('skips: open PR, ship active, mode off, main checkout, protected branch', () => {
    fs.writeFileSync(path.join(wt, 'work.txt'), 'w');
    expect(autosave({ ...base(), hasOpenPr: () => true })).toBeNull();
    expect(autosave({ ...base(), shipActive: () => true })).toBeNull();
    expect(autosave({ ...base(), mode: 'off' })).toBeNull();
    fs.writeFileSync(path.join(main, 'm.txt'), 'm');
    expect(autosave({ ...base(), cwd: main })).toBeNull();
    expect(g(remote, 'branch', '--list', 'claude/sess1')).toBe('');
  });

  test('local mode commits but does not push', () => {
    fs.writeFileSync(path.join(wt, 'work.txt'), 'w');
    expect(autosave({ ...base(), mode: 'local' }).message).toMatch(/locally/);
    expect(g(remote, 'branch', '--list', 'claude/sess1')).toBe('');
    expect(g(wt, 'log', '-1', '--format=%s')).toMatch(/^wip\(session\)/);
  });

  test('detached HEAD: backup ref snapshot, HEAD and tree untouched', () => {
    g(wt, 'checkout', '--detach');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'w');
    const head = g(wt, 'rev-parse', 'HEAD');
    const r = autosave(base());
    expect(r.message).toMatch(/pushed it to origin as parked\/autosave\/sess1-/);
    expect(g(wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.existsSync(path.join(wt, 'work.txt'))).toBe(true);
    expect(g(remote, 'branch', '--list', 'parked/autosave/*')).toMatch(/sess1/);
  });
});
