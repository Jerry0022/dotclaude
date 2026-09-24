#!/usr/bin/env node
/**
 * @script repo-health-audit
 * @version 0.1.0
 * @plugin devops
 * @description Truth-source gate for auto-cleanup candidates. Every branch the
 *   concept page offers for deletion — and every branch about to be deleted —
 *   must pass this audit against the live repo, not against a cached listing:
 *     - local candidates must exist as `refs/heads/<name>` (full refname);
 *     - remote candidates must be listed by `git ls-remote --heads origin`
 *       (the server's answer, never `refs/remotes/*` + `%(refname:short)`:
 *       that shortening turns `refs/remotes/origin/HEAD` into the name
 *       `origin`, which once landed on a page as a deletable remote branch);
 *     - the Ort (lokal / nur-remote / lokal+remote) must match both sources;
 *     - protected names never qualify: main, master, HEAD, origin, the repo's
 *       default branch, and any branch a registered worktree has checked out
 *       (exact-name match, see git-hygiene.md § Protection scope).
 *   Usage:  node repo-health-audit.js <repoPath> <candidates.json> [--default main]
 *   candidates.json: [{ "branch": "feat/x", "ort": "lokal+remote" }, ...]
 *   Prints one JSON line {checked, findings:[{branch, ort, reason}]} and exits 1
 *   when any finding exists. The caller drops every flagged candidate and shows
 *   the count ("N geprüft, 0 Befunde") in the page header.
 */
'use strict';

const { execFileSync } = require('child_process');

const PROTECTED_NAMES = ['main', 'master', 'HEAD', 'origin'];

function git(cwd, args) {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: '' };
  }
}

/** Live ref state of one repo — every set is built from an unambiguous source. */
function readRepoState(repoPath, gitFn = git) {
  const localHeads = new Set(
    gitFn(repoPath, ['for-each-ref', 'refs/heads', '--format=%(refname)']).out
      .split('\n').filter(Boolean).map((r) => r.replace(/^refs\/heads\//, '')),
  );
  const hasRemote = gitFn(repoPath, ['remote', 'get-url', 'origin']).code === 0;
  let remoteHeads = null; // null = not verifiable (no remote / ls-remote failed)
  if (hasRemote) {
    const ls = gitFn(repoPath, ['ls-remote', '--heads', 'origin']);
    if (ls.code === 0) {
      remoteHeads = new Set(
        ls.out.split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace(/^refs\/heads\//, '')),
      );
    }
  }
  const worktreeBranches = new Set();
  for (const line of gitFn(repoPath, ['worktree', 'list', '--porcelain']).out.split('\n')) {
    if (line.startsWith('branch ')) worktreeBranches.add(line.slice(7).replace(/^refs\/heads\//, ''));
  }
  return { localHeads, remoteHeads, hasRemote, worktreeBranches };
}

function isProtectedName(name, defaultBranch) {
  return PROTECTED_NAMES.includes(name) || name === defaultBranch || /(^|\/)(main|master|HEAD)$/.test(name);
}

/**
 * Audit candidates against a repo state. Pure — testable without git.
 * @returns {{ checked: number, findings: Array<{branch: string, ort: string, reason: string}> }}
 */
function auditCandidates(candidates, state, defaultBranch) {
  const findings = [];
  const flag = (c, reason) => findings.push({ branch: c.branch, ort: c.ort, reason });
  for (const c of candidates) {
    const n = c.branch;
    if (typeof n !== 'string' || !n || /\s|\.\.|^-/.test(n)) { flag(c, 'invalid ref name'); continue; }
    if (isProtectedName(n, defaultBranch)) flag(c, 'protected name');
    if (state.worktreeBranches.has(n)) flag(c, 'checked out in a registered worktree');
    const local = state.localHeads.has(n);
    const remote = state.remoteHeads ? state.remoteHeads.has(n) : null;
    if (c.ort === 'nur-remote') {
      if (local) flag(c, 'classified nur-remote but exists locally');
      if (remote === null) flag(c, 'remote not verifiable (no ls-remote)');
      else if (!remote) flag(c, 'phantom: not on origin');
    } else if (c.ort === 'lokal' || c.ort === 'lokal+remote') {
      if (!local) flag(c, 'phantom: not in refs/heads');
      if (c.ort === 'lokal+remote' && remote === false) flag(c, 'classified lokal+remote but not on origin');
      if (c.ort === 'lokal' && remote === true) flag(c, 'classified lokal but exists on origin');
    } else {
      flag(c, `unknown ort "${c.ort}"`);
    }
  }
  return { checked: candidates.length, findings };
}

function auditRepo(repoPath, candidates, defaultBranch) {
  return auditCandidates(candidates, readRepoState(repoPath), defaultBranch);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--default');
  const defaultBranch = di >= 0 ? argv[di + 1] : 'main';
  const [repoPath, file] = argv.filter((_, i) => di < 0 || (i !== di && i !== di + 1));
  if (!repoPath || !file) {
    console.error('usage: repo-health-audit.js <repoPath> <candidates.json> [--default main]');
    process.exit(2);
  }
  const candidates = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  const result = auditRepo(repoPath, candidates, defaultBranch);
  console.log(JSON.stringify(result));
  process.exit(result.findings.length ? 1 : 0);
}

module.exports = { auditCandidates, auditRepo, readRepoState, isProtectedName, PROTECTED_NAMES };
