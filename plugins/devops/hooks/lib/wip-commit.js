/**
 * @module wip-commit
 * @version 0.1.0
 * @description Save uncommitted work of a worktree as a WIP commit — never on
 *   main/master/the default branch, never forced, bounded git timeouts, never
 *   throws. Shared by sub.agent.wip (SubagentStop) and stop.session.autosave.
 *
 *   wipCommit(wt, message, {detached}) -> {committed, branch?, sha?, ref?, reason?}
 *   detached: 'branch:<name>' checks that branch out first; 'ref:<refname>'
 *   writes the snapshot to a backup ref and leaves HEAD and the tree alone.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dirtyPaths } = require('./integration-check');

const T = 20000;

function git(args, cwd, env) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout: T, stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    }).trim();
  } catch { return null; }
}

function defaultBranch(cwd) {
  const sym = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  return sym ? sym.replace(/^origin\//, '') : null;
}

function isProtected(branch, cwd) {
  return /^(main|master)$/.test(branch) || branch === defaultBranch(cwd);
}

function identityArgs(cwd) {
  const has = (k) => Boolean(git(['config', k], cwd));
  const a = [];
  if (!has('user.name')) a.push('-c', 'user.name=devops-autosave');
  if (!has('user.email')) a.push('-c', 'user.email=devops-autosave@localhost');
  return a;
}

function snapshotToRef(wt, paths, message, ref) {
  const idx = path.join(os.tmpdir(), `dotclaude-wip-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: idx };
  try {
    if (git(['read-tree', 'HEAD'], wt, env) === null) return null;
    if (git(['add', '-A', '--', ...paths], wt, env) === null) return null;
    const tree = git(['write-tree'], wt, env);
    if (!tree) return null;
    const sha = git([...identityArgs(wt), 'commit-tree', tree, '-p', 'HEAD', '-m', message], wt);
    if (!sha || git(['update-ref', ref, sha], wt) === null) return null;
    return sha;
  } finally {
    try { fs.unlinkSync(idx); } catch { /* none */ }
  }
}

function wipCommit(wt, message, { detached } = {}) {
  try {
    const paths = dirtyPaths(wt);
    if (!paths.length) return { committed: false, reason: 'clean' };
    let branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], wt);
    if (!branch) {
      const m = /^(branch|ref):(.+)$/.exec(detached || '');
      if (!m) return { committed: false, reason: 'detached' };
      if (m[1] === 'ref') {
        const sha = snapshotToRef(wt, paths, message, m[2]);
        return sha ? { committed: true, ref: m[2], sha } : { committed: false, reason: 'snapshot-failed' };
      }
      if (git(['checkout', '-b', m[2]], wt) === null) return { committed: false, reason: 'checkout-failed' };
      branch = m[2];
    }
    if (isProtected(branch, wt)) return { committed: false, reason: 'protected', branch };
    if (git(['add', '-A', '--', ...paths], wt) === null) return { committed: false, reason: 'add-failed' };
    if (git([...identityArgs(wt), 'commit', '--no-verify', '-m', message], wt) === null) {
      return { committed: false, reason: 'commit-failed', branch };
    }
    return { committed: true, branch, sha: git(['rev-parse', 'HEAD'], wt) };
  } catch {
    return { committed: false, reason: 'error' };
  }
}

module.exports = { wipCommit, isProtected, defaultBranch, git };
