/**
 * @module ship/lib/retry
 * @description Shared exponential-backoff retry for remote git / GitHub reads.
 *
 *   Every remote operation in the ship pipeline can lag or lie once:
 *   `git push` can return before the ref is visible on the replica that the
 *   next `ls-remote` happens to hit, and a client-side ETIMEDOUT can fire
 *   *after* the ref already updated. A single-shot post-push verification
 *   therefore produces false negatives — it reported `stable/v0.39.2` as
 *   "not verifiable on remote" while the tag had in fact landed (#251).
 *
 *   The rule this module encodes: **the remote decides, and it gets asked more
 *   than once.** A throw is evidence of nothing; only a confirmed read is.
 */

/**
 * Delay before retry `attempt+1`, exponential with symmetric jitter.
 * attempt is 1-based: 1 → delayMs, 2 → delayMs*factor, 3 → delayMs*factor².
 * `random` is injectable so tests can pin the jitter.
 */
export function backoffMs(attempt, { delayMs = 1000, factor = 3, jitter = 0.1, random = Math.random } = {}) {
  if (!(delayMs > 0)) return 0;
  const base = delayMs * Math.pow(factor, Math.max(0, attempt - 1));
  if (!jitter) return Math.round(base);
  return Math.round(base * (1 - jitter + random() * 2 * jitter));
}

/** Async sleep; a non-positive duration resolves immediately (test-friendly). */
export function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Call `fn(attempt)` until it returns a non-null/undefined value.
 *
 * A returned `null`/`undefined` means "not yet — retry"; a throw is likewise
 * retried and recorded as `error`. Returns
 * `{ ok, value, error, attempts }` — `ok: false` means every attempt was
 * exhausted without a settled value.
 *
 * `sleepFn` is injectable so tests never wait on real timers.
 */
export async function retryUntil(fn, opts = {}) {
  const { attempts = 3, sleepFn = sleep, deadline = null, now = () => Date.now() } = opts;
  const total = Math.max(1, attempts);
  let lastError = null;
  let used = 0;
  for (let attempt = 1; attempt <= total; attempt++) {
    used = attempt;
    try {
      const value = await fn(attempt);
      if (value !== null && value !== undefined) return { ok: true, value, error: null, attempts: attempt };
      lastError = null;
    } catch (e) {
      lastError = e;
    }
    if (attempt < total) {
      // A wall-clock deadline bounds the loop regardless of how many attempts
      // the caller asked for. Retry loops nest (a push loop around a verify
      // loop), so an attempt budget alone multiplies into a worst case nobody
      // sized; the deadline is the thing that actually caps it.
      if (deadline !== null && now() >= deadline) break;
      await sleepFn(backoffMs(attempt, opts));
    }
  }
  return { ok: false, value: null, error: lastError, attempts: used, timedOut: deadline !== null && now() >= deadline };
}
