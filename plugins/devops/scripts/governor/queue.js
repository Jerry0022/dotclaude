/**
 * @module governor/queue
 * @description The watcher's queue of deferred heavy commands. Each entry
 *   carries the state it was queued in (cwd, branch, HEAD); before it runs
 *   the watcher re-reads that state — a moved branch, a new commit or a
 *   deleted worktree means skip + log, never a run against different code.
 *   Entries expire after 24 h. Decisions are pure; the fs helpers are thin.
 */
'use strict';

const path = require('path');
const { writeJson, readDir, removeFile } = require('./state');

function newId(now) { return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

function newEntry({ command, shell, cwd, branch, head, sessionId, kind, reason, now }) {
  return {
    id: newId(now), command, shell: shell || 'bash', cwd, branch: branch || null, head: head || null,
    sessionId: sessionId || null, kind: kind || null, reason: reason || null,
    created_at: now, status: 'queued', starvationNotified: false,
  };
}

function isExpired(e, now, cfg) { return now - (e.created_at || 0) >= cfg.queueExpiryMs; }

/**
 * @param {object} e entry
 * @param {{exists:boolean, branch:string|null, head:string|null}} cur state of e.cwd now
 * @returns {{ok:boolean, reason?:string}}
 */
function driftCheck(e, cur) {
  if (!cur || !cur.exists) return { ok: false, reason: 'worktree-gone' };
  if (e.branch && cur.branch !== e.branch) return { ok: false, reason: `branch-changed:${e.branch}->${cur.branch}` };
  if (e.head && cur.head !== e.head) return { ok: false, reason: `head-moved:${String(e.head).slice(0, 8)}->${String(cur.head || '').slice(0, 8)}` };
  return { ok: true };
}

/** Oldest queued, unexpired entry (FIFO). */
function pickNext(entries, now, cfg) {
  return entries.filter((e) => e.status === 'queued' && !isExpired(e, now, cfg))
    .sort((a, b) => a.created_at - b.created_at)[0] || null;
}

function starving(e, now, cfg) { return e.status === 'queued' && !e.starvationNotified && now - e.created_at >= cfg.starvationMs; }

function save(dir, e) { writeJson(path.join(dir, `${e.id}.json`), e); }
function list(dir) { return readDir(dir).map((x) => x.data).filter((e) => e && e.id); }
function remove(dir, id) { return removeFile(path.join(dir, `${id}.json`)); }
function logFile(dir, id) { return path.join(dir, 'logs', `${id}.log`); }

module.exports = { newEntry, isExpired, driftCheck, pickNext, starving, save, list, remove, logFile };
