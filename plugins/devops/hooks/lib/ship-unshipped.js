/**
 * @module ship-unshipped
 * @version 0.1.0
 * @plugin devops
 * @description Does the checked-out branch carry work that is not on the
 *   default branch yet? `prompt.ship.detect` asks this for one decision only:
 *   a PROMOTION prompt ("promote stable", "auf beta heben") on a branch with
 *   nothing unshipped is a promotion-only do-ship run — a handful of calls
 *   (ls-remote, ship_promote, the card) instead of the ~16 of a ship — so the
 *   careful-compact stop does not apply to it. When anything is unshipped the
 *   run ships first and the stop applies as for any ship.
 *
 *   "Unshipped" = tracked changes in the work tree, OR a file the branch
 *   changed since the merge-base whose content differs from the default
 *   branch. The second test compares content, not ancestry, so a branch whose
 *   work already landed through a SQUASH merge (keep-mode worktree) reads as
 *   shipped — an ancestry count (`rev-list origin/main..HEAD`) would call it
 *   unshipped forever.
 *
 *   Fail-safe: any git error (no origin, no default branch, timeout) answers
 *   `true` — the conservative answer keeps the compact stop in place.
 */

const { execFileSync } = require('child_process');

const GIT_TIMEOUT_MS = 3000;

/** Default git runner: stdout as a string, throws on non-zero exit. */
function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * The remote default branch as a ref (`origin/main`), or null.
 * @param {string} cwd
 * @param {(cwd:string, args:string[]) => string} git
 */
function defaultBranchRef(cwd, git) {
  try {
    const ref = git(cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).trim();
    if (ref && ref !== 'origin/HEAD') return ref;
  } catch { /* origin/HEAD not set — try the usual names */ }
  // Local branches last: a repo without an origin lands its ships on the
  // local default branch (ship_release's local merge), so that is the base.
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    try { git(cwd, ['rev-parse', '--verify', '--quiet', name]); return name; } catch { /* next */ }
  }
  return null;
}

/**
 * True when the branch in `cwd` has work that is not on the default branch.
 * @param {string} cwd
 * @param {{ git?: (cwd:string, args:string[]) => string }} [opts] injectable runner (tests)
 * @returns {boolean}
 */
function hasUnshippedWork(cwd, opts = {}) {
  const git = typeof opts.git === 'function' ? opts.git : runGit;
  try {
    if (git(cwd, ['status', '--porcelain', '--untracked-files=no']).trim()) return true;
    const base = defaultBranchRef(cwd, git);
    if (!base) return true;
    const changed = git(cwd, ['diff', '--name-only', `${base}...HEAD`]).trim();
    if (!changed) return false;
    const files = changed.split(/\r?\n/).filter(Boolean);
    // `git diff --quiet` exits 1 when the contents differ → execFileSync throws.
    try {
      git(cwd, ['diff', '--quiet', base, 'HEAD', '--', ...files]);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

module.exports = { hasUnshippedWork, defaultBranchRef, GIT_TIMEOUT_MS };
