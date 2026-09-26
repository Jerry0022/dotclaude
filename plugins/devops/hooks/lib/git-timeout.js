'use strict';
/**
 * @module git-timeout
 * @version 0.4.0
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
 *   The git helpers live here too (harden scan 2026-09-26): they sat inside
 *   run-contract-calls.js, a shell-parser module, while post.flow.completion
 *   kept its own options object and pre.main.guard / pre.edit.branch /
 *   prompt.ship.detect spawned git with no timeout at all. run-contract-calls
 *   still re-exports gitOut / gitLines (tests spy on C.gitOut and hand C to
 *   run-contract-qa's resolveBase).
 *
 *   GIT_TIMEOUT_MS       the one per-call timeout (ms)
 *   SMALL_GIT_BUDGET_MS  a short shared budget (ms) for a 1-2 call git chain
 *     (H8: named once — pre.run.contract's onMainBranch fallback and
 *     post.run.contract's onMcpMerge origin check both used the bare
 *     literal 3000 before this)
 *   gitBudget(totalMs)   → {timeout(), expired()} — a shared deadline for a
 *     chain of git calls; timeout() is the ms left, clamped to
 *     GIT_TIMEOUT_MS and never below 1 (execFileSync rejects 0 / negative).
 *   gitRun(root, args, timeout?) → raw stdout (throws) — the one options object
 *   gitOut(root, args, {budget}) → trimmed stdout | null (error or empty output)
 *   gitLines(root, args, {timeout, budget}) → non-empty trimmed lines (throws)
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

/**
 * One git subprocess: stdout as utf8, stdin and stderr ignored, no console
 * window on Windows. THROWS on a non-zero exit or a timeout.
 * @param {string} root the working directory git runs in
 * @param {string[]} args
 * @param {number} [timeout] ms (default GIT_TIMEOUT_MS)
 * @returns {string} raw stdout
 */
function gitRun(root, args, timeout = GIT_TIMEOUT_MS) {
  const { execFileSync } = require('child_process');
  return execFileSync('git', args, {
    cwd: root, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
}

/**
 * AUD-031: the timeout for one call — a caller's shared `budget` (from
 * gitBudget) bounds a whole CHAIN of calls together; without one,
 * GIT_TIMEOUT_MS is each call's own ceiling.
 */
function callTimeout(budget) {
  return budget ? budget.timeout() : GIT_TIMEOUT_MS;
}

/**
 * Trimmed git stdout, or null on an error AND on empty output.
 * @param {object} [opts] `{budget}` — an optional gitBudget() to bound a
 *   chain of calls instead of each re-arming its own timeout.
 */
function gitOut(root, args, { budget } = {}) {
  try { return gitRun(root, args, callTimeout(budget)).trim() || null; } catch { return null; }
}

/**
 * H-A6: git stdout as non-empty lines. THROWS on a git failure, so a caller
 * can tell "unknown" from "no lines" (pre's qa count).
 * @param {object} [opts] `{timeout, budget}` — an explicit `timeout` wins;
 *   otherwise a shared `budget` bounds the chain, else GIT_TIMEOUT_MS.
 */
function gitLines(root, args, { timeout, budget } = {}) {
  return gitRun(root, args, timeout || callTimeout(budget)).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

module.exports = { GIT_TIMEOUT_MS, TOTAL_GIT_BUDGET_MS, SMALL_GIT_BUDGET_MS, gitBudget, gitRun, gitOut, gitLines };
