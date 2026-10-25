'use strict';
/**
 * @module frustration-state
 * @version 0.1.0
 * @plugin devops
 * @feature frustrated-mode (alpha)
 * @description Per-session state of the frustration detector, kept in
 *   os.tmpdir() like the other hook state (lib/session-id.js). The detector
 *   hook writes it; `do-run` asks `isSessionFlagged(sessionId)` whether the
 *   session is flagged right now. A state older than 2 hours counts as gone.
 */

const fs = require('fs');
const { sessionFile, writeSessionFile } = require('./session-id');
const { isFlagged, emptyState } = require('./frustration-detect');

const PREFIX = 'dotclaude-devops-frustration';
const EXPIRY_MS = 2 * 60 * 60 * 1000;

function pathFor(sessionId, opts = {}) {
  return opts.file || sessionFile(PREFIX, sessionId);
}

/** Read the state; null when missing, corrupt or older than 2 h. */
function readState(sessionId, opts = {}) {
  try {
    const st = JSON.parse(fs.readFileSync(pathFor(sessionId, opts), 'utf8'));
    const now = opts.nowMs || Date.now();
    if (!st || typeof st !== 'object' || !st.updatedAt || now - st.updatedAt > EXPIRY_MS) return null;
    return { ...emptyState(), ...st };
  } catch { return null; }
}

function writeState(sessionId, state, opts = {}) {
  try { writeSessionFile(pathFor(sessionId, opts), JSON.stringify(state)); return true; } catch { return false; }
}

/**
 * Is the session flagged now? This session's file only — a foreign session's
 * state must not steer this one.
 * @param {string} sessionId
 * @param {{file?:string, nowMs?:number}} [opts]
 */
function isSessionFlagged(sessionId, opts = {}) {
  if (!sessionId && !opts.file) return false;
  const st = readState(sessionId, opts);
  return !!st && isFlagged(st, { ignoreCooldown: true });
}

module.exports = { readState, writeState, isSessionFlagged, pathFor, EXPIRY_MS, PREFIX };
