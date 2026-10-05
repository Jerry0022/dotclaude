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

/** Entries a session may be told about: ready, unexpired, for this repo (cwd match) or unscoped. */
function readyFor(entries, now, cfg, cwd) {
  return entries.filter((e) => e.status === 'ready' && !isExpired(e, now, cfg) && (!cwd || !e.cwd || e.cwd === cwd))
    .sort((a, b) => a.created_at - b.created_at);
}

function save(dir, e) { writeJson(path.join(dir, `${e.id}.json`), e); }
function list(dir) { return readDir(dir).map((x) => x.data).filter((e) => e && e.id); }
function remove(dir, id) { return removeFile(path.join(dir, `${id}.json`)); }

module.exports = { newEntry, isExpired, markReady, starving, readyFor, save, list, remove };
