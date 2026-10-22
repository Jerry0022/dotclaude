'use strict';
/**
 * @module scripts/lib/chain-landed
 * @version 0.1.0
 * @plugin devops
 * @description The PR-chain landed proof shared by ship_hygiene (landedVia
 *   "chain") and the cleanup gate. A sub-agent branch merged into an
 *   integration branch that then landed on main through a squash PR is
 *   neither an ancestor of main nor a PR head. It counts as landed when it
 *   is an ancestor of a merged PR head AND that head still holds every
 *   change of the branch (nothing dropped or reverted before the squash).
 *   Commits made after the PR merged are not in the merged head, so they
 *   never pass. Everything is synchronous, read-only and fails closed: any
 *   git error, timeout or oversize change set means "not landed".
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GIT_TIMEOUT = 15_000;
const MAX_FILES = 200;
const CHAIN_MAX_HEADS = 200;
const CHAIN_DEADLINE_MS = 20_000;

function gitOut(args, cwd) {
  try {
    return execFileSync('git', args, { windowsHide: true, cwd, encoding: 'utf8', timeout: GIT_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}
function gitOk(args, cwd) {
  try {
    execFileSync('git', args, { windowsHide: true, cwd, timeout: GIT_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch { return false; }
}

/** A throw-away index holding `treeRef`'s tree, for `git apply --cached` dry runs. */
function withTempIndex(cwd, treeRef, fn) {
  const idx = path.join(os.tmpdir(), `hygiene-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    execFileSync('git', ['read-tree', treeRef], { windowsHide: true, cwd, env, timeout: GIT_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'] });
    return fn(env);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(idx, { force: true }); } catch { /* temp file */ }
  }
}

/**
 * How much of `sha`'s own change set `treeRef` already holds, file by file:
 * the patch `mergebase..sha` of each file must reverse-apply cleanly to the
 * tree (so it contains exactly that change). The merge base is taken against
 * `ctx.baseRef`. null when it cannot be told.
 * @param {{cwd:string, baseRef:string}} ctx
 */
function filesInBase(sha, ctx, treeRef = ctx.baseRef) {
  const mb = gitOut(['merge-base', sha, ctx.baseRef], ctx.cwd);
  if (!mb) return null;
  const names = gitOut(['diff', '--name-only', '-z', mb, sha], ctx.cwd);
  if (names === null) return null;
  const files = names.split('\0').filter(Boolean);
  if (files.length > MAX_FILES) return null;
  if (files.length === 0) return { filesIn: 0, filesTotal: 0 };
  return withTempIndex(ctx.cwd, treeRef, (env) => {
    let filesIn = 0;
    for (const f of files) {
      if (ctx.deadline && Date.now() > ctx.deadline) return null; // caller's overall budget is spent
      try {
        const patch = execFileSync('git', ['diff', '--binary', mb, sha, '--', f], { windowsHide: true,
          cwd: ctx.cwd, encoding: 'utf8', timeout: GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
        });
        execFileSync('git', ['apply', '--cached', '-R', '--check', '-'], { windowsHide: true,
          cwd: ctx.cwd, env, input: patch, timeout: GIT_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'],
        });
        filesIn += 1;
      } catch { /* this file's change is not (fully) in the tree */ }
    }
    return { filesIn, filesTotal: files.length };
  });
}

/**
 * @param {string} sha branch tip
 * @param {{cwd:string, baseRef:string, heads: Iterable<string>, deadline?: number}} ctx heads = merged PR head shas;
 *   deadline = absolute ms after which the search gives up (false)
 * @returns {boolean} false when it cannot be told
 */
function chainLanded(sha, ctx) {
  const t0 = Date.now();
  let tried = 0;
  for (const head of ctx.heads || []) {
    if (tried++ >= CHAIN_MAX_HEADS || Date.now() - t0 > CHAIN_DEADLINE_MS) break;
    if (ctx.deadline && Date.now() > ctx.deadline) break;
    if (!gitOk(['merge-base', '--is-ancestor', sha, head], ctx.cwd)) continue;
    const f = filesInBase(sha, ctx, head);
    if (f && f.filesIn === f.filesTotal) return true;
  }
  return false;
}

/**
 * Head shas of PRs merged into `baseBranch` via gh; null when gh is missing,
 * unauthenticated, offline or slow (callers then treat the chain as unproven).
 */
function fetchMergedHeadShas(cwd, baseBranch, { limit = 300, timeout = 10_000 } = {}) {
  try {
    const out = execFileSync('gh', ['pr', 'list', '--state', 'merged', '--base', baseBranch, '--limit', String(limit),
      '--json', 'headRefOid'], { windowsHide: true, cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    const list = JSON.parse(out);
    if (!Array.isArray(list)) return null;
    return new Set(list.map(p => p && p.headRefOid).filter(Boolean));
  } catch { return null; }
}

module.exports = { chainLanded, filesInBase, fetchMergedHeadShas, MAX_FILES };
