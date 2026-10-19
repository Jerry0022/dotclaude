import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkIntegration, discoverParts, summarize, removeIntegrated } = require('./integration-check.js');
const { wipCommit, snapshotCommit } = require('./wip-commit.js');

const n = (p) => p.split('\\').join('/');
let root;
let main;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function commit(cwd, file, text) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), text);
  g(cwd, 'add', '-A');
  g(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', `add ${file}`);
}

function agentWt(name, branch) {
  const p = path.join(main, '.claude', 'worktrees', name);
  g(main, 'worktree', 'add', '-b', branch, p);
  return p;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'intcheck-'));
  main = path.join(root, 'main');
  fs.mkdirSync(main);
  g(main, 'init', '-b', 'feature');
  commit(main, 'a.txt', 'a');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('checkIntegration', () => {
  test('landed (ancestor), unlanded, dirty and squash-equivalent parts', async () => {
    const w1 = agentWt('agent-aaa', 'sub-1');
    commit(w1, 'one.txt', '1');
    g(main, 'merge', '--no-ff', '-m', 'merge sub-1', 'sub-1');

    const w2 = agentWt('agent-bbb', 'sub-2');
    commit(w2, 'two.txt', '2');

    const w3 = agentWt('agent-ccc', 'sub-3');
    fs.writeFileSync(path.join(w3, 'dirty.txt'), 'x');

    // sub-4: copied into the integration branch as a different commit (cherry-pick)
    const w4 = agentWt('agent-ddd', 'sub-4');
    commit(w4, 'four.txt', '4');
    g(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'cherry-pick', 'sub-4');

    const res = await checkIntegration({
      cwd: main, integrationRef: 'feature',
      subRefs: ['sub-1', 'sub-2', 'sub-3', { branch: 'sub-4', path: w4 }],
    });
    const by = Object.fromEntries(res.parts.map((p) => [p.branch, p]));
    expect(by['sub-1'].landed).toBe(true);
    expect(by['sub-1'].landedVia).toBe('ancestor');
    expect(by['sub-2'].landed).toBe(false);
    expect(by['sub-3'].dirty).toBe(true);
    expect(by['sub-3'].landed).toBe(true); // no commits of its own: tip is an ancestor
    expect(by['sub-4'].landed).toBe(true);
    expect(by['sub-4'].landedVia).not.toBe('ancestor');
    expect(res.unlanded.map((p) => p.branch).sort()).toEqual(['sub-2', 'sub-3']);
    expect(summarize(res)).toMatch(/^ungelandet: 2 Teile/);
    expect(summarize(res)).toContain('[uncommitted]');
    expect(w2).toBeTruthy();
  });

  test('discoverParts finds agent worktrees and slug branches, not main/self', () => {
    agentWt('agent-aaa', 'sub-1');
    g(main, 'branch', 'run-xyz-fe');
    const parts = discoverParts(main, { slug: 'run-xyz', integrationRef: 'feature' });
    expect(parts.map((p) => p.branch).sort()).toEqual(['run-xyz-fe', 'sub-1']);
  });

  test('removeIntegrated: only run-owned or explicit parts, never ones without own commits', async () => {
    const w1 = agentWt('agent-aaa', 'run-abcdef-1');
    commit(w1, 'one.txt', '1');
    const w2 = agentWt('agent-bbb', 'other-2');
    commit(w2, 'two.txt', '2');
    const w3 = agentWt('agent-ccc', 'run-abcdef-3'); // no commits of its own
    const w4 = agentWt('agent-ddd', 'run-abcdef-4');
    commit(w4, 'four.txt', '4');
    fs.writeFileSync(path.join(w4, 'dirty.txt'), 'x');
    g(main, 'merge', '--no-ff', '-m', 'merge', 'run-abcdef-1', 'other-2', 'run-abcdef-4');

    const parts = discoverParts(main, { slug: 'run-abcdef', integrationRef: 'feature' });
    expect(parts.filter((p) => p.removable).map((p) => p.branch).sort()).toEqual(['run-abcdef-1', 'run-abcdef-3', 'run-abcdef-4']);
    expect(discoverParts(main, { slug: 'run', integrationRef: 'feature' }).some((p) => p.removable)).toBe(false);

    const res = await checkIntegration({ cwd: main, integrationRef: 'feature', subRefs: parts });
    const removed = await removeIntegrated({ cwd: main, integrationRef: 'feature', result: res, idleMs: 0 });
    expect(removed.map(n)).toEqual([n(w1)]);
    expect(fs.existsSync(w1)).toBe(false);
    expect(fs.existsSync(w2)).toBe(true); // another run's part: listed, never removed
    expect(fs.existsSync(w3)).toBe(true); // zero own commits
    expect(fs.existsSync(w4)).toBe(true); // dirty
    expect(g(main, 'branch', '--list', 'run-abcdef-1')).toBe('');

    const res2 = await checkIntegration({ cwd: main, integrationRef: 'feature', subRefs: [{ branch: 'other-2', path: w2 }] });
    expect((await removeIntegrated({ cwd: main, integrationRef: 'feature', result: res2, explicit: true, idleMs: 0 })).map(n)).toEqual([n(w2)]);
  });

  test('a recently active worktree is kept (idle minimum)', async () => {
    const w1 = agentWt('agent-aaa', 'run-abcdef-1');
    commit(w1, 'one.txt', '1');
    g(main, 'merge', '--no-ff', '-m', 'merge', 'run-abcdef-1');
    const res = await checkIntegration({ cwd: main, integrationRef: 'feature', subRefs: [{ branch: 'run-abcdef-1', path: w1, removable: true }] });
    expect(await removeIntegrated({ cwd: main, integrationRef: 'feature', result: res })).toEqual([]);
  });

  test('ignored files inside keep the worktree', async () => {
    const w1 = agentWt('agent-aaa', 'run-abcdef-1');
    commit(w1, '.gitignore', 'keep.bin\n');
    fs.writeFileSync(path.join(w1, 'keep.bin'), 'precious');
    g(main, 'merge', '--no-ff', '-m', 'merge', 'run-abcdef-1');
    const res = await checkIntegration({ cwd: main, integrationRef: 'feature', subRefs: [{ branch: 'run-abcdef-1', path: w1, removable: true }] });
    expect(await removeIntegrated({ cwd: main, integrationRef: 'feature', result: res, idleMs: 0 })).toEqual([]);
    expect(fs.existsSync(w1)).toBe(true);
  });
});

