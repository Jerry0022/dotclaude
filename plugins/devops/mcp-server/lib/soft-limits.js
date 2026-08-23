/**
 * Soft length limits for cosmetic fields.
 *
 * A PR title or card summary that runs a few characters long is a formatting
 * nit. Enforced as a hard `z.string().max()` it becomes a rejected MCP call —
 * and `ship_release` is rejected *after* preflight, build and the version bump
 * have already committed. The pipeline then dies with the version raised, the
 * CHANGELOG written and no PR to show for it, which reads as a crash rather
 * than as "your title was too long".
 *
 * These helpers keep the budget as guidance (it stays in `.describe()`, so the
 * caller still aims for it) but clamp at the boundary instead of throwing, and
 * report what was cut so the truncation is visible rather than silent.
 */

/** Cut no further back than this fraction of the budget when seeking a word boundary. */
const WORD_BOUNDARY_FLOOR = 0.6;

/**
 * Clamp `value` to `limit` characters, preferring a word boundary.
 *
 * Returns the original untouched (and `clamped: false`) when it already fits or
 * is not a string — callers may hand this optional fields.
 */
export function clampText(value, limit) {
  if (typeof value !== "string" || value.length <= limit) {
    return { value, clamped: false, original: null };
  }

  const head = value.slice(0, limit);
  const lastSpace = head.lastIndexOf(" ");
  // A boundary too close to the start would discard most of the subject; a hard
  // cut keeps more meaning than a two-word fragment.
  const cut = lastSpace >= limit * WORD_BOUNDARY_FLOOR ? head.slice(0, lastSpace) : head;

  // No ellipsis: a squash merge turns the PR title into the commit subject, and
  // a subject trailing off in dots is worse than one that simply ends early.
  return { value: cut.replace(/[\s,;:\-–—]+$/, ""), clamped: true, original: value };
}

/** Clamp `value` to `limit` entries, reporting how many were dropped. */
export function clampList(value, limit) {
  if (!Array.isArray(value) || value.length <= limit) {
    return { value, clamped: false, dropped: 0 };
  }
  return { value: value.slice(0, limit), clamped: true, dropped: value.length - limit };
}

