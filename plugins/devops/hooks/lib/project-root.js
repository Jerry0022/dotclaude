'use strict';
/**
 * @module project-root
 * @version 0.2.0
 * @plugin devops
 * @description Anchor for every PROJECT-rooted `.claude/` runtime file.
 *
 *   Hooks receive the session's CURRENT cwd, and that follows every `cd` the
 *   session makes. A writer that joins `cwd + '.claude'` therefore creates
 *   `plugins/devops/.claude/batch-activity`, `plugins/devops/scripts/.claude/…`
 *   and so on — untracked files the ignore block (anchored at `/.claude/`) does
 *   not cover, which dirty the worktree, fail /do-ship preflight's clean-tree
 *   check and block archiving the Desktop session. Observed 2026-09-23.
 *
 *   `projectRoot(cwd)` is the git work-tree root that contains `cwd` — the same
 *   directory `git rev-parse --show-toplevel` prints, including for a linked
 *   worktree (whose `.git` is a file). Pure fs walk, no git spawn: this runs on
 *   hook hot paths (every prompt touches the batch activity clock).
 *
 *   Falls back to `cwd` itself when no work tree encloses it, and when the only
 *   enclosing one is a repo rooted at the home directory (a dotfiles repo in
 *   `~`): anchoring there would put per-project state into the user's global
 *   `~/.claude/` and share it between every unrelated folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Path equality the way the OS sees it (win32 ignores case). */
function samePath(a, b) {
  const na = path.resolve(a), nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * Nearest enclosing git work tree root of `cwd` — the directory holding `.git`
 * (a dir for a primary checkout, a FILE for a linked worktree). Never throws.
 * @returns {string|null} absolute root, or null when no `.git` sits on the path
 */
function findRepoRoot(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  try {
    let dir = path.resolve(cwd);
    for (;;) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null; // filesystem root reached
      dir = parent;
    }
  } catch {
    return null;
  }
}

/**
 * Directory that owns project-rooted `.claude/` state for `cwd`.
 * @param {string} [cwd] defaults to process.cwd()
 * @returns {string} absolute path — never null
 */
function projectRoot(cwd) {
  const start = path.resolve(cwd || process.cwd());
  const root = findRepoRoot(start);
  if (!root) return start;
  try {
    if (samePath(root, os.homedir()) && !samePath(start, root)) return start;
  } catch { /* no home dir — keep the repo root */ }
  return root;
}

/** `<projectRoot(cwd)>/.claude` */
function projectClaudeDir(cwd) {
  return path.join(projectRoot(cwd), '.claude');
}

/**
 * The git common dir of the work tree enclosing `cwd` — the main checkout's
 * `.git`, also from a linked worktree (its `.git` file names the worktree's
 * admin dir, whose `commondir` file points back). What every worktree of a
 * clone shares: `info/exclude`, refs, config. Pure fs, never throws.
 * @returns {string|null} absolute path, or null outside a work tree
 */
function gitCommonDir(cwd) {
  const root = findRepoRoot(cwd);
  if (!root) return null;
  const dotGit = path.join(root, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    const gitDir = path.resolve(root, m[1]);
    try {
      return path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
    } catch {
      return gitDir; // no commondir file: the admin dir is the common dir itself
    }
  } catch {
    return null;
  }
}

module.exports = { findRepoRoot, projectRoot, projectClaudeDir, samePath, gitCommonDir };
