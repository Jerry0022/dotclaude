'use strict';
/**
 * @module git-sync-recover
 * @version 0.1.0
 * @plugin devops
 * @description Undo what a failed background merge already wrote, for
 *   scripts/git-sync.js.
 *
 *   `git merge` writes the working tree first, then the index, then HEAD. A
 *   merge that dies in between — killed by git-sync's own timeout, or failing
 *   by itself on a file it cannot write (a smudge filter, a Windows file lock)
 *   — leaves HEAD and the index on the old commit while part of the incoming
 *   tree is already on disk: modified files, files unlinked on the way to a
 *   rewrite, new files, and on Windows (TerminateProcess, no cleanup) a stale
 *   `index.lock` that fails every later git write in that worktree. Observed
 *   2026-09-26 on a loaded machine: a fast-forward killed by the 15 s budget,
 *   reported only as "merge refused, no conflicted files".
 *
 *   Everything here is conservative. A path is put back only when its content
 *   is exactly what the merge would have written (the source's blob), or when
 *   it is gone while preHead has it (nothing is lost: preHead holds it).
 *   git-sync merges only when no incoming path is dirty (dirtyOverlap), so any
 *   other deviation — content matching neither side — may be the user's and is
 *   left alone and reported. A lock is removed only when the merge child this
 *   process killed is the one that can have left it.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Filesystem timestamp slack when telling "created during the merge" from "older". */
const LOCK_SLACK_MS = 2000;
/** Paths per `git checkout` / `git rm` call — stays far below Windows' command-line limit. */
const PATH_CHUNK = 100;
const WRITE_TIMEOUT_DEFAULT_MS = 5 * 60_000;
const WRITE_TIMEOUT_MAX_MS = 30 * 60_000;
const ZERO_ID = /^0+$/;
const GITLINK = '160000';
const SYMLINK = '120000';

/**
 * The ceiling for git-sync's writing calls (merge, abort, add, commit and the
 * repair below). A writer killed mid-write is worse than a slow background
 * sync — nobody waits on it — so it gets far more than the 15 s read budget:
 * DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS (any positive ms, capped at 30 min; the
 * integration tests use it to force a kill), else max(read budget, 5 min).
 * Still finite: a hung filter process must not hold the index lock forever.
 * @param {object} env process.env
 * @param {number} readTimeoutMs git-sync's per-call read budget
 */
