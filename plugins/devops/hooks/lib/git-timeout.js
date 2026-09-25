'use strict';
/**
 * @module git-timeout
 * @version 0.3.0
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
 *   SMALL_GIT_BUDGET_MS  a short shared budget (ms) for a 1-2 call git chain
 *     (H8: named once — pre.run.contract's onMainBranch fallback and
 *     post.run.contract's onMcpMerge origin check both used the bare
 *     literal 3000 before this)
 *   gitBudget(totalMs)   → {timeout(), expired()} — a shared deadline for a
 *     chain of git calls; timeout() is the ms left, clamped to
 *     GIT_TIMEOUT_MS and never below 1 (execFileSync rejects 0 / negative).
 */

/** The single git subprocess timeout (ms) — see the module header. */
const GIT_TIMEOUT_MS = 5000;

/**
 * H8: the short shared budget for a call site that only ever chains one or
 * two git calls (onMainBranch's single rev-parse fallback, onMcpMerge's
 * originMatches check) — smaller than TOTAL_GIT_BUDGET_MS, which bounds a
 * whole gated call's full git chain instead.
 */
const SMALL_GIT_BUDGET_MS = 3000;

/**
 * R13: the one shared ceiling for a whole gated call's git chain. Before this
 * export, pre.run.contract.js kept its own 15000 while the CLI's measureQa()
 * fell back to gitBudget()'s GIT_TIMEOUT_MS (5000) default — `done` could see
 * `qa: null` (an expired 5 s budget) where the live gate, given 15 s, would
 * still have measured it. Both now share this one number.
 */
const TOTAL_GIT_BUDGET_MS = 15000;

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

module.exports = { GIT_TIMEOUT_MS, TOTAL_GIT_BUDGET_MS, SMALL_GIT_BUDGET_MS, gitBudget };
