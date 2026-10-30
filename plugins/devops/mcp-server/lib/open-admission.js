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
 * A narrow denylist (ship, push, release, version bump, a channel post, nach /
 * into main, "<version> ausgeben") catches the routine step; an item with a
 * `?` is a real question and always stays. Silent drop (the caller logs it and names the
 * count in the tool result) — same failure mode as the foreign-branch and chip
 * filters, so a misjudged item can never deadlock the card.
 *
 * Pure, so it is unit-testable without booting the MCP server.
 */

const NEXT_STEP_RE = new RegExp([
  // Imperative / infinitive forms only: a past tense ("bereits gepushte Commits",
  // "the shipped config") describes a state, and that state can be a decision.
  // `(?!-)`: a compound noun ("Push-Benachrichtigungen", "Release-Skript") is a
  // finding, not the step.
  String.raw`\bship(?:pen|ping|s)?\b(?!-)`,
  String.raw`\bpush(?:en|ing|es)?\b(?!-)`,
  String.raw`\breleas(?:e|es|ing)\b(?!-)`,
  String.raw`\bveröffentlich\w*`,
  String.raw`\bversion(?:s)?[\s-]*(?:bump|erhöh\w*|ausgeben|ausgabe)\b`,
  String.raw`\bbump(?:en|ed|ing)?\s+(?:the\s+)?version\b`,
  String.raw`\bversion\s+(?:ausgeben|erhöhen|bumpen)\b`,
  // A bare "ausgeben" is also "output a warning" — only a version goes out.
  String.raw`\bv?\d+\.\d+\.\d+\s+ausgeben\b`,
  String.raw`\b(?:discord|slack)[-\s]?post\b`,
  // A bare "posten" is also the noun "line item" — only a post to a channel counts.
  String.raw`\b(?:discord|slack)\b[^.?!]{0,30}\bposten\b`,
  String.raw`\bpost(?:ing)?\s+(?:to|in|on)\s+(?:discord|slack)\b`,
  // A bare "merge" or "Discord" names decisions too ("Remove the legacy discord
  // webhook config") — the routine step always says where: nach/into main, a post.
  String.raw`\bnach\s+(?:main|master)\b`,
  String.raw`\b(?:to|into)\s+(?:main|master)\b`,
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
  // An item whose reply is a promote command offers what the card's Promote
  // buttons already offer, question or not — "promote beta 0.335.5" rode on
  // Nachbessern beside them (2026-10-30).
  const cmd = it && typeof it === 'object' && typeof it.reply === 'string' ? it.reply.trim() : '';
  if (/^\/?promote\b/i.test(cmd)) return true;
  // A question anywhere, also one followed by a hint ("… behalten? (empfohlen: löschen)").
  if (/[?？]["')\]*_`]*(?:\s|$)/.test(text)) return false;
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

/**
 * #920: a review / QA finding that is a defect in the shipped diff's own topic
 * is fixed (with a regression test) before the merge, or the ship asks / ends
 * ship-blocked - it is never parked as an open point on a ship-successful card.
 * The ship tags each finding it lists: `finding: "in-scope"` is refused here,
 * `"out-of-scope"` (outside the diff's topic or requirement) and untagged
 * items stay. Same silent-drop-with-note mode as the routine-step filter.
 * @param {Array<string|{text:string,reply?:string,finding?:string}>} [open]
 * @returns {{ open: Array, refused: number }}
 */
function refuseInScopeFindings(open) {
  if (!Array.isArray(open) || !open.length) return { open, refused: 0 };
  const kept = open.filter(it => !(it && typeof it === 'object' && it.finding === 'in-scope'));
  return { open: kept, refused: open.length - kept.length };
}

export { dropNextStepOpenItems, isNextStep, refuseInScopeFindings };
