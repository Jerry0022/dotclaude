'use strict';
/**
 * @module git-timeout
 * @version 0.1.0
 * @plugin devops
 * @description The one git subprocess timeout, named once (AUD-031). Before
 *   this module the same idea lived in three places with two values —
 *   pre.run.contract's own GIT_TIMEOUT (5000) and run-contract-calls'
 *   gitOut / gitLines plus post.flow.completion's GIT_OPTS (3000 each). A
 *   single git call almost never needs that long; 5000 ms is kept as
 *   GIT_TIMEOUT_MS because pre.run.contract's gate already documented it as
 *   "never blocks" at that ceiling and callers rely on a git failure/timeout
 *   reading as "unknown", not as a hang. AUD-031 found gates that chain many
 *   git calls (~9) back to back, where N independent 3-5 s timeouts can sum
 *   past 60 s worst case — gitBudget() bounds a whole CHAIN of calls to one
 *   shared ceiling instead of letting each call re-arm its own.
 *
 *   GIT_TIMEOUT_MS       the one per-call timeout (ms)
 *   gitBudget(totalMs)   → {timeout(), expired()} — a shared deadline for a
 *     chain of git calls; timeout() is the ms left, clamped to
 *     GIT_TIMEOUT_MS and never below 1 (execFileSync rejects 0 / negative).
 */

/** The single git subprocess timeout (ms) — see the module header. */
const GIT_TIMEOUT_MS = 5000;

/**
 * A shared deadline for a chain of git calls that should not, together,
 * outrun `totalMs`. Each call asks `timeout()` for how long it may still
 * take — the remaining budget, clamped to `[1, GIT_TIMEOUT_MS]` so a single
 * slow call never waits longer than the normal per-call ceiling, and a
 * caller that is already out of budget still gets a minimal, non-zero
 * timeout rather than a rejected `execFileSync` call.
 * @param {number} [totalMs] the whole chain's ceiling (default GIT_TIMEOUT_MS)
 * @returns {{timeout: () => number, expired: () => boolean}}
 */
function gitBudget(totalMs = GIT_TIMEOUT_MS) {
  const deadline = Date.now() + Math.max(0, totalMs);
  return {
    timeout() {
      const left = deadline - Date.now();
      return Math.max(1, Math.min(GIT_TIMEOUT_MS, left));
    },
    expired() {
      return Date.now() >= deadline;
    },
  };
}

module.exports = { GIT_TIMEOUT_MS, gitBudget };
