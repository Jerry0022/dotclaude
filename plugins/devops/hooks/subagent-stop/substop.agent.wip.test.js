import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { main: hookMain, findAgentWorktree } = require('./substop.agent.wip.js');

let root;
let repo;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'substop-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  g(repo, 'init', '-b', 'main');
  g(repo, 'config', 'user.name', 't');
  g(repo, 'config', 'user.email', 't@t');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-m', 'init');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('substop.agent.wip', () => {
  test('commits an isolated agent worktree result and tells the parent', () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-abc123');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-abc123', wt);
    fs.writeFileSync(path.join(wt, 'result.txt'), 'r');
    const out = hookMain({ cwd: repo, agent_id: 'abc123', agent_type: 'devops:core' });
    expect(out.context).toContain('worktree-agent-abc123');
    expect(out.context).toContain('agent-abc123');
    expect(g(wt, 'log', '-1', '--format=%s')).toBe('wip(agent): uncommitted result of devops:core');
    expect(g(repo, 'rev-parse', 'main')).not.toBe(g(wt, 'rev-parse', 'HEAD'));
  });

  test('cwd inside the agent worktree is detected; clean tree stays silent', () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-zzz');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-zzz', wt);
    expect(findAgentWorktree({ cwd: wt })).toBe(wt);
    expect(hookMain({ cwd: wt, agent_id: 'zzz' })).toBeNull();
  });

  test('non-isolated agent (main checkout) is never touched', () => {
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x');
    expect(hookMain({ cwd: repo, agent_id: 'q1' })).toBeNull();
    expect(g(repo, 'status', '--porcelain')).toContain('x.txt');
  });

  test('detached agent HEAD gets a wip/agent-<id> branch, main is not committed to', () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-det');
    g(repo, 'worktree', 'add', '--detach', wt);
    fs.writeFileSync(path.join(wt, 'r.txt'), 'r');
    const out = hookMain({ cwd: wt, agent_id: 'det' });
    expect(out.context).toContain('wip/agent-det');
    expect(g(repo, 'log', '-1', '--format=%s', 'main')).toBe('init');
  });
});
