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
const T0 = 1_000_000_000_000;
const opts = (extra = {}) => ({
  cwd: wt, mode: 'push', stateFile: state, hasOpenPr: () => false, mergedHeads: () => [], now: T0, ...extra,
});
const remoteHas = (b) => g(remote, 'branch', '--list', b) !== '';
const write = (f, t = 'x') => { fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true }); fs.writeFileSync(path.join(wt, f), t); };
const commitIn = (f, msg) => { write(f, f); g(wt, 'add', '-A'); g(wt, ...id, 'commit', '-m', msg); };

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
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('autosave', () => {
  test('clean tree: no output, no state file written', async () => {
    expect(await autosave(opts())).toBeNull();
    expect(fs.existsSync(state)).toBe(false);
  });

  test('R5/R7: default mode is local — snapshot on parked/autosave/<name>, nothing pushed, tree untouched', async () => {
    write('work.txt');
    write('staged.txt');
    g(wt, 'add', 'staged.txt');
    const head = g(wt, 'rev-parse', 'HEAD');
    const before = g(wt, 'status', '--porcelain');
    const r = await autosave(opts({ mode: undefined }));
    expect(r.message).toMatch(/saved locally as parked\/autosave\/sess1/);
    expect(g(wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(g(wt, 'status', '--porcelain')).toBe(before);
    expect(g(wt, 'log', '-1', '--format=%s', 'parked/autosave/sess1')).toBe('wip(session): autosave');
    expect(remoteHas('parked/autosave/sess1')).toBe(false);
    expect(remoteHas('claude/sess1')).toBe(false);
  });

  test('push mode: stable ref pushed fast-forward across windows, session branch never created', async () => {
    write('work.txt');
    expect((await autosave(opts())).message).toMatch(/pushed to origin as parked\/autosave\/sess1/);
    const first = g(remote, 'rev-parse', 'parked/autosave/sess1');
    expect(remoteHas('claude/sess1')).toBe(false);
    write('more.txt');
    expect(await autosave(opts({ now: T0 + 60_000 }))).toBeNull(); // throttled
    expect((await autosave(opts({ now: T0 + 11 * 60_000 }))).message).toMatch(/parked\/autosave\/sess1/);
    const second = g(remote, 'rev-parse', 'parked/autosave/sess1');
    expect(second).not.toBe(first);
    g(remote, 'merge-base', '--is-ancestor', first, second); // chain is fast-forward
    expect(g(remote, 'branch', '--list', 'parked/autosave/*').split('\n').length).toBe(1);
  });

  test('unpushed commits on a branch that exists on origin are fast-forwarded', async () => {
    commitIn('c1.txt', 'feat: c1');
    g(wt, 'push', '-u', 'origin', 'claude/sess1');
    commitIn('c2.txt', 'feat: c2');
    const r = await autosave(opts());
    expect(r.message).toMatch(/pushed to origin as claude\/sess1/);
    expect(g(remote, 'log', '-1', '--format=%s', 'claude/sess1')).toBe('feat: c2');
    expect(remoteHas('parked/autosave/sess1')).toBe(false);
  });

  test('R3: a never-pushed branch is not created on origin — only the parked ref is', async () => {
    commitIn('c1.txt', 'feat: c1');
    const r = await autosave(opts());
    expect(r.message).toMatch(/parked\/autosave\/sess1/);
    expect(remoteHas('claude/sess1')).toBe(false);
    expect(g(remote, 'rev-parse', 'parked/autosave/sess1')).toBe(g(wt, 'rev-parse', 'parked/autosave/sess1'));
  });

  test('R3: branch deleted on origin after a squash merge is not resurrected (upstream gone)', async () => {
    commitIn('c1.txt', 'feat: c1');
    g(wt, 'push', '-u', 'origin', 'claude/sess1');
    g(main, 'push', 'origin', '--delete', 'claude/sess1');
    g(wt, 'fetch', '--prune', 'origin');
    expect(g(wt, 'for-each-ref', '--format=%(upstream:track)', 'refs/heads/claude/sess1')).toMatch(/gone/);
    expect(await autosave(opts({ now: T0 + 1 }))).toBeNull();
    expect(remoteHas('claude/sess1')).toBe(false);
    expect(remoteHas('parked/autosave/sess1')).toBe(false);
    // later uncommitted work is still saved, but only to the parked ref
    write('later.txt');
    const r = await autosave(opts({ now: T0 + 20 * 60_000 }));
    expect(r.message).toMatch(/parked\/autosave\/sess1/);
    expect(remoteHas('claude/sess1')).toBe(false);
  });

  test('R3: a merged PR for this head or a landed HEAD stops the unpushed-commit save', async () => {
    commitIn('c1.txt', 'feat: c1');
    const head = g(wt, 'rev-parse', 'HEAD');
    expect(await autosave(opts({ mergedHeads: () => [head] }))).toBeNull();
    expect(remoteHas('parked/autosave/sess1')).toBe(false);
    // landed via ancestor: main fast-forwards to the commit
    g(main, 'push', 'origin', `${head}:refs/heads/main`);
    g(main, 'fetch', 'origin');
    expect(await autosave(opts({ now: T0 + 20 * 60_000 }))).toBeNull();
    expect(remoteHas('parked/autosave/sess1')).toBe(false);
  });

  test('R4: secrets only -> nothing saved; mixed -> snapshot without them, message says so', async () => {
    write('.env', 'KEY=1');
    write('server.pem', 'pem');
    expect(await autosave(opts())).toBeNull();
    write('ok.txt', 'ok');
    const r = await autosave(opts());
    expect(r.message).toMatch(/2 file\(s\) left out/);
    expect(g(wt, 'show', '--name-only', '--format=', 'parked/autosave/sess1')).toBe('ok.txt');
  });

  test('R1: skipped while a merge is in progress', async () => {
    write('work.txt');
    const gd = path.resolve(wt, g(wt, 'rev-parse', '--git-dir'));
    fs.writeFileSync(path.join(gd, 'MERGE_HEAD'), g(wt, 'rev-parse', 'HEAD'));
    expect(await autosave(opts())).toBeNull();
    expect(fs.existsSync(state)).toBe(false);
  });

  test('skips: open PR, ship active, mode off, main checkout, protected branch', async () => {
    write('work.txt');
    expect(await autosave(opts({ hasOpenPr: () => true }))).toBeNull();
    expect(await autosave(opts({ shipActive: () => true }))).toBeNull();
    expect(await autosave(opts({ mode: 'off' }))).toBeNull();
    fs.writeFileSync(path.join(main, 'm.txt'), 'm');
    expect(await autosave(opts({ cwd: main }))).toBeNull();
    g(wt, 'checkout', '-q', '-b', 'develop');
    expect(await autosave(opts())).toBeNull();
    expect(remoteHas('parked/autosave/sess1')).toBe(false);
  });

  test('R10: plugin-cache paths are excluded, a path merely containing "rpm" is not', async () => {
    const cacheMain = path.join(root, '.claude', 'plugins', 'cache', 'p');
    fs.mkdirSync(cacheMain, { recursive: true });
    g(cacheMain, 'init', '-b', 'main');
    fs.writeFileSync(path.join(cacheMain, 'a.txt'), 'a');
    g(cacheMain, 'add', '-A');
    g(cacheMain, ...id, 'commit', '-m', 'init');
    const cw = path.join(cacheMain, '.claude', 'worktrees', 's1');
    g(cacheMain, 'worktree', 'add', '-b', 'b1', cw);
    fs.writeFileSync(path.join(cw, 'w.txt'), 'w');
    expect(await autosave(opts({ cwd: cw }))).toBeNull();
    const rpmish = path.join(main, '.claude', 'worktrees', 'rpmish');
    g(main, 'worktree', 'add', '-b', 'claude/rpmish', rpmish);
    fs.writeFileSync(path.join(rpmish, 'w.txt'), 'w');
    expect(await autosave(opts({ cwd: rpmish }))).not.toBeNull();
  });

  test('R9: a failed push is stamped with a short retry window, a success with the full one', async () => {
    write('work.txt');
    g(wt, 'remote', 'set-url', 'origin', path.join(root, 'nowhere.git'));
    const r = await autosave(opts());
    expect(r.message).toMatch(/push failed/);
    write('w2.txt');
    expect(await autosave(opts({ now: T0 + 60_000 }))).toBeNull(); // inside the 2 min retry window
    g(wt, 'remote', 'set-url', 'origin', remote);
    const r2 = await autosave(opts({ now: T0 + 3 * 60_000 }));
    expect(r2.message).toMatch(/pushed to origin/);
    write('w3.txt');
    expect(await autosave(opts({ now: T0 + 5 * 60_000 }))).toBeNull(); // success: full 10 min
  });

  test('detached HEAD: snapshot ref only, HEAD and tree untouched', async () => {
    g(wt, 'checkout', '--detach');
    write('work.txt');
    const head = g(wt, 'rev-parse', 'HEAD');
    const r = await autosave(opts());
    expect(r.message).toMatch(/parked\/autosave\/sess1/);
    expect(g(wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.existsSync(path.join(wt, 'work.txt'))).toBe(true);
  });
});
