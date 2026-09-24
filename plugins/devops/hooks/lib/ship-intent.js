/**
 * @module ship-intent
 * @version 0.2.0
 * @description The one ship-intent classifier for user prompts. Shared by
 *   `prompt.ship.detect` (which turns the intent into a Skill('do-ship')
 *   instruction) and `prompt.flow.title-work` (which marks the sidebar with
 *   `🚀 Shipping – ` instead of the bare `⏳ ` when the prompt IS a ship).
 *   One list, so the two hooks can never disagree about what a ship prompt is.
 *
 *   Only the direct keywords live here. The "affirmation after a completion
 *   card" path ("ja", "go", …) needs the session's edit counter and stays in
 *   prompt.ship.detect — the title of an affirmed ship is set by the ship
 *   skill's Pre-Step C, which the hook instruction leaves in place.
 */

/** A slash invocation of the do-ship skill — `/do-ship`, `/devops:do-ship` or the
 *  pre-PR-2 `/ship`, with or without arguments. Matched on the raw prompt
 *  start, case-insensitively. */
const SHIP_SLASH = /^\s*\/(?:devops:)?(?:do-)?ship\b/i;

/** A keyword counts as an ORDER only in a prompt up to this length. "ship it",
 *  "ab damit", the card's button prompts — orders are short. A long prompt
 *  that mentions a ship in passing ("the project ship extension …", "… und
 *  NICHT erneut geshipped … ein ship war") describes work, and marking it
 *  🚀 Shipping put the wrong process on the sidebar (observed 2026-09-21).
 *  The slash form has no limit. */
const KEYWORD_MAX_CHARS = 160;

/** Direct ship keywords (de + en). Tested on the lower-cased prompt. */
const SHIP_KEYWORDS = Object.freeze([
  /\bship\b/,
  /\bship(?:pen|pe)\b/,
  /\bab\s+damit\b/,
  /\bmach\s+(?:nen?|einen?)\s+pr\b/,
  /\bmerge\s+it\b/,
  /\bpush\s+and\s+merge\b/,
  /\bdas\s+kann\s+rein\b/,
  /\bfertig\b/,
  /\bausliefern\b/,
  /\braushauen\b/,
  /\brelease\b/,
  /\bpr\s+erstellen\b/,
]);

/**
 * True when the prompt asks for a ship — a slash invocation or one of the
 * direct keywords. Pure, no session state.
 *
 * @param {string} prompt the user's prompt as submitted
 * @returns {boolean}
 */
function isShipIntent(prompt) {
  const raw = String(prompt || '');
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (SHIP_SLASH.test(raw)) return true;
  // A question is never a ship order: "fertig?" / "ship it?" asks for a
  // status, and a wrong 🚀 Shipping on the sidebar is worse than a missed one.
  if (/[?？]\s*$/.test(trimmed)) return false;
  if (trimmed.length > KEYWORD_MAX_CHARS) return false;
  const lower = trimmed.toLowerCase();
  return SHIP_KEYWORDS.some((re) => re.test(lower));
}

module.exports = { SHIP_SLASH, SHIP_KEYWORDS, KEYWORD_MAX_CHARS, isShipIntent };
