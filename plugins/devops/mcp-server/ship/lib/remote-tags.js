/**
 * @module ship/lib/remote-tags
 * @description Exact-ref parsing of `git ls-remote --tags` output.
 *   Shared by ship_promote (sha comparison) and ship_release (existence check)
 *   so both speak the same, correct dialect of ls-remote.
 */

/**
 * Parse `git ls-remote --tags` output for ONE tag and return the COMMIT sha it
 * points at, or null when the tag is absent. Pure — exported for unit tests.
 *
 * Three ls-remote traps this must handle (all bit us on the 0.116.2 promotion):
 * - An annotated tag has TWO refs: the tag OBJECT sha on `refs/tags/<tag>` and
 *   the peeled COMMIT sha on `refs/tags/<tag>^{}`. Tag objects differ by
 *   construction even when they point at the same commit (tagger/date/message),
 *   so every promotion comparison MUST use the peeled commit sha. Prefer the
 *   `^{}` line; fall back to the plain line (lightweight tags have no peeled
 *   entry — their plain sha IS the commit).
 * - A single-pattern query NEVER returns the `^{}` line: ls-remote tail-matches
 *   each pattern per path component, and `refs/tags/<tag>^{}` does not end in
 *   `/<tag>`. The CALLER must therefore query BOTH patterns
 *   (`<tag>` AND `<tag>^{}`) — see lsRemoteTag in tools/promote.js. Verified
 *   against a live GitHub remote; a mock that returns peeled lines for
 *   plain-pattern queries is lying about git.
 * - Tail-component matching also means querying `v0.116.2` returns
 *   `alpha/v0.116.2` &c. — only an exact-ref match may count, never "first
 *   line of the output".
 */
export function parseLsRemoteTagOutput(out, tag) {
  let plain = null;
  let peeled = null;
  for (const line of (out || "").split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref === `refs/tags/${tag}`) plain = sha;
    else if (ref === `refs/tags/${tag}^{}`) peeled = sha;
  }
  return peeled || plain;
}

/**
 * Does `out` contain an EXACT ref for `tag`?
 *
 * The substring test this replaces (`out.includes(tag)`) is wrong in both
 * directions because of ls-remote's tail-component matching: querying
 * `v1.0.0` also returns `refs/tags/alpha/v1.0.0`, so a bare-tag check passed
 * on a channel tag that was never pushed — and any tag whose name is a prefix
 * of another matched too.
 */
export function remoteTagExists(out, tag) {
  return parseLsRemoteTagOutput(out, tag) !== null;
}
