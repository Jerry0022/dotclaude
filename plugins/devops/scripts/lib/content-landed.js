'use strict';
/**
 * @module scripts/lib/content-landed
 * @version 0.1.0
 * @plugin devops
 * @description Is the CONTENT of a commit already in the default branch? The
 *   one rule ship_hygiene (before it deletes) and the WIP watch (before it
 *   calls something lost) share. History does not answer it: a squash merge
 *   lands content under another commit, and a commit reachable from a merged
 *   PR head can still have had its changes dropped before the squash.
 *
 *   Two content checks over the files the commit changed since its merge base
 *   with `baseRef` (renames off — a rename's old path counts too):
 *     1. files — every one of them is byte-identical in `baseRef`;
 *     2. merge — re-applying the commit's own changes onto `baseRef`
 *        (`git merge-tree --write-tree --merge-base=<fork point>`) is a clean
 *        no-op: the result tree IS `baseRef`'s tree. This still says "landed"
 *        when main changed the same files elsewhere after the squash, which
 *        check 1 alone reports as different.
 *   `opts.forkRef` measures the commit's own changes from its merge base with
 *   another ref: "are the changes this branch made on top of main all inside
 *   that merged PR head?" — for a commit that is an ANCESTOR of the target the
 *   plain merge base would be the commit itself and prove nothing.
 *   Either one proves it; neither → not landed (fail closed: any git error,
 *   a conflict, more than `maxFiles` files, an old git without
 *   `merge-tree --write-tree`).
 */

const { execFileSync } = require('child_process');

const GIT_TIMEOUT = 15_000;
const MAX_FILES = 200;

function makeGit(cwd) {
  return (args) => {
    try {
      return { ok: true, out: execFileSync('git', ['--literal-pathspecs', ...args], { windowsHide: true,
        cwd, encoding: 'utf8', timeout: GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      }) };
    } catch (e) {
      return { ok: false, out: e && typeof e.stdout === 'string' ? e.stdout : '', status: e && e.status };
    }
  };
}

/**
 * @param {string} cwd repo
 * @param {string} sha commit (or ref) to check
 * @param {string} baseRef e.g. refs/remotes/origin/main
 * @param {{maxFiles?:number, git?:Function, forkRef?:string}} [opts]
 * @returns {{landed:boolean, via:('empty'|'files'|'merge'|null), files:string[], differing:string[], reason:string|null}}
 */
function contentInBase(cwd, sha, baseRef, opts = {}) {
  const git = opts.git || makeGit(cwd);
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const no = (reason, files = [], differing = []) => ({ landed: false, via: null, files, differing, reason });
  if (!sha || !baseRef) return no('missing-ref');
  const mb = git(['merge-base', sha, opts.forkRef || baseRef]);
  if (!mb.ok || !mb.out.trim()) return no('no-merge-base');
  const base = mb.out.trim();
  const diff = git(['diff', '--no-renames', '--name-only', '-z', base, sha]);
  if (!diff.ok) return no('diff-failed');
  const files = diff.out.split('\0').filter(Boolean);
  if (files.length === 0) return { landed: true, via: 'empty', files, differing: [], reason: null };
  if (files.length > maxFiles) return no('too-many-files', files);
  if (git(['diff', '--quiet', sha, baseRef, '--', ...files]).ok) {
    return { landed: true, via: 'files', files, differing: [], reason: null };
  }
  const mt = git(['merge-tree', '--write-tree', `--merge-base=${base}`, baseRef, sha]);
  const baseTree = git(['rev-parse', `${baseRef}^{tree}`]);
  if (mt.ok && baseTree.ok && mt.out.split('\n')[0].trim() === baseTree.out.trim()) {
    return { landed: true, via: 'merge', files, differing: [], reason: null };
  }
  const dn = git(['diff', '--name-only', '-z', sha, baseRef, '--', ...files]);
  const differing = dn.ok || dn.out ? dn.out.split('\0').filter(Boolean) : files;
  return no(mt.ok ? 'content-differs' : (mt.status === 1 ? 'conflicts' : 'content-differs'), files, differing);
}

module.exports = { contentInBase, MAX_FILES };
