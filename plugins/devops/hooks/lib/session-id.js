/**
 * @module session-id
 * @version 0.4.0
 * @description Stable session-scoped temp file paths for cross-hook state.
 *
 * Claude Code passes a `session_id` (UUID) in every hook's stdin JSON.
 * This module uses that UUID to build temp file paths that are unique per
 * session but stable across all hooks within the same session — solving
 * the parallel-session problem without any PID hacks.
 *
 * BUG WORKAROUND (issue #10): Claude Code may deliver different or missing
 * session_id values to different hook types (e.g., UserPromptSubmit vs
 * PreToolUse). readSessionFile() handles this by falling back to a glob
 * search when the exact file is not found.
 *
 * That fallback reads the newest matching file from ANY session, so it is
 * scoped to advisory state only. **Enforcement flags — anything a gate blocks
 * on — must pass `{ exact: true }`** (issue #290).
 *
 * Usage:
 *   const { sessionFile, readSessionFile } = require('../lib/session-id');
 *   // Write: always use sessionFile() for the path
 *   const file = sessionFile('dotclaude-devops-edits', hookInput.session_id);
 *   // Read (advisory): glob fallback handles session_id mismatches
 *   const content = readSessionFile('dotclaude-devops-edits', hookInput.session_id);
 *   // Read (enforcement): this session's file or nothing
 *   const flag = readSessionFile('dotclaude-devops-light-pending', id, { exact: true });
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');

function sessionFile(prefix, sessionId) {
  const key = sessionId || 'unknown';
  return path.join(os.tmpdir(), `${prefix}-${key}`);
}

/**
 * Atomic write: write to .tmp file then rename to prevent
 * partial reads from parallel sessions.
 */
function writeSessionFile(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Read a session file with glob fallback for session_id mismatches.
 * Tries exact match first, then searches for any file matching the prefix.
 * Returns { content, filePath } or null if not found.
 *
 * @param {string} prefix
 * @param {string} sessionId
 * @param {{ exact?: boolean }} [opts] — `exact: true` disables the glob
 *   fallback entirely. **Mandatory for every enforcement flag** (issue #290):
 *   the fallback returns the newest file with a matching prefix from ANY
 *   concurrent session, so a gate reading it fires on foreign state — and a
 *   gate that then unlinks `filePath` deletes the other session's still-owed
 *   flag, letting a session that really did change code finish unverified. The
 *   2-hour mtime window narrows that race, it does not close it. The fallback
 *   exists for the issue-#10 session_id mismatch and is acceptable only for
 *   advisory counters, where reading a neighbour's value costs nothing.
 */
function readSessionFile(prefix, sessionId, opts) {
  // 1. Try exact match
  const exact = sessionFile(prefix, sessionId);
  try {
    const content = fs.readFileSync(exact, 'utf8');
    return { content, filePath: exact };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[session-id] Failed to read ${exact}: ${err.message}`);
    }
  }

  if (opts && opts.exact === true) return null;

  // 2. Glob fallback — find any file matching the prefix.
  //    The 2-hour mtime window bounds how stale a foreign file may be; it does
  //    NOT make the result this session's state. Never use it for enforcement.
  try {
    const tmpdir = os.tmpdir();
    const maxAgeMs = 2 * 60 * 60 * 1000; // 2 hours
    const now = Date.now();
    const files = fs.readdirSync(tmpdir)
      .filter(f => f.startsWith(prefix + '-'))
      .map(f => ({
        name: f,
        full: path.join(tmpdir, f),
        mtime: fs.statSync(path.join(tmpdir, f)).mtimeMs,
      }))
      .filter(f => (now - f.mtime) < maxAgeMs)
      .sort((a, b) => b.mtime - a.mtime); // newest first

    if (files.length > 0) {
      const content = fs.readFileSync(files[0].full, 'utf8');
      return { content, filePath: files[0].full };
    }
  } catch (err) {
    console.error(`[session-id] Glob fallback failed for prefix '${prefix}': ${err.message}`);
  }

  return null;
}

module.exports = { sessionFile, readSessionFile, writeSessionFile };
