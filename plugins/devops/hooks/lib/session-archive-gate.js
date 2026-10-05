'use strict';
/**
 * @module session-archive-gate
 * @version 0.1.0
 * @plugin devops
 * @description The hook side of "archive the Desktop session after a
 *   successful ship" (#632). The completion MCP decides per card
 *   (mcp-server/lib/session-archive.js) and writes the archive flag; the hooks
 *   own every check that needs the REAL session id or the current state:
 *
 *   - post.flow.completion records a merged ship_release of this session
 *     (SHIPPED_FLAG), adopts the flag onto the real id only for the same work
 *     tree, and on the card widget releases exactly one archive call
 *     (`releaseArchive`) — only with the ship evidence, the same work tree,
 *     a still-clean tree, and a fresh flag. Anything else drops the flag.
 *   - pre.session.archive denies archive_session on this session unless the
 *     hand-over released it (or the user's own prompt asked for an archive).
 *   - prompt.flow.silent-turn drops every archive flag on a new user prompt.
 *
 *   Fail closed throughout: an unreadable flag, tree or path never archives.
 */

const fs = require('fs');
const path = require('path');
const { sessionFile, writeSessionFile } = require('./session-id');
const { findRepoRoot, samePath } = require('./project-root');
const { gitRun } = require('./git-timeout');

/** Written by the completion MCP (keyed by the model-supplied id), adopted onto the real id. */
const FLAG = 'dotclaude-devops-card-archive';
/** The released hand-over: exactly one archive call of this session may run. */
const RELEASED_FLAG = 'dotclaude-devops-card-archive-released';
/** A merged ship_release this session saw (real id) — the evidence the hook itself holds. */
const SHIPPED_FLAG = 'dotclaude-devops-archive-shipped';
/** A flag older than this belongs to a card nobody showed — never archive on it. */
const FLAG_MAX_AGE_MS = 60 * 60 * 1000;
const ARCHIVE_TOOL_RE = /(?:^|__)ccd_session_mgmt__archive_session$/;

/**
 * Clean work tree: no tracked change, no untracked file. Ignored files are
 * accepted (the user's local config). Missing or unreadable cwd → false.
 * @param {string} cwd
 */
function treeClean(cwd) {
  if (!cwd || typeof cwd !== 'string') return false;
  try {
    if (!fs.statSync(cwd).isDirectory()) return false;
    return gitRun(cwd, ['status', '--porcelain', '--untracked-files=all']).trim() === '';
  } catch {
    return false;
  }
}

/** Do both paths sit in the same git work tree? Unresolvable → false. */
function sameWorkTree(a, b) {
  if (!a || !b) return false;
  try {
    const ra = findRepoRoot(path.resolve(a));
    const rb = findRepoRoot(path.resolve(b));
    return !!ra && !!rb && samePath(ra, rb);
  } catch {
    return false;
  }
}

/** The flag stamp the MCP writes: { cwd, nonce, ts }. Null when absent or unreadable. */
function readStamp(file) {
  try {
    const stamp = JSON.parse(fs.readFileSync(file, 'utf8'));
    return stamp && typeof stamp.cwd === 'string' && stamp.cwd ? stamp : null;
  } catch {
    return null;
  }
}

/** Does the flag at `file` belong to a session working in `hookCwd`? */
function flagBelongsTo(file, hookCwd) {
  const stamp = readStamp(file);
  return !!stamp && sameWorkTree(stamp.cwd, hookCwd);
}

function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch { /* absent */ }
}

/** Record a merged ship_release for this (real) session id. */
function recordShipped(sessionId) {
  try { writeSessionFile(sessionFile(SHIPPED_FLAG, sessionId), String(Date.now())); } catch { /* best effort */ }
}

/** Drop the archive flag (and with `all`, the released marker and ship evidence). */
function dropArchiveFlags(sessionId, { all = false } = {}) {
  unlinkQuiet(sessionFile(FLAG, sessionId));
  if (all) {
    unlinkQuiet(sessionFile(RELEASED_FLAG, sessionId));
    unlinkQuiet(sessionFile(SHIPPED_FLAG, sessionId));
  }
}

/**
 * Release the one archive call for the card widget just shown. Consumes the
 * flag either way.
 * @param {{ session_id?: string, cwd?: string }} hook
 * @param {{ now?: number }} [opts]
 * @returns {boolean}
 */
function releaseArchive(hook, opts = {}) {
  const sid = hook && hook.session_id;
  if (!sid) return false;
  const flag = sessionFile(FLAG, sid);
  let ok = false;
  try {
    const age = (opts.now || Date.now()) - fs.statSync(flag).mtimeMs;
    const stamp = readStamp(flag);
    ok = age <= FLAG_MAX_AGE_MS
      && !!stamp
      && fs.existsSync(sessionFile(SHIPPED_FLAG, sid))
      && sameWorkTree(stamp.cwd, hook.cwd)
      && treeClean(stamp.cwd);
  } catch {
    ok = false;
  }
  if (!ok) { unlinkQuiet(flag); return false; }
  try {
    fs.renameSync(flag, sessionFile(RELEASED_FLAG, sid));
    return true;
  } catch {
    unlinkQuiet(flag);
    return false;
  }
}

/** Was the hand-over released for this session? */
function isReleased(sessionId) {
  return !!sessionId && fs.existsSync(sessionFile(RELEASED_FLAG, sessionId));
}

/** Consume the released marker; true when there was one. */
function consumeReleased(sessionId) {
  try { fs.unlinkSync(sessionFile(RELEASED_FLAG, sessionId)); return true; } catch { return false; }
}

/** Does this archive_session call target the calling session itself? */
function targetsSelf(toolInput, sessionId) {
  const id = toolInput && toolInput.session_id;
  return id === undefined || id === null || id === '' || id === 'self' || id === sessionId;
}

module.exports = {
  FLAG,
  RELEASED_FLAG,
  SHIPPED_FLAG,
  FLAG_MAX_AGE_MS,
  ARCHIVE_TOOL_RE,
  treeClean,
  sameWorkTree,
  readStamp,
  flagBelongsTo,
  recordShipped,
  dropArchiveFlags,
  releaseArchive,
  isReleased,
  consumeReleased,
  targetsSelf,
};
