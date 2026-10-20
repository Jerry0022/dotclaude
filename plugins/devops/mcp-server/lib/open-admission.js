/**
 * @version 0.1.0
 * Enforce the `open` admission rule: never the approved scope's obvious next
 * step (#751).
 *
 * `open` is for decisions only the user can make. Claude kept offering the
 * routine step that follows a finished scope — "Version ausgeben, nach main
 * pushen und Discord-Post senden" — as an open point; on a test card it even
 * displaced the steps to test. The rule used to live as prose in the tool
 * description only.
 *
 * A narrow denylist (ship, push, release, version bump, post, merge, nach main,
 * ausgeben, Discord) catches the routine step; an item that ends in `?` is a
 * real question and always stays. Silent drop (the caller logs it and names the
 * count in the tool result) — same failure mode as the foreign-branch and chip
 * filters, so a misjudged item can never deadlock the card.
 *
 * Pure, so it is unit-testable without booting the MCP server.
 */

const NEXT_STEP_RE = new RegExp([
  String.raw`\bship(?:pen|ping|ped|s)?\b`,
  String.raw`\bpush(?:en|ed|ing|es)?\b`,
  // Not a compound noun: "Release-Skript prüft …" is a finding, not the step.
  String.raw`\breleas(?:e|es|ed|ing)\b(?!-)`,
  String.raw`\bveröffentlich\w*`,
  String.raw`\bversion(?:s)?[\s-]*(?:bump|erhöh\w*|ausgeben|ausgabe)\b`,
  String.raw`\bbump(?:en|ed|ing)?\s+(?:the\s+)?version\b`,
  String.raw`\bversion\s+(?:ausgeben|erhöhen|bumpen)\b`,
  String.raw`\b(?:discord|slack)[-\s]?post\b`,
  String.raw`\bposten\b`,
  String.raw`\bpost(?:ed|ing)?\s+(?:to|in|on)\s+(?:discord|slack)\b`,
  // A bare "merge" or "Discord" names decisions too ("Remove the legacy discord
  // webhook config") — the routine step always says where: nach/into main, a post.
  String.raw`\bnach\s+(?:main|master)\b`,
  String.raw`\b(?:to|into)\s+(?:main|master)\b`,
  String.raw`\bausgeben\b`,
].join('|'), 'i');

// #759: finished work in a linked side session that still has to ship is not
// this scope's next step — it is the user's to land, carried by its reply.
const SIDE_SESSION_RE = /\b(?:side[-\s]?session|seiten[-\s]?session|linked\s+session|verknüpfte\w*\s+session|side[-\s]?branch|anderen?\s+session)\b/i;

/** The text an item shows: a string, or the `text` of `{ text, reply }`. */
function shownText(it) {
  if (typeof it === 'string') return it;
  return it && typeof it === 'object' && typeof it.text === 'string' ? it.text : '';
}

/** True when the item is the routine next step, not a decision. */
function isNextStep(it) {
  const text = shownText(it).trim();
  if (!text) return false;
  if (/[?？]["')\]*_`]*$/.test(text)) return false;
  const reply = it && typeof it === 'object' && typeof it.reply === 'string' ? it.reply : '';
  if (reply && SIDE_SESSION_RE.test(text + ' ' + reply)) return false;
  return NEXT_STEP_RE.test(text);
}

/**
 * @param {Array<string|{text:string,reply?:string}>} [open]
 * @returns {{ open: Array, dropped: number }}
 */
function dropNextStepOpenItems(open) {
  if (!Array.isArray(open) || !open.length) return { open, dropped: 0 };
  const kept = open.filter(it => !isNextStep(it));
  return { open: kept, dropped: open.length - kept.length };
}

export { dropNextStepOpenItems, isNextStep };
