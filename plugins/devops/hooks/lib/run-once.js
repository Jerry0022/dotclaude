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
 *   releaseOnce(hookName, sessionId)
 *     → give the token back, so the next call is allowed again
 *
 * `releaseOnce` exists for the case where the guarded work turns out not to
 * happen after all — the classic shape being a throttled spawn that a
 * downstream concurrency guard then declines (issue #291). Consuming a
 * 10-minute token for an action that never ran means the next session redraws
 * the same losing ticket, and on a machine where the downstream guard is
 * usually saturated the work is starved indefinitely with nothing recorded.
 * Release the token whenever the run did not actually occur.
 *
 * Usage:
 *   const { runOnce, releaseOnce } = require('../lib/run-once');
 *   const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
 *   if (!runOnce('ss-tokens-scan', input.session_id, { cooldownMs: 600000 })) process.exit(0);
 *   if (!spawnActuallyIssued()) releaseOnce('ss-tokens-scan', input.session_id);
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

/**
 * Hand back a token taken by `runOnce` — the guarded work did not run, so the
 * next caller must not be throttled on its behalf. Removing the marker restores
 * the pre-`runOnce` state exactly: a missing marker is "first run".
 *
 * Never throws. A marker that is already gone (another session released it, or
 * temp was swept) is the desired end state, not an error.
 *
 * @param {string} hookName
 * @param {string} sessionId — the same key `runOnce` was called with
 * @returns {boolean} true if a marker was removed
 */
function releaseOnce(hookName, sessionId) {
  try {
    fs.unlinkSync(markerPath(hookName, sessionId));
    return true;
  } catch {
    return false;
  }
}

module.exports = { runOnce, releaseOnce };
