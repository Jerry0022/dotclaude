/**
 * @module wip-commit
 * @version 0.3.0
 * @description Save uncommitted work of a worktree without touching the
 *   user's index or working tree: the snapshot is built in a TEMPORARY index
 *   (read-tree HEAD, add --pathspec-from-file, write-tree, commit-tree), so no
 *   `git add -p` selection is lost and no hook runs. Never throws, bounded git
 *   timeouts, never commits on a protected branch.
 *
 *   Safety filters (savablePaths): in-progress git operations skip the whole
 *   save (merge/rebase/cherry-pick/revert/index.lock/unmerged paths); secrets
 *   (.env*, keys, credentials, dumps), build output, tooling state and files
 *   over 5 MB are left out and reported as `skipped`. A path that is, or lies
 *   under, a symlink or Windows junction inside the worktree is skipped as
 *   `link` — links are lstat'ed, never followed.
 *
 *   Used by substop.agent.wip (wipCommit: moves the agent's branch) and
 *   stop.session.autosave (snapshotCommit only: the session branch stays put).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dirtyPaths, loadHygiene } = require('./integration-check');

const T = 20000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PROTECTED = /^(main|master|develop|trunk|release\/.+)$/;
const SECRET = /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|\.htpasswd|id_(rsa|dsa|ecdsa|ed25519).*|kubeconfig.*|service-account[^/]*\.json|[^/]*\.(pem|key|p12|pfx|keystore|jks|sql|dump|bak|tfvars)|[^/]*\.tfstate[^/]*|[^/]*credentials[^/]*|[^/]*secret[^/]*|[^/]*token[^/]*)$/i;
const SECRET_CONTENT = /BEGIN [A-Z ]*PRIVATE KEY|aws_secret_access_key\s*[=:]|ghp_[A-Za-z0-9]{20,}|xox[bp]-[0-9A-Za-z-]{10,}/;
const BUILD_DIRS = new Set(['dist', 'build', 'out', 'coverage', 'node_modules', 'graphify-out', '.next', '.nuxt',
  'target', '.cache', '.venv', '__pycache__', '.gradle', '.turbo']);
const TOOLING_ROOT = /^(AUTONOMOUS|BACKLOG|BURN)[-_]/;

function git(args, cwd, { env, input, timeout } = {}) {
  try {
    return execFileSync('git', args, { windowsHide: true,
      cwd, encoding: 'utf8', timeout: timeout || T, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env, maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch { return null; }
}

/** origin's default branch when origin/HEAD is known, else null (unknown). */
function defaultBranch(cwd) {
  const sym = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  return sym ? sym.replace(/^origin\//, '') : null;
}

function isProtected(branch, cwd) {
  if (PROTECTED.test(branch)) return true;
  const def = defaultBranch(cwd);
  return Boolean(def) && branch === def;
}

/** Why a save must not run now (an operation is mid-flight), or null. */
function inProgress(wt) {
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'index.lock', 'BISECT_LOG']) {
    const p = git(['rev-parse', '--git-path', name], wt);
    if (p && fs.existsSync(path.resolve(wt, p))) return name;
  }
  const st = git(['status', '--porcelain=v1'], wt);
  if (st && /^(UU|AA|DD|AU|UA|DU|UD) /m.test(st)) return 'unmerged-paths';
  return null;
}

function identityArgs(cwd) {
  const a = [];
  if (!git(['config', 'user.name'], cwd)) a.push('-c', 'user.name=devops-autosave');
  if (!git(['config', 'user.email'], cwd)) a.push('-c', 'user.email=devops-autosave@localhost');
  return a;
}

/** `rel` is, or lies under, a symlink/junction within `wt` (lstat per component, never followed). */
function throughLink(wt, rel) {
  let cur = wt;
  for (const seg of rel.split('/').filter(Boolean)) {
    cur = path.join(cur, seg);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) return true;
    } catch { return false; /* missing (deleted): nothing below can be a link */ }
  }
  return false;
}

/** First 4 KB of the file look like a credential. */
function sniffSecret(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return SECRET_CONTENT.test(buf.toString('latin1', 0, n));
  } catch { return false; } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* none */ } }
  }
}

