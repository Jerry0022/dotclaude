/**
 * @module ship-intent
 * @version 0.1.0
 * @description The one ship-intent classifier for user prompts. Shared by
 *   `prompt.ship.detect` (which turns the intent into a Skill('ship')
 *   instruction) and `prompt.flow.title-work` (which marks the sidebar with
 *   `🚀 Shipping – ` instead of the bare `⏳ ` when the prompt IS a ship).
 *   One list, so the two hooks can never disagree about what a ship prompt is.
 *
 *   Only the direct keywords live here. The "affirmation after a completion
 *   card" path ("ja", "go", …) needs the session's edit counter and stays in
 *   prompt.ship.detect — the title of an affirmed ship is set by the ship
 *   skill's Pre-Step C, which the hook instruction leaves in place.
 */

/** A slash invocation of the ship skill — `/ship`, `/devops:ship`, with or
 *  without arguments. Matched on the raw prompt start, case-insensitively. */
const SHIP_SLASH = /^\s*\/(?:devops:)?ship\b/i;

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
  const lower = trimmed.toLowerCase();
  return SHIP_KEYWORDS.some((re) => re.test(lower));
}

module.exports = { SHIP_SLASH, SHIP_KEYWORDS, isShipIntent };