describe('wipCommit', () => {
  test('moves the branch via a temporary index: files untouched, tree clean afterwards', async () => {
    g(main, 'checkout', '-b', 'topic');
    fs.writeFileSync(path.join(main, 'new.txt'), 'n');
    fs.writeFileSync(path.join(main, 'a.txt'), 'changed');
    const r = await wipCommit(main, 'wip: x');
    expect(r.committed).toBe(true);
    expect(g(main, 'rev-parse', 'topic')).toBe(r.sha);
    expect(fs.readFileSync(path.join(main, 'new.txt'), 'utf8')).toBe('n');
    expect(g(main, 'status', '--porcelain')).toBe('');
  });

  test('snapshotCommit leaves HEAD, index and working tree alone', async () => {
    g(main, 'checkout', '-b', 'topic');
    fs.writeFileSync(path.join(main, 'staged.txt'), 's');
    g(main, 'add', 'staged.txt');
    fs.writeFileSync(path.join(main, 'new.txt'), 'n');
    const head = g(main, 'rev-parse', 'HEAD');
    const before = g(main, 'status', '--porcelain');
    const sha = snapshotCommit(main, ['new.txt'], 'wip');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(g(main, 'show', '--name-only', '--format=', sha)).toBe('new.txt');
    expect(g(main, 'rev-parse', 'HEAD')).toBe(head);
    expect(g(main, 'status', '--porcelain')).toBe(before);
  });

  test('ignores untracked .claude, refuses protected branches', async () => {
    g(main, 'checkout', '-b', 'topic');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', 'x.json'), '{}');
    expect((await wipCommit(main, 'wip: x')).committed).toBe(false);
    for (const b of ['main', 'develop', 'release/1.0']) {
      g(main, 'checkout', '-B', b);
      fs.writeFileSync(path.join(main, 'm.txt'), b);
      expect(await wipCommit(main, 'wip: m')).toMatchObject({ committed: false, reason: 'protected' });
    }
  });

  test('R4: secrets, build output, tooling files and big files are left out and reported', async () => {
    g(main, 'checkout', '-b', 'topic');
    const bad = ['.env', '.env.local', 'cert.pem', 'id_rsa', 'prod-credentials.json', 'dump.sql', 'dist/app.js',
      'coverage/lcov.info', 'graphify-out/g.json', 'AUTONOMOUS-STATE.json', 'BACKLOG-REPORT.html', 'BURN-STATE.json'];
    for (const f of bad) {
      fs.mkdirSync(path.dirname(path.join(main, f)), { recursive: true });
      fs.writeFileSync(path.join(main, f), 'x');
    }
    fs.writeFileSync(path.join(main, 'big.bin'), Buffer.alloc(5 * 1024 * 1024 + 1));
    fs.writeFileSync(path.join(main, 'ok.txt'), 'ok');
    const r = await wipCommit(main, 'wip: x');
    expect(r.committed).toBe(true);
    expect(g(main, 'show', '--name-only', '--format=', 'HEAD')).toBe('ok.txt');
    expect(r.skipped.length).toBe(bad.length + 1);
  });

  test('R1: no save while a merge/cherry-pick/rebase/lock is in progress', async () => {
    g(main, 'checkout', '-b', 'topic');
    fs.writeFileSync(path.join(main, 'w.txt'), 'w');
    const gd = path.resolve(main, g(main, 'rev-parse', '--git-dir'));
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'index.lock', 'rebase-merge', 'rebase-apply']) {
      const p = path.join(gd, marker);
      if (/^rebase/.test(marker)) fs.mkdirSync(p); else fs.writeFileSync(p, g(main, 'rev-parse', 'HEAD'));
      const r = await wipCommit(main, 'wip: x');
      expect(r.committed).toBe(false);
      expect(r.reason).toMatch(/^in-progress/);
      fs.rmSync(p, { recursive: true, force: true });
    }
    expect((await wipCommit(main, 'wip: x')).committed).toBe(true);
  });

  test('R1: unmerged paths block the save', async () => {
    g(main, 'checkout', '-b', 'topic');
    fs.writeFileSync(path.join(main, 'a.txt'), 'topic');
    g(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'topic change');
    g(main, 'checkout', '-q', 'feature');
    fs.writeFileSync(path.join(main, 'a.txt'), 'feature');
    g(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'feature change');
    try { g(main, 'merge', 'topic'); } catch { /* conflict expected */ }
    fs.rmSync(path.join(main, '.git', 'MERGE_HEAD'), { force: true });
    expect(await wipCommit(main, 'wip: x')).toMatchObject({ committed: false, reason: 'in-progress:unmerged-paths' });
  });

  test('N1: a staged rename does not resurrect the old path', async () => {
    g(main, 'checkout', '-b', 'topic');
    g(main, 'mv', 'a.txt', 'b.txt');
    const r = await wipCommit(main, 'wip: x');
    expect(r.committed).toBe(true);
    expect(g(main, 'ls-tree', '--name-only', 'HEAD').split('\n')).toEqual(['b.txt']);
    expect(g(main, 'status', '--porcelain')).toBe('');
  });

  test('N8: extended secret names and content sniffing', async () => {
    g(main, 'checkout', '-b', 'topic');
    const names = ['x.tfvars', 'terraform.tfstate.backup', '.pypirc', 'my-token.txt', 'kubeconfig', 'service-account-prod.json', '.htpasswd', 'a.jks'];
    for (const f of names) fs.writeFileSync(path.join(main, f), 'v');
    fs.writeFileSync(path.join(main, 'notes.txt'), 'x\n-----BEGIN RSA PRIVATE KEY-----\nabc');
    fs.writeFileSync(path.join(main, 'cfg.txt'), 'aws_secret_access_key = abc');
    fs.writeFileSync(path.join(main, 'gh.txt'), `t=ghp_${'a'.repeat(30)}`);
    fs.writeFileSync(path.join(main, 'ok.txt'), 'fine');
    const r = await wipCommit(main, 'wip: x');
    expect(g(main, 'show', '--name-only', '--format=', 'HEAD')).toBe('ok.txt');
    expect(r.skipped.length).toBe(names.length + 3);
  });

  test('N10: a detached explicit part is kept (own commits cannot be proven)', async () => {
    const w = path.join(main, '.claude', 'worktrees', 'agent-det');
    g(main, 'worktree', 'add', '--detach', w);
    commit(w, 'd.txt', 'd');
    g(main, 'merge', '--no-ff', '-m', 'merge', g(w, 'rev-parse', 'HEAD'));
    const res = await checkIntegration({ cwd: main, integrationRef: 'feature', subRefs: [{ path: w }] });
    expect(res.parts[0].landed).toBe(true);
    expect(await removeIntegrated({ cwd: main, integrationRef: 'feature', result: res, explicit: true, idleMs: 0 })).toEqual([]);
    expect(fs.existsSync(w)).toBe(true);
  });
});
