import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { main: hookMain, findAgentWorktree, touchedByOtherSession } = require('./substop.agent.wip.js');

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
  test('commits an isolated agent worktree result and tells the parent', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-abc123');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-abc123', wt);
    fs.writeFileSync(path.join(wt, 'result.txt'), 'r');
    const out = await hookMain({ cwd: repo, agent_id: 'abc123', agent_type: 'devops:core' });
    expect(out.context).toContain('worktree-agent-abc123');
    expect(out.context).toContain('agent-abc123');
    expect(g(wt, 'log', '-1', '--format=%s')).toBe('wip(agent): uncommitted result of devops:core');
    expect(g(repo, 'rev-parse', 'main')).not.toBe(g(wt, 'rev-parse', 'HEAD'));
  });

  test('cwd inside the agent worktree is detected; clean tree stays silent', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-zzz');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-zzz', wt);
    expect(findAgentWorktree({ cwd: wt })).toBe(wt);
    expect(await hookMain({ cwd: wt, agent_id: 'zzz' })).toBeNull();
  });

  test('non-isolated agent (main checkout) is never touched', async () => {
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x');
    expect(await hookMain({ cwd: repo, agent_id: 'q1' })).toBeNull();
    expect(g(repo, 'status', '--porcelain')).toContain('x.txt');
  });

  test('detached agent HEAD gets a wip/agent-<id> branch, main is not committed to', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-det');
    g(repo, 'worktree', 'add', '--detach', wt);
    fs.writeFileSync(path.join(wt, 'r.txt'), 'r');
    const out = await hookMain({ cwd: wt, agent_id: 'det' });
    expect(out.context).toContain('wip/agent-det');
    expect(g(repo, 'log', '-1', '--format=%s', 'main')).toBe('init');
  });

  test('R1: a merge in progress in the agent worktree blocks the save', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-mrg');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-mrg', wt);
    fs.writeFileSync(path.join(wt, 'r.txt'), 'r');
    const gd = path.resolve(wt, g(wt, 'rev-parse', '--git-dir'));
    fs.writeFileSync(path.join(gd, 'MERGE_HEAD'), g(wt, 'rev-parse', 'HEAD'));
    expect(await hookMain({ cwd: wt, agent_id: 'mrg' })).toBeNull();
    expect(g(wt, 'log', '-1', '--format=%s')).toBe('init');
  });

  test('R4/R7: secrets stay out and are reported; the commit is built without touching the tree', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-sec');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-sec', wt);
    fs.writeFileSync(path.join(wt, 'r.txt'), 'r');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1');
    const out = await hookMain({ cwd: wt, agent_id: 'sec', agent_type: 'devops:core' });
    expect(out.context).toMatch(/1 file\(s\) left out/);
    expect(g(wt, 'show', '--name-only', '--format=', 'HEAD')).toBe('r.txt');
    expect(fs.readFileSync(path.join(wt, '.env'), 'utf8')).toBe('SECRET=1');
  });

  test('N4: only the agent_id-derived worktree counts; a mismatching cwd is ignored', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-aaa');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-aaa', wt);
    fs.writeFileSync(path.join(wt, 'r.txt'), 'r');
    expect(findAgentWorktree({ cwd: wt, agent_id: 'bbb' })).toBeNull();
    expect(await hookMain({ cwd: wt, agent_id: 'bbb' })).toBeNull();
    expect(g(wt, 'status', '--porcelain')).toContain('r.txt');
    const norm = (p) => p.split(String.fromCharCode(92)).join('/');
    expect(norm(findAgentWorktree({ cwd: repo, agent_id: 'aaa' }))).toBe(norm(wt));
  });

  test('N4: a fresh transcript of another session for the worktree blocks the save', async () => {
    const wt = path.join(repo, '.claude', 'worktrees', 'agent-live');
    g(repo, 'worktree', 'add', '-b', 'worktree-agent-live', wt);
    const hyg = await import(pathToFileURL(path.resolve(import.meta.dirname, '..', '..', 'mcp-server', 'ship', 'lib', 'hygiene.js')).href);
    const projects = path.join(root, 'projects');
    const dir = path.join(projects, hyg.transcriptDirNames(wt)[0]);
    fs.mkdirSync(dir, { recursive: true });
    const other = path.join(dir, 'other.jsonl');
    fs.writeFileSync(other, '{}');
    const own = path.join(root, 'own.jsonl');
    fs.writeFileSync(own, '{}');
    expect(await touchedByOtherSession(wt, { agent_transcript_path: own }, 60000, Date.now(), projects)).toBe(true);
    expect(await touchedByOtherSession(wt, { agent_transcript_path: other }, 60000, Date.now(), projects)).toBe(false);
    expect(await touchedByOtherSession(wt, { agent_transcript_path: own }, 60000, Date.now() + 120000, projects)).toBe(false);
  });
});
