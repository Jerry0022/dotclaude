import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkIntegration, discoverParts, summarize, removeIntegrated } = require('./integration-check.js');
const { wipCommit } = require('./wip-commit.js');

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

  test('removeIntegrated removes landed clean parts only, keeps dirty ones', async () => {
    const w1 = agentWt('agent-aaa', 'sub-1');
    commit(w1, 'one.txt', '1');
    g(main, 'merge', '--no-ff', '-m', 'merge', 'sub-1');
    const w2 = agentWt('agent-bbb', 'sub-2');
    fs.writeFileSync(path.join(w2, 'dirty.txt'), 'x');
    const res = await checkIntegration({ cwd: main, integrationRef: 'feature', subRefs: ['sub-1', 'sub-2'] });
    const removed = await removeIntegrated({ cwd: main, integrationRef: 'feature', result: res });
    expect(removed.length).toBe(1);
    expect(fs.existsSync(w1)).toBe(false);
    expect(fs.existsSync(w2)).toBe(true);
    expect(g(main, 'branch', '--list', 'sub-1')).toBe('');
  });
});

describe('wipCommit', () => {
  test('commits on the branch, refuses the protected branch, ignores untracked .claude', () => {
    g(main, 'checkout', '-b', 'topic');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', 'x.json'), '{}');
    expect(wipCommit(main, 'wip: x').committed).toBe(false);
    fs.writeFileSync(path.join(main, 'new.txt'), 'n');
    const r = wipCommit(main, 'wip: x');
    expect(r.committed).toBe(true);
    expect(g(main, 'show', '--stat', '--format=%s', 'HEAD')).not.toContain('.claude');
    g(main, 'checkout', 'feature');
    g(main, 'branch', '-m', 'main');
    fs.writeFileSync(path.join(main, 'm.txt'), 'm');
    expect(wipCommit(main, 'wip: m')).toMatchObject({ committed: false, reason: 'protected' });
  });
});