/**
 * The uncommitted paths that are safe to save, plus what was left out.
 * @returns {Promise<{paths:string[], skipped:{path:string, why:string}[]}>}
 */
async function savablePaths(wt, { timeout } = {}) {
  const hyg = await loadHygiene();
  const paths = [];
  const skipped = [];
  for (const p of dirtyPaths(wt, timeout)) {
    const rel = p.replace(/\\/g, '/');
    let why = null;
    if (throughLink(wt, rel)) why = 'link';
    else if (SECRET.test(rel)) why = 'secret';
    else if (rel.split('/').slice(0, -1).some((s) => BUILD_DIRS.has(s)) || TOOLING_ROOT.test(rel)) why = 'build/tooling';
    else if (hyg && (hyg.isToolingState(rel) || hyg.isRegenerable(rel))) why = 'build/tooling';
    else {
      try {
        const st = fs.lstatSync(path.join(wt, rel));
        if (st.isFile() && st.size > MAX_FILE_BYTES) why = 'large';
        else if (st.isFile() && st.size > 0 && sniffSecret(path.join(wt, rel))) why = 'secret';
      } catch { /* deleted file: keep */ }
    }
    if (why) skipped.push({ path: rel, why });
    else paths.push(p);
  }
  return { paths, skipped };
}

/**
 * Commit `paths` (working-tree state) on top of `parents` in a temporary
 * index. Returns the new commit sha or null. HEAD, index, tree untouched.
 */
function snapshotCommit(wt, paths, message, parents = ['HEAD'], timeout) {
  const idx = path.join(os.tmpdir(), `dotclaude-wip-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: idx, GIT_LITERAL_PATHSPECS: '1' };
  try {
    if (git(['read-tree', 'HEAD'], wt, { env, timeout }) === null) return null;
    if (paths.length && git(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], wt,
      { env, input: `${paths.join('\0')}\0`, timeout }) === null) return null;
    const tree = git(['write-tree'], wt, { env, timeout });
    if (!tree) return null;
    const pArgs = parents.flatMap((p) => ['-p', p]);
    return git([...identityArgs(wt), 'commit-tree', tree, ...pArgs, '-m', message], wt, { timeout });
  } finally {
    try { fs.unlinkSync(idx); } catch { /* none */ }
  }
}

/**
 * WIP-commit the savable changes of `wt` onto its checked-out branch: the
 * commit is built in a temporary index, the branch moved with update-ref, and
 * only then the real index realigned to the new HEAD (working tree untouched).
 * For a finished agent's worktree — nobody is mid-`git add -p` there.
 * detached: 'branch:<name>' creates that branch at HEAD first.
 * @returns {Promise<{committed:boolean, branch?:string, sha?:string, reason?:string, skipped?:object[]}>}
 */
async function wipCommit(wt, message, { detached } = {}) {
  try {
    const busy = inProgress(wt);
    if (busy) return { committed: false, reason: `in-progress:${busy}` };
    const { paths, skipped } = await savablePaths(wt);
    if (!paths.length) return { committed: false, reason: 'clean', skipped };
    let branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], wt);
    if (!branch) {
      const m = /^branch:(.+)$/.exec(detached || '');
      if (!m) return { committed: false, reason: 'detached' };
      if (git(['checkout', '-b', m[1]], wt) === null) return { committed: false, reason: 'checkout-failed' };
      branch = m[1];
    }
    if (isProtected(branch, wt)) return { committed: false, reason: 'protected', branch };
    const old = git(['rev-parse', 'HEAD'], wt);
    const sha = snapshotCommit(wt, paths, message);
    if (!sha) return { committed: false, reason: 'commit-failed', branch };
    if (git(['update-ref', '-m', 'wip', `refs/heads/${branch}`, sha, old], wt) === null) {
      return { committed: false, reason: 'update-ref-failed', branch };
    }
    // realign the index with the new HEAD; one retry, and say so when it fails
    const synced = git(['read-tree', 'HEAD'], wt) !== null || git(['read-tree', 'HEAD'], wt) !== null;
    return { committed: true, branch, sha, skipped, indexSynced: synced };
  } catch {
    return { committed: false, reason: 'error' };
  }
}

module.exports = { wipCommit, snapshotCommit, savablePaths, inProgress, isProtected, defaultBranch, git, MAX_FILE_BYTES };
