/**
 * @module context-cap
 * @version 0.1.0
 * @plugin devops
 * @description The size a hook's additionalContext may have before Claude
 *   Code stops showing it.
 *
 *   Above ~10 000 characters the harness writes a hook's additionalContext to
 *   a file and puts only a 2 KB preview into the model's context ("Output too
 *   large (15.4KB). Full output saved to: … Preview (first 2KB)"). Measured
 *   over two days of transcripts (2026-09-27): the largest context that
 *   arrived whole had 9 739 characters, the smallest persisted one 10.2 KB.
 *   The SessionStart index hook sent 15.9 KB, so the model saw the index
 *   header and never the always-on delegation policy after it — 126
 *   SessionStarts in two days — and ~44 prompts lost an injected
 *   deep-knowledge doc the same way.
 *
 *   Every hook that injects a large payload keeps it under SAFE_CONTEXT_CHARS,
 *   and puts what must always hold first, so even a harness that cuts
 *   earlier keeps the rules and drops only the reference material.
 */

/** Observed harness threshold (characters). */
const HARNESS_CONTEXT_LIMIT = 10000;

/** What a hook may send, with room for the harness' own wrapper text. */
const SAFE_CONTEXT_CHARS = 9500;

/** @param {string} text */
function fits(text, limit = SAFE_CONTEXT_CHARS) {
  return String(text).length <= limit;
}

module.exports = { HARNESS_CONTEXT_LIMIT, SAFE_CONTEXT_CHARS, fits };
