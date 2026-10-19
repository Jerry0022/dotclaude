/**
 * @module integration-check
 * @version 0.1.0
 * @description Integration proof for multi-agent runs: which sub-branches /
 *   agent worktrees are NOT yet in the integration ref, and which agent
 *   worktrees hold uncommitted work. Landing detection reuses hygiene.js
 *   (ancestor, PR heads, tree equality) with baseRef = integrationRef, plus a
 *   merge-tree "merging adds nothing" test. Read-only except removeIntegrated().
 *
 *   checkIntegration({cwd, integrationRef, subRefs}) -> Promise<{parts, unlanded, dirty}>
 *   subRefs: branch names or {branch, path}. discoverParts() derives them
 *   from `git worktree list` (agent-* worktrees, branches containing a slug).
 */

const { execFileSync } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

const GIT_TIMEOUT = 15000;

function git(args, cwd, timeout = GIT_TIMEOUT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}
const gitOk = (args, cwd) => git(args, cwd) !== null;
const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

let hygienePromise = null;
function loadHygiene() {
  if (!hygienePromise) {
    hygienePromise = import(pathToFileURL(path.join(__dirname, '..', '..', 'mcp-server', 'ship', 'lib', 'hygiene.js')).href)
      .catch(() => null);
  }
  return hygienePromise;
}

/** Worktree entries: [{path, branch|null, head}] */
function listWorktrees(cwd) {
  const out = git(['worktree', 'list', '--porcelain'], cwd);
  if (!out) return [];
  return out.split(/\r?\n\r?\n/).map((blk) => {
    const e = { path: null, branch: null, head: null };
    for (const line of blk.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) e.path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) e.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) e.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    }
    return e;
  }).filter((e) => e.path);
}

/** Uncommitted paths worth keeping: porcelain entries minus untracked tooling state. */
function dirtyPaths(wtPath) {
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: wtPath, encoding: 'utf8', timeout: GIT_TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return []; }
  const parts = out.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const p = parts[i].slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++; // rename source follows
    if (code === '??' && (/^\.claude\//.test(p) || /(^|\/)node_modules\//.test(p))) continue;
    paths.push(p);
  }
  return paths;
}

/** The commit sha of a ref, or null. */
const revParse = (ref, cwd) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);

/** Merging `sha` into `ref` would add nothing (merge-tree result tree == ref tree). */
function mergeAddsNothing(sha, ref, cwd) {
  const tree = git(['merge-tree', '--write-tree', ref, sha], cwd);
  if (!tree) return false;
  return tree.split(/\r?\n/)[0] === git(['rev-parse', `${ref}^{tree}`], cwd);
}

async function landing(sha, branch, integrationRef, cwd, merged) {
  if (gitOk(['merge-base', '--is-ancestor', sha, integrationRef], cwd)) return 'ancestor';
  const mod = await loadHygiene();
  if (mod) {
    const ctx = { cwd, baseRef: integrationRef, merged: merged || null };
    try {
      if (typeof mod.landingState === 'function') {
        const st = mod.landingState(sha, branch, ctx);
        const s = st && typeof st === 'object' ? (st.state || st.via) : st;
        if (s === 'landed' || s === 'ancestor' || s === 'pr' || s === 'tree') return s;
        if (s) return null; // partial or unlanded
      } else {
        const via = mod.landedVia(sha, branch, ctx);
        if (via) return via;
      }
    } catch { /* fall through */ }
  }
  return mergeAddsNothing(sha, integrationRef, cwd) ? 'merge-tree' : null;
}

/**
 * @param {{cwd:string, integrationRef:string, subRefs:Array<string|{branch?:string,path?:string}>, merged?:object}} o
 */
async function checkIntegration({ cwd, integrationRef, subRefs, merged }) {
  const wts = listWorktrees(cwd);
  const parts = [];
  for (const raw of subRefs || []) {
    const ref = typeof raw === 'string' ? { branch: raw } : raw;
    const wt = ref.path ? wts.find((w) => norm(w.path) === norm(ref.path))
      : wts.find((w) => w.branch && w.branch === ref.branch);
    const wtPath = (wt && wt.path) || ref.path || null;
    const branch = ref.branch || (wt && wt.branch) || null;
    const sha = (branch && revParse(branch, cwd)) || (wt && wt.head) || null;
    const dirty = wtPath ? dirtyPaths(wtPath) : [];
    const landedVia = sha ? await landing(sha, branch, integrationRef, cwd, merged) : null;
    parts.push({
      branch, path: wtPath, sha,
      landed: Boolean(landedVia), landedVia,
      dirty: dirty.length > 0, dirtyPaths: dirty.slice(0, 20),
    });
  }
  return {
    integrationRef,
    parts,
    unlanded: parts.filter((p) => !p.landed || p.dirty),
    dirty: parts.filter((p) => p.dirty),
  };
}

/**
 * The run's parts from `git worktree list`: agent-* worktrees and branches
 * containing `slug`; the main checkout, `cwd` and the integration branch excluded.
 */
function discoverParts(cwd, { slug, integrationRef } = {}) {
  const wts = listWorktrees(cwd);
  const main = wts[0] && norm(wts[0].path);
  const self = norm(git(['rev-parse', '--show-toplevel'], cwd) || cwd);
  const integ = String(integrationRef || '').replace(/^refs\/heads\//, '');
  const parts = [];
  const seen = new Set();
  for (const w of wts) {
    if (norm(w.path) === main || norm(w.path) === self) continue;
    if (w.branch && w.branch === integ) continue;
    const isAgent = /\/worktrees\/agent-[^/]+$/.test(w.path.replace(/\\/g, '/'));
    if (isAgent || (slug && w.branch && w.branch.includes(slug))) {
      parts.push({ branch: w.branch, path: w.path });
      if (w.branch) seen.add(w.branch);
    }
  }
  if (slug) {
    const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd) || '';
    for (const b of refs.split(/\r?\n/).filter(Boolean)) {
      if (b.includes(slug) && b !== integ && !seen.has(b)) parts.push({ branch: b, path: null });
    }
  }
  return parts;
}

/** Line for the `open:` field — "ungelandet: N Teile (…)" or null. */
function summarize(result) {
  const u = result.unlanded;
  if (!u.length) return null;
  const names = u.map((p) => `${p.path || p.branch}${p.dirty ? ' [uncommitted]' : ''}`);
  return `ungelandet: ${u.length} Teile (${names.join('; ')})`;
}

/**
 * Remove parts that are landed AND clean. Re-checks each part right before
 * deleting; never forces a worktree removal.
 */
async function removeIntegrated({ cwd, integrationRef, result }) {
  const removed = [];
  for (const p of result.parts) {
    if (!p.landed || p.dirty) continue;
    const fresh = await checkIntegration({ cwd, integrationRef, subRefs: [{ branch: p.branch, path: p.path }] });
    const f = fresh.parts[0];
    if (!f || !f.landed || f.dirty) continue;
    if (f.path && !gitOk(['worktree', 'remove', f.path], cwd)) continue;
    if (f.branch && !/^(main|master)$/.test(f.branch) && f.branch !== integrationRef) git(['branch', '-D', f.branch], cwd);
    removed.push(f.path || f.branch);
  }
  return removed;
}

module.exports = {
  checkIntegration, discoverParts, summarize, removeIntegrated,
  listWorktrees, dirtyPaths, mergeAddsNothing,
};
