import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCandidates, auditRepo, readRepoState, isProtectedName } from './repo-health-audit.js';

const state = (over = {}) => ({
  localHeads: new Set(['feat/a', 'feat/b', 'main']),
  remoteHeads: new Set(['feat/a', 'feat/c', 'main']),
  hasRemote: true,
  worktreeBranches: new Set(['feat/b']),
  ...over,
});

describe('auditCandidates — phantom and protected detection', () => {
  test('a clean candidate set yields zero findings', () => {
    const r = auditCandidates([
      { branch: 'feat/a', ort: 'lokal+remote' },
      { branch: 'feat/c', ort: 'nur-remote' },
    ], state({ worktreeBranches: new Set() }), 'main');
    expect(r).toEqual({ checked: 2, findings: [] });
  });

  test('"origin" (refname:short of origin/HEAD) is flagged as protected AND phantom', () => {
    const r = auditCandidates([{ branch: 'origin', ort: 'nur-remote' }], state(), 'main');
    const reasons = r.findings.map((f) => f.reason);
    expect(reasons).toContain('protected name');
    expect(reasons).toContain('phantom: not on origin');
  });

  test.each(['main', 'master', 'HEAD', 'develop', 'origin/main', 'release/main'])(
    'default/protected name %s never passes, whatever the ort says', (name) => {
      const r = auditCandidates([{ branch: name, ort: 'lokal' }], state({ localHeads: new Set([name]) }), 'develop');
      expect(r.findings.some((f) => f.reason === 'protected name')).toBe(true);
    });

  test('a branch checked out in a registered worktree is flagged (exact match only)', () => {
    const r = auditCandidates([
      { branch: 'feat/b', ort: 'lokal' },
      { branch: 'feat/b-2', ort: 'lokal' },
    ], state({ localHeads: new Set(['feat/b', 'feat/b-2']), remoteHeads: new Set() }), 'main');
    expect(r.findings).toEqual([{ branch: 'feat/b', ort: 'lokal', reason: 'checked out in a registered worktree' }]);
  });

  test('ort must match the truth sources in both directions', () => {
    const r = auditCandidates([
      { branch: 'feat/a', ort: 'lokal' },          // exists on origin too
      { branch: 'feat/a', ort: 'nur-remote' },     // exists locally too
      { branch: 'feat/zzz', ort: 'lokal+remote' }, // nowhere
    ], state({ worktreeBranches: new Set() }), 'main');
    expect(r.findings.map((f) => f.reason)).toEqual([
      'classified lokal but exists on origin',
      'classified nur-remote but exists locally',
      'phantom: not in refs/heads',
      'classified lokal+remote but not on origin',
    ]);
  });

  test('remote candidates are unverifiable without ls-remote — flagged, never assumed', () => {
    const r = auditCandidates([{ branch: 'feat/c', ort: 'nur-remote' }], state({ remoteHeads: null }), 'main');
    expect(r.findings[0].reason).toBe('remote not verifiable (no ls-remote)');
  });

  test('malformed ref names are rejected before any lookup', () => {
    const r = auditCandidates([{ branch: '-D', ort: 'lokal' }, { branch: 'a b', ort: 'lokal' }, { branch: '', ort: 'lokal' }], state(), 'main');
    expect(r.findings.every((f) => f.reason === 'invalid ref name')).toBe(true);
    expect(r.checked).toBe(3);
  });
});

describe('isProtectedName', () => {
  test.each([['main', true], ['master', true], ['HEAD', true], ['origin', true], ['x/main', true], ['maintenance', false], ['feat/origin-sync', false]])(
    '%s → %s', (name, expected) => expect(isProtectedName(name, 'main')).toBe(expected));
});

describe('readRepoState + auditRepo — against a real bare remote', () => {
  function run(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  function makeRepos() {
    const root = mkdtempSync(join(tmpdir(), 'rha-'));
    const bare = join(root, 'origin.git'); const work = join(root, 'work');
    run(root, ['init', '--bare', '-b', 'main', bare]);
    run(root, ['clone', '-q', bare, work]);
    run(work, ['config', 'user.email', 't@t']); run(work, ['config', 'user.name', 't']);
    writeFileSync(join(work, 'a.txt'), 'a');
    run(work, ['add', 'a.txt']); run(work, ['commit', '-q', '-m', 'init']);
    run(work, ['push', '-q', '-u', 'origin', 'main']);
    run(work, ['branch', 'feat/local-only']);
    run(work, ['branch', 'feat/both']); run(work, ['push', '-q', 'origin', 'feat/both']);
    run(work, ['push', '-q', 'origin', 'main:refs/heads/feat/remote-only']);
    run(work, ['fetch', '-q', '--all']);
    run(work, ['remote', 'set-head', 'origin', 'main']); // creates refs/remotes/origin/HEAD → the trap
    return work;
  }

  test('origin/HEAD never surfaces as a candidate; every ort is verified against ls-remote', () => {
    const work = makeRepos();
    const st = readRepoState(work);
    expect(st.remoteHeads.has('origin')).toBe(false);
    expect(st.remoteHeads.has('HEAD')).toBe(false);
    expect([...st.remoteHeads].sort()).toEqual(['feat/both', 'feat/remote-only', 'main']);
    expect(st.worktreeBranches.has('main')).toBe(true);
    const r = auditRepo(work, [
      { branch: 'feat/local-only', ort: 'lokal' },
      { branch: 'feat/both', ort: 'lokal+remote' },
      { branch: 'feat/remote-only', ort: 'nur-remote' },
      { branch: 'origin', ort: 'nur-remote' },
      { branch: 'main', ort: 'lokal+remote' },
    ], 'main');
    expect(r.checked).toBe(5);
    expect(r.findings.map((f) => f.branch)).toEqual(['origin', 'origin', 'main', 'main']);
  });
});
