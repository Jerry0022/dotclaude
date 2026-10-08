'use strict';
/**
 * @module channel-pin
 * @version 0.1.0
 * @plugin devops
 * @description Repair-then-pin of a marketplace clone onto a channel tag, for
 *   ss.plugin.update (ring model, spec §5.2).
 *
 *   The hook used to run `reset --hard` / `clean -fd` / `checkout --detach`
 *   through a wrapper that swallowed every error. On 2026-10-08 a 0-byte
 *   `index.lock` a killed git left 2 h earlier failed all three: the right tag
 *   was resolved, HEAD never moved, and the hook printed nothing — the
 *   post-ship finalizer retried three times without a cause. Now:
 *     - a stale lock (stale-index-lock.js) is removed first, and said so;
 *     - when HEAD is not on the target afterwards, ONE line names the tag,
 *       where HEAD stayed, git's own error and — if a lock is still there —
 *       why it was left.
 *
 *   NEVER pulls: on a detached HEAD that is an ancestor of main, --ff-only
 *   would fast-forward to the alpha tip and defeat the pin (R2).
 */

const path = require('path');
const { gitRunner, firstErrorLine } = require('./git-sync-recover');
const { releaseStaleIndexLock, describeKeptLock } = require('./stale-index-lock');

const PIN_TIMEOUT_MS = 15_000;

/**
 * @param {{dir:string, tag:string, targetSha:string, report?:(msg:string)=>void,
 *   timeoutMs?:number, now?:number, listGitProcesses?:Function}} o
 *   `report` gets each user-facing line without a prefix (the hook adds it).
 * @returns {{ok:boolean, head:string, error:string, lock:object|null}}
 */
function pinToTag({ dir, tag, targetSha, report = () => {}, timeoutMs = PIN_TIMEOUT_MS, now, listGitProcesses }) {
  const git = gitRunner({ cwd: dir, timeoutMs });

  let lock = null;
  const gd = git(['rev-parse', '--absolute-git-dir']);
  if (gd.ok && gd.out.trim()) {
    const opts = { gitDir: path.resolve(gd.out.trim()) };
    if (now != null) opts.now = now;
    if (listGitProcesses) opts.listGitProcesses = listGitProcesses;
    lock = releaseStaleIndexLock(opts);
    if (lock.status === 'removed') {
      report(`removed stale index.lock (0 bytes, ${Math.round(lock.ageMs / 60_000)} min old, no git process holding it) — ${lock.lock}`);
    }
  }

  const reset = git(['reset', '--hard']);
  const clean = git(['clean', '-fd']);
  const checkout = git(['checkout', '--detach', tag]);
  const headRes = git(['rev-parse', 'HEAD']);
  const head = headRes.ok ? headRes.out.trim() : '';
  if (head && head === targetSha) return { ok: true, head, error: '', lock };

  const error = firstErrorLine(checkout.err || checkout.out)
    || firstErrorLine(reset.err) || firstErrorLine(clean.err)
    || (checkout.timedOut ? 'git checkout timed out' : 'HEAD did not move');
  const at = head
    ? ((git(['describe', '--tags', '--exact-match', 'HEAD']).out || '').trim().split(/\r?\n/)[0] || head.slice(0, 7))
    : 'unknown';
  let line = `pin to ${tag} failed — HEAD stays on ${at}: ${error}`;
  if (lock && lock.status !== 'removed' && lock.status !== 'absent') {
    const kept = describeKeptLock(lock);
    if (kept) line += `; ${kept}`;
  }
  report(line);
  return { ok: false, head, error, lock };
}

module.exports = { pinToTag, PIN_TIMEOUT_MS };
