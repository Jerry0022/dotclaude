/**
 * @module governor/queue
 * @description Deferred heavy commands. The governor does NOT run them
 *   (running detached would bypass Claude's permission prompts and could run
 *   against a stale working tree — deliberate spec change, see
 *   deep-knowledge/load-governor.md). It only RECORDS them; when headroom
 *   returns the watcher marks an entry `ready`, and a UserPromptSubmit /
 *   SessionStart hook tells the session (or the next session in the same
 *   repo) that it can re-run them under normal permissions. Each entry keeps
 *   the cwd/branch/HEAD it was deferred at as drift context for Claude.
 *   Entries expire after 24 h. Decisions are pure; the fs helpers are thin.
 */
'use strict';

const path = require('path');
const { writeJson, readDir, removeFile } = require('./state');

function newId(now) { return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

function newEntry({ command, cwd, branch, head, sessionId, kind, reason, now }) {
  return {
    id: newId(now), command, cwd: cwd || null, branch: branch || null, head: head || null,
    sessionId: sessionId || null, kind: kind || null, reason: reason || null,
    created_at: now, status: 'queued', starvationNotified: false,
  };
}

function isExpired(e, now, cfg) { return now - (e.created_at || 0) >= cfg.queueExpiryMs; }

/** Mark an entry ready to re-run (headroom returned). Idempotent. */
function markReady(e, now) { return { ...e, status: 'ready', readyAt: now }; }

function starving(e, now, cfg) { return e.status !== 'ready' && !e.starvationNotified && now - e.created_at >= cfg.starvationMs; }

/**
 * Entries a session may be told about: ready and unexpired; the deferring
 * session gets its own, another session in the same cwd only once the
 * deferring session is gone. De-duplicated by command + cwd.
 * @param {{cwd?:string, sessionId?:string, liveSessions?:Set<string>}} who
 */
function readyFor(entries, now, cfg, who = {}) {
  const live = who.liveSessions || new Set();
  const seen = new Set();
  return entries.filter((e) => e.status === 'ready' && !isExpired(e, now, cfg))
    .filter((e) => (e.sessionId && e.sessionId === who.sessionId)
      || ((!who.cwd || !e.cwd || e.cwd === who.cwd) && !(e.sessionId && live.has(e.sessionId))))
    .sort((a, b) => a.created_at - b.created_at)
    .filter((e) => { const k = `${e.cwd}\n${e.command}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function save(dir, e) { writeJson(path.join(dir, `${e.id}.json`), e); }

/** Record a deferral; the same command + cwd already recorded is reused (back to `queued`), never duplicated. */
function record(dir, e, now, cfg) {
  const dup = list(dir).find((x) => x.command === e.command && x.cwd === e.cwd && !isExpired(x, now, cfg));
  const out = dup ? { ...dup, status: 'queued', sessionId: e.sessionId || dup.sessionId, reason: e.reason } : e;
  save(dir, out);
  return out;
}
function list(dir) { return readDir(dir).map((x) => x.data).filter((e) => e && e.id); }
function remove(dir, id) { return removeFile(path.join(dir, `${id}.json`)); }

module.exports = { newEntry, isExpired, markReady, starving, readyFor, record, save, list, remove };