function writeTimeoutMs(env, readTimeoutMs) {
  const n = Number(env && env.DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return Math.min(n, WRITE_TIMEOUT_MAX_MS);
  return Math.max(Number(readTimeoutMs) || 0, WRITE_TIMEOUT_DEFAULT_MS);
}

/**
 * A git runner that keeps what a bare `string | null` wrapper throws away:
 * stdout (untrimmed — `-z` output must stay intact), stderr, and whether the
 * timeout killed the child. argv form + windowsHide, never a shell string
 * (git-sync runs detached and console-less; see git-sync.js git()).
 * @param {{cwd:string, timeoutMs:number}} opts
 * @returns {(args:string[], o?:{input?:string}) => {ok:boolean, out:string, err:string, timedOut:boolean}}
 */
function gitRunner({ cwd, timeoutMs }) {
  return (args, o = {}) => {
    try {
      const out = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        input: o.input,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      return { ok: true, out: String(out), err: '', timedOut: false };
    } catch (e) {
      return {
        ok: false,
        out: String((e && e.stdout) || ''),
        err: String((e && e.stderr) || ''),
        timedOut: !!e && e.code === 'ETIMEDOUT',
      };
    }
  };
}

/** git's own reason, one line: the first `fatal:` / `error:` line, else the first line. */
function firstErrorLine(stderr, max = 160) {
  const lines = String(stderr || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const line = lines.find(l => /^(fatal|error):/i.test(l)) || lines[0] || '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Where HEAD stands after a failed merge: 'unchanged' (still preHead — the
 * case to repair), 'completed' (the merge landed before it was stopped: HEAD
 * moved and contains the source), 'moved' (something else moved it — hands
 * off) or 'unknown'.
 */
function headState(run, preHead, source) {
  const head = run(['rev-parse', '--verify', '--quiet', 'HEAD']);
  const now = head.ok ? head.out.trim() : '';
  if (!now) return 'unknown';
  if (now === preHead) return 'unchanged';
  return run(['merge-base', '--is-ancestor', source, 'HEAD']).ok ? 'completed' : 'moved';
}

/**
 * Remove the index.lock the killed merge child left behind — and no other.
 * git removes its own lock on every exit it gets to run (an error, and on
 * POSIX a SIGTERM too); only a child killed without cleanup (Windows
 * TerminateProcess) leaves one. So: only after a timeout, and only a lock
 * written after the merge started — an older one belongs to someone else (the
 * merge could not have run past it).
 * @returns {'absent'|'removed'|'held'}
 */
function releaseKilledIndexLock({ gitDir, startedAt, timedOut }) {
  const lock = path.join(gitDir, 'index.lock');
  let st;
  try { st = fs.statSync(lock); } catch { return 'absent'; }
  if (!timedOut || st.mtimeMs < startedAt - LOCK_SLACK_MS) return 'held';
  try { fs.unlinkSync(lock); return 'removed'; } catch { return 'held'; }
}

/**
 * The paths the merge can have written, each with its blob at preHead and at
 * the source. Three-dot names the source side's changes since the merge base
 * (what a merge writes — a fast-forward's whole diff); two-dot only supplies
 * the two blob ids to compare the working tree against.
 * @returns {Array<{file:string, headId:string|null, srcId:string|null, headMode:string, srcMode:string}>|null}
 */
function incomingPaths(run, preHead, source) {
  const names = run(['diff', '--name-only', '-z', '--no-renames', `${preHead}...${source}`]);
  const raw = run(['diff', '--raw', '-z', '--no-abbrev', '--no-renames', preHead, source]);
  if (!names.ok || !raw.ok) return null;
  const wanted = new Set(names.out.split('\0').filter(Boolean));
  const out = [];
  const parts = raw.out.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]/.exec(parts[i]);
    const file = parts[i + 1];
    if (!m || !file || !wanted.has(file)) continue;
    out.push({
      file,
      headMode: m[1],
      srcMode: m[2],
      headId: ZERO_ID.test(m[3]) ? null : m[3],
      srcId: ZERO_ID.test(m[4]) ? null : m[4],
    });
  }
  return out;
}

function isAttributes(file) {
  return path.posix.basename(file) === '.gitattributes';
}

