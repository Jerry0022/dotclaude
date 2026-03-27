/**
 * @module session-id
 * @version 0.3.0
 * @description Stable session-scoped temp file paths for cross-hook state.
 *
 * Claude Code passes a `session_id` (UUID) in every hook's stdin JSON.
 * This module uses that UUID to build temp file paths that are unique per
 * session but stable across all hooks within the same session — solving
 * the parallel-session problem without any PID hacks.
 *
 * Usage:
 *   const { sessionFile } = require('../lib/session-id');
 *   // after parsing stdin JSON:
 *   const file = sessionFile('dotclaude-devops-edits', hookInput.session_id);
 */

const path = require('path');
const os   = require('os');

function sessionFile(prefix, sessionId) {
  const key = sessionId || 'unknown';
  return path.join(os.tmpdir(), `${prefix}-${key}`);
}

module.exports = { sessionFile };
