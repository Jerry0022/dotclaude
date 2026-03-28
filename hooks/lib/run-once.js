/**
 * @module run-once
 * @version 0.1.0
 * @description Session-scoped execution guard with optional cooldown.
 *
 * Prevents hooks from running repeatedly when SessionStart fires multiple
 * times per session. Two modes:
 *
 *   runOnce(hookName, sessionId)
 *     → runs exactly once per session (marker file per session ID)
 *
 *   runOnce(hookName, sessionId, { cooldownMs: 600000 })
 *     → runs again only after cooldownMs since last execution
 *
 * Returns true if the hook should run, false if it should skip.
 * Automatically writes the marker file when returning true.
 *
 * Usage:
 *   const { runOnce } = require('../lib/run-once');
 *   const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
 *   if (!runOnce('ss-tokens-scan', input.session_id, { cooldownMs: 600000 })) process.exit(0);
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function markerPath(hookName, sessionId) {
  const key = sessionId || 'unknown';
  return path.join(os.tmpdir(), `dotclaude-${hookName}-${key}`);
}

function runOnce(hookName, sessionId, opts = {}) {
  const file = markerPath(hookName, sessionId);
  const cooldownMs = opts.cooldownMs || 0;

  try {
    const stat = fs.statSync(file);
    if (cooldownMs > 0) {
      const elapsed = Date.now() - stat.mtimeMs;
      if (elapsed < cooldownMs) return false;
      // Cooldown expired — touch the file and allow run
    } else {
      // No cooldown — strict once-per-session
      return false;
    }
  } catch {
    // File does not exist — first run
  }

  // Write/touch marker
  fs.writeFileSync(file, String(Date.now()));
  return true;
}

module.exports = { runOnce };