function chunks(list, size = PATH_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Unlink a file the merge added, then any directory it leaves empty (never `top` itself). */
function removeAdded(top, file) {
  const abs = path.join(top, file);
  try { fs.unlinkSync(abs); } catch { return false; }
  let dir = path.dirname(abs);
  while (path.relative(top, dir) && !path.relative(top, dir).startsWith('..')) {
    try { fs.rmdirSync(dir); } catch { break; } // not empty (or gone): stop
    dir = path.dirname(dir);
  }
  return true;
}

function dirtyAgainst(run, preHead) {
  // The working tree against preHead, tracked side: the index's stat cache
  // answers for every untouched file, so nothing the merge never reached is
  // re-hashed (a re-hash under different eol settings would misread it).
  const r = run(['diff', '--name-only', '-z', '--no-renames', preHead]);
  return r.ok ? new Set(r.out.split('\0').filter(Boolean)) : null;
}

/**
 * Put every incoming path the failed merge already wrote back to preHead.
 * HEAD must still be preHead (headState 'unchanged') and the index lock free.
 *
 * - content equal to the source's blob → the merge's write: restored from
 *   preHead, or deleted when the source added the file;
 * - gone while preHead has it → the source's deletion, or unlinked on the
 *   way to a rewrite: restored;
 * - anything else → possibly the user's: untouched, returned in `manual`.
 * `.gitattributes` goes back first, so the files restored next are written
 * with preHead's filters and eol settings, not the incoming ones.
 *
 * @param {{run:Function, top:string, preHead:string, source:string}} o
 * @returns {{restored:string[], removed:string[], manual:string[], error?:string}}
 */
function restoreIncomingTree({ run, top, preHead, source }) {
  const result = { restored: [], removed: [], manual: [] };
  const incoming = incomingPaths(run, preHead, source);
  if (!incoming) return { ...result, error: 'incoming diff unreadable' };
  // A merge never rewrites a submodule's checkout, only its gitlink entry.
  const relevant = incoming.filter(c => c.headMode !== GITLINK && c.srcMode !== GITLINK);
  if (!relevant.length) return result;

  const dirty = dirtyAgainst(run, preHead);
  if (!dirty) return { ...result, error: 'worktree state unreadable' };

  const touched = [];
  for (const c of relevant) {
    let st = null;
    try { st = fs.lstatSync(path.join(top, c.file)); } catch { /* absent */ }
    // A file the source adds is untracked until the index is written: on
    // disk means the merge got to it. A tracked one shows up in the diff.
    if (c.headId === null ? (st || dirty.has(c.file)) : dirty.has(c.file)) touched.push({ ...c, st });
  }
  if (!touched.length) return result;

  const hashable = touched.filter(t => t.st && t.st.isFile() && !t.st.isSymbolicLink()
    && t.headMode !== SYMLINK && t.srcMode !== SYMLINK && !t.file.includes('\n'));
  const ids = new Map();
  if (hashable.length) {
    // Clean filters and eol conversion apply per path — the same attributes
    // the merge wrote these files with, since .gitattributes is still as the
    // merge left it at this point.
    const h = run(['hash-object', '--stdin-paths'], { input: `${hashable.map(t => t.file).join('\n')}\n` });
    const list = h.ok ? h.out.split('\n').map(s => s.trim()).filter(Boolean) : [];
    if (list.length === hashable.length) hashable.forEach((t, i) => ids.set(t.file, list[i]));
  }

  const restore = [];
  const unlink = [];
  for (const t of touched) {
    if (!t.st) {
      // Gone from disk: preHead's file comes back; an added file the index
      // alone still lists (written before the kill) leaves the index.
      if (t.headId) restore.push(t);
      else unlink.push(t);
      continue;
    }
    const id = ids.get(t.file);
    if (id && id === t.srcId) (t.headId ? restore : unlink).push(t);
    else if (!(id && id === t.headId)) result.manual.push(t.file);
  }

  // .gitattributes first (phase true), then everything else.
  for (const attrsPhase of [true, false]) {
    for (const t of unlink.filter(x => isAttributes(x.file) === attrsPhase)) removeAdded(top, t.file);
    const back = restore.filter(x => isAttributes(x.file) === attrsPhase).map(x => x.file);
    for (const part of chunks(back)) run(['--literal-pathspecs', 'checkout', preHead, '--', ...part]);
  }
  // An index written before the kill (rare: git writes it after the tree)
  // may still list a removed file.
  const indexed = unlink.filter(t => dirty.has(t.file)).map(t => t.file);
  for (const part of chunks(indexed)) run(['--literal-pathspecs', 'rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...part]);

  // Verified, not assumed: whatever did not go back is named for manual repair.
  const after = dirtyAgainst(run, preHead);
  for (const t of restore) {
    if (after && !after.has(t.file) && fs.existsSync(path.join(top, t.file))) result.restored.push(t.file);
    else result.manual.push(t.file);
  }
  for (const t of unlink) {
    if (after && !after.has(t.file) && !fs.existsSync(path.join(top, t.file))) result.removed.push(t.file);
    else result.manual.push(t.file);
  }
  return result;
}

module.exports = {
  LOCK_SLACK_MS,
  WRITE_TIMEOUT_DEFAULT_MS,
  WRITE_TIMEOUT_MAX_MS,
  writeTimeoutMs,
  gitRunner,
  firstErrorLine,
  headState,
  releaseKilledIndexLock,
  incomingPaths,
  restoreIncomingTree,
};
