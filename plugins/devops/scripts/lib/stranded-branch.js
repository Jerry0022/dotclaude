'use strict';
/**
 * @module scripts/lib/stranded-branch
 * @version 0.1.0
 * @plugin devops
 * @description A STRANDED branch: pushed to origin, commits whose CONTENT is
 *   not in the default branch (scripts/lib/content-landed.js - not `git
 *   cherry`, which cannot see a squash merge) and no open PR (#951). A fix
 *   that sits there is lost to everyone who does not happen to look: its
 *   session is gone, or the worktree moved on to another branch.
 *
 *   Shared by the session-archive guard (hooks/lib/session-archive-gate.js),
 *   ship_preflight (a worktree that left such a branch behind) - and the same
 *   rule `ship_hygiene` applies machine-wide through its landing state.
 *
 *   Silent by design: every unknown (no gh, offline, no origin, git error)
 *   answers null / [] - a warning that cannot be proven is never raised.
 */

const { execFileSync } = require('child_process');
const { contentInBase } = require('./content-landed');

const GIT_TIMEOUT = 8000;
const GH_TIMEOUT = 8000;
/** How many of the branches this worktree recently left are checked (one gh call each). */
const MAX_LEFT_BEHIND = 3;
const REFLOG_ENTRIES = 40;

function git(cwd, args) {
  try {
    return execFileSync('git', args, { windowsHide: true, cwd, encoding: 'utf8', timeout: GIT_TIMEOUT,
      stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

/** `refs/remotes/origin/<default>`, or null. */
function baseRef(cwd) {
  const head = git(cwd, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  if (head && git(cwd, ['rev-parse', '--verify', '-q', head])) return head;
  for (const n of ['main', 'master']) {
    const ref = `refs/remotes/origin/${n}`;
    if (git(cwd, ['rev-parse', '--verify', '-q', ref])) return ref;
  }
  return null;
}

/** PRs (any state) whose head is `branch`; null when gh is missing, offline or unauthenticated. */
function ghPrs(cwd, branch) {
  try {
    const out = execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '20',
      '--json', 'number,state,headRefOid'], { windowsHide: true, cwd, encoding: 'utf8', timeout: GH_TIMEOUT,
      stdio: ['ignore', 'pipe', 'ignore'] });
    const list = JSON.parse(out);
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}

/**
 * @param {string} cwd  any checkout of the repo
 * @param {string} branch  local branch name
 * @param {{prs?:(cwd:string, branch:string)=>object[]|null}} [opts]  `prs` injectable for tests
 * @returns {{branch:string, sha:string, commits:number}|null}  null = not stranded or not provable
 */
function strandedBranch(cwd, branch, opts = {}) {
  if (!cwd || !branch || branch === 'HEAD' || branch.startsWith('-')) return null;
  const base = baseRef(cwd);
  if (!base || base === `refs/remotes/origin/${branch}`) return null;
  const tip = git(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
  if (!tip) return null;
  const remote = git(cwd, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]);
  if (!remote || git(cwd, ['merge-base', '--is-ancestor', tip, remote]) === null) return null; // not pushed
  if (contentInBase(cwd, tip, base).landed) return null;
  const prs = (opts.prs || ghPrs)(cwd, branch);
  if (!Array.isArray(prs)) return null;
  if (prs.some((p) => p && (p.state === 'OPEN' || (p.state === 'MERGED' && p.headRefOid === tip)))) return null;
  const n = Number(git(cwd, ['rev-list', '--count', `${base}..${tip}`]));
  return { branch, sha: tip, commits: Number.isFinite(n) ? n : 0 };
}

/**
 * Branches this work tree checked out before `current` (HEAD reflog "moving
 * from A to B") that are stranded. At most MAX_LEFT_BEHIND are examined.
 * @returns {{branch:string, sha:string, commits:number}[]}
 */
function leftBehindBranches(cwd, current, opts = {}) {
  const log = git(cwd, ['reflog', 'show', '--format=%gs', `-n${REFLOG_ENTRIES}`, 'HEAD']);
  if (!log) return [];
  const seen = new Set([current, 'main', 'master', 'HEAD']);
  const out = [];
  let examined = 0;
  for (const line of log.split('\n')) {
    const m = /^checkout: moving from (\S+) to \S+$/.exec(line.trim());
    if (!m || seen.has(m[1]) || /^[0-9a-f]{7,40}$/.test(m[1])) continue;
    seen.add(m[1]);
    if (examined++ >= MAX_LEFT_BEHIND) break;
    const s = strandedBranch(cwd, m[1], opts);
    if (s) out.push(s);
  }
  return out;
}

module.exports = { strandedBranch, leftBehindBranches, baseRef };
