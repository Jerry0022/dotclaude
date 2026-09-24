/**
 * @module ship-intent
 * @version 0.4.0
 * @description The one ship-intent classifier for user prompts. Shared by
 *   `prompt.ship.detect` (which turns the intent into a Skill('devops:do-ship')
 *   instruction) and `prompt.flow.title-work` (which marks the sidebar with
 *   `🚀 Shipping – ` instead of the bare `⏳ ` when the prompt IS a ship).
 *   One list, so the two hooks can never disagree about what a ship prompt is.
 *
 *   Only the direct keywords live here. The "affirmation after a completion
 *   card" path ("ja", "go", …) needs the session's edit counter and stays in
 *   prompt.ship.detect — the title of an affirmed ship is set by the ship
 *   skill's Pre-Step C, which the hook instruction leaves in place.
 *
 *   Target channel (PR 2 of the skill restructure, promote folded into
 *   do-ship): a ship goes to alpha; naming beta or stable ("ship stable",
 *   "promote to beta", "release beta", "auf stable heben", `/promote stable`,
 *   `/do-ship stable`) means "ship if anything is unshipped, then promote".
 *   `parseShipRequest` reads that channel. A channel word only counts as the
 *   OBJECT of a ship/promote/release/heben verb (or after "auf/nach/to" in a
 *   prompt that already orders a ship) and only when a sentence boundary or a
 *   filler word follows it — "the stable API", "stable release notes" and
 *   "promote the idea to the team" stay silent. A NEGATED channel ("ship,
 *   aber nicht auf stable", "don't promote to stable", "ohne promote",
 *   "/do-ship not stable") is no channel — a plain ship to alpha; stable
 *   tags are irreversible, so a doubt resolves downwards. A version counts
 *   only adjacent to the promotion phrase ("promote stable 0.170.2",
 *   "0.170.2 auf stable") and makes the run promotion-only.
 */

/** A slash invocation of the do-ship skill — `/do-ship`, `/devops:do-ship` or the
 *  pre-PR-2 `/ship`, with or without arguments. Matched on the raw prompt
 *  start, case-insensitively. */
const SHIP_SLASH = /^\s*\/(?:devops:)?(?:do-)?ship\b/i;

/** The pre-PR-2 `/promote` (now do-ship mode `promote`) anywhere in the
 *  prompt — at the start or mid-prompt ("jetzt /promote stable"), never as a
 *  path segment. Group 2 = the text after it (the channel argument). */
const PROMOTE_SLASH = /(^|[\s([{>])\/(?:devops:)?promote\b(.*)$/is;

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

/** Ring channels, least to most stable. */
const CHANNELS = Object.freeze(['alpha', 'beta', 'stable']);

/** Verbs whose object may be a channel. */
const VERB = '(?:ship|shippen|shippe|promote|promoten|promotet|release|releasen|heben|bring|bringen)';
/** Verbs a German prompt puts AFTER the channel ("auf stable heben"). */
const TRAILING_VERB = '(?:heben|bringen|promoten|releasen|shippen)';
/** Prepositions before a channel. */
const PREP = '(?:to|into|auf|nach|bis|in|ins|zu|zum)';
const CH = '(alpha|beta|stable)';
/** What may follow a channel word: end, punctuation, a trailing verb or a
 *  filler — never a noun ("stable API", "beta tester"). */
const TAIL = `(?=\\s*$|\\s*[.,;:!)]|\\s+(?:${TRAILING_VERB}|and|und|then|dann|too|auch|please|bitte|jetzt|now|direkt|gleich|channel|kanal|v?\\d)\\b)`;

/** "promote stable", "release beta", "ship to stable", "ship it to beta",
 *  "promote auf stable" — the channel as the object of a verb (≤ 2 filler
 *  words between verb and preposition). */
const VERB_CHANNEL_RE = new RegExp(`\\b${VERB}\\b(?:\\s+(?:the|den|die|das|it|es|das\\s+ganze|v?\\d+(?:\\.\\d+){1,2}(?:-[0-9a-z.]+)?)){0,2}\\s+(?:${PREP}\\s+)?(?:the\\s+|den\\s+|dem\\s+)?(?:channel\\s+|kanal\\s+)?${CH}\\b${TAIL}`, 'g');
/** "auf stable heben", "nach beta promoten", "stable promoten". */
const CHANNEL_VERB_RE = new RegExp(`(?:^|\\s)(?:${PREP}\\s+)?${CH}\\s+${TRAILING_VERB}\\b`, 'g');
/** "ship, dann direkt nach stable" — only inside a prompt that orders a ship. */
const PREP_CHANNEL_RE = new RegExp(`\\b${PREP}\\s+(?:the\\s+|den\\s+)?${CH}\\b${TAIL}`, 'g');

/** A bare promotion order with no channel: "promote", "promote it", "jetzt promoten". */
const BARE_PROMOTE_RE = /^(?:(?:bitte|please|jetzt|now|dann|und)\s+)*(?:promote|promoten|promotion)(?:\s+(?:it|das|now|jetzt|bitte|please|v?\d+\.\d+\.\d+))*\s*[.!]*$/;

/** Is the prompt a question (a status request, never an order)? */
function isQuestion(trimmed) {
  return /[?？]\s*$/.test(trimmed);
}

/** A negation word (de + en). "bloß nicht" / "lieber nicht" carry "nicht". */
const NEGATION_TOKEN = /^(?:nicht|kein|keine|keinen|keinem|keiner|keines|ohne|nie|niemals|nein|not|no|never|without|nope|dont|don[’']t|doesn[’']t|didn[’']t|shouldn[’']t|mustn[’']t|won[’']t|can[’']t)$/;
/** How many words before a channel mention may carry its negation. */
const NEGATION_WINDOW = 4;
/** A negation right after the channel mention: "auf stable heben — lieber
 *  nicht", "ship to stable, not yet", "promote stable, doch nicht". */
const TRAILING_NEGATION = /^[\s,—–-]*(?:(?:lieber|doch|besser|bitte|noch|aber|but|oh|well|ach|hmm|—|–|-)\s+)*(?:nicht|not|no|nein|never|nie|nope)\b(?!\s+(?:(?:auf|nach|to|into|in)\s+)?(?:alpha|beta|stable)\b)/;

/** Words of `s`, punctuation stripped from their edges. */
function words(s) {
  return s.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}’']+|[^\p{L}\p{N}’']+$/gu, '')).filter(Boolean);
}

/**
 * Is the channel mention at [start, end) negated? A negation in the last
 * NEGATION_WINDOW words of its clause before it ("ship, aber nicht auf
 * stable", "don't promote to stable", "ship it, not to stable", "ohne
 * promote auf stable"), or right after it ("stable promoten, lieber nicht").
 * A clause ends at , ; : . ! and newlines — "don't wait, ship to stable" is
 * not negated. Stable tags are irreversible: a doubt resolves to alpha.
 */
function isNegated(text, start, end) {
  const before = text.slice(0, start).split(/[,;:.!\n]/).pop();
  if (words(before).slice(-NEGATION_WINDOW).some((w) => NEGATION_TOKEN.test(w))) return true;
  return TRAILING_NEGATION.test(text.slice(end));
}

/**
 * Highest channel among the matches of `regexes` in `text` (group 1), or
 * null. A negated mention vetoes its channel for the whole prompt — "ship,
 * aber nicht auf stable" must never reach stable through a second mention.
 */
function highestChannel(text, ...regexes) {
  const named = new Set();
  const vetoed = new Set();
  for (const re of regexes) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].search(new RegExp(`\\b${m[1]}\\b`));
      const end = m.index + m[0].length;
      // The part of the match before the channel counts as "before" too:
      // "don't promote to stable" starts the match at "promote".
      if (isNegated(text, m.index, end) || isNegated(text, at, end)) vetoed.add(m[1]);
      else named.add(m[1]);
    }
  }
  let best = -1;
  for (const ch of named) {
    if (vetoed.has(ch)) continue;
    best = Math.max(best, CHANNELS.indexOf(ch));
  }
  return best === -1 ? null : CHANNELS[best];
}

/** The channel named in slash arguments ("promote stable", "beta --keep");
 *  a negated one ("/do-ship not stable", "/promote nicht stable") is none. */
function channelFromArgs(args) {
  const toks = String(args || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].replace(/^--?(?:channel=|to=)?/, '');
    if (!CHANNELS.includes(t)) continue;
    const prev = toks.slice(Math.max(0, i - 2), i).map((w) => w.replace(/[^\p{L}’']/gu, ''));
    if (prev.some((w) => NEGATION_TOKEN.test(w))) return null;
    return t;
  }
  return null;
}

/** Fenced code and inline code spans removed — a `/promote` quoted in code is
 *  a mention, not an order. */
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/**
 * Classify a user prompt: is it a ship order, a promotion, and which channel?
 *
 *   - `ship`    — the prompt orders a do-ship run (ship keyword, `/do-ship`,
 *                 or any promotion request below). Same gates as before:
 *                 slash forms always, keywords only in a short non-question.
 *   - `promote` — a channel above alpha is named, or a bare "promote" /
 *                 `/promote` / `/do-ship promote` asks for a promotion.
 *   - `channel` — 'alpha' | 'beta' | 'stable' when named (the highest one
 *                 when several are: "beta und dann stable" → stable), else
 *                 null (= alpha, the default).
 *
 * @param {string} prompt the user's prompt as submitted
 * @returns {{ ship: boolean, promote: boolean, channel: string|null }}
 */
function classify(prompt) {
  const none = { ship: false, promote: false, channel: null };
  const raw = String(prompt || '');
  const trimmed = raw.trim();
  if (!trimmed) return none;
  const lower = trimmed.toLowerCase();

  // Slash forms — no length limit, a trailing "?" is still an order.
  const slashShip = SHIP_SLASH.test(raw);
  if (slashShip) {
    const args = raw.replace(SHIP_SLASH, '');
    const channel = channelFromArgs(args);
    const promoteWord = /(^|\s)promote\b/i.test(args);
    const promote = promoteWord || channel === 'beta' || channel === 'stable';
    return { ship: true, promote, channel };
  }
  // `/promote` at the very start is an order like `/do-ship`; mid-prompt it
  // obeys the keyword gates below (short, no question), so a long prompt that
  // talks ABOUT the old command ("the /promote button in the card …") stays
  // silent.
  const promoteSlash = PROMOTE_SLASH.exec(stripCode(raw));
  if (promoteSlash && /^\s*\/(?:devops:)?promote\b/i.test(raw)) {
    return { ship: true, promote: true, channel: channelFromArgs(promoteSlash[2]) };
  }

  if (isQuestion(trimmed)) return none;
  if (trimmed.length > KEYWORD_MAX_CHARS) return none;

  if (promoteSlash) {
    return { ship: true, promote: true, channel: channelFromArgs(promoteSlash[2]) };
  }

  const keywordShip = SHIP_KEYWORDS.some((re) => re.test(lower));
  const channel = keywordShip
    ? highestChannel(lower, VERB_CHANNEL_RE, CHANNEL_VERB_RE, PREP_CHANNEL_RE)
    : highestChannel(lower, VERB_CHANNEL_RE, CHANNEL_VERB_RE);
  const aboveAlpha = channel === 'beta' || channel === 'stable';
  if (aboveAlpha) return { ship: true, promote: true, channel };
  if (BARE_PROMOTE_RE.test(lower)) return { ship: true, promote: true, channel: null };
  if (keywordShip) return { ship: true, promote: false, channel };
  return none;
}

/** A semver ("0.170.2", "v0.171.0", "1.0.0-rc.1"); group 1 = bare version. */
const SEMVER_CORE = 'v?(\\d+\\.\\d+\\.\\d+(?:-[0-9a-z.]+)?)';
/** The version right AFTER the promotion phrase: "promote 0.170.2",
 *  "promote stable 0.170.2", "stable v0.170.2", "/do-ship stable 0.170.2",
 *  "/promote 0.170.2", "promote version 0.170.2". */
const VERSION_AFTER_RE = new RegExp(`(?:\\b${VERB}|\\b(?:beta|stable)|\\/(?:devops:)?(?:do-)?ship|\\/(?:devops:)?promote)\\s+(?:(?:version|die|the|den)\\s+)?${SEMVER_CORE}(?=$|[\\s,.;:!)])`, 'i');
/** The version right BEFORE the channel: "0.170.2 auf stable",
 *  "v0.171.0 to stable", "0.170.2 stable". */
const VERSION_BEFORE_RE = new RegExp(`(?:^|[\\s(])${SEMVER_CORE}\\s+(?:${PREP}\\s+)?(?:beta|stable)\\b`, 'i');

/**
 * The version a promotion names — only a semver ADJACENT to the promotion
 * phrase (the verb, the channel word, the slash command). A version
 * elsewhere in the prompt is context, not the target: "promote stable,
 * fixes 0.170.2 regression" names none (= the latest alpha / just-shipped).
 */
function promotionVersion(prompt) {
  const text = stripCode(String(prompt || ''));
  const m = VERSION_AFTER_RE.exec(text) || VERSION_BEFORE_RE.exec(text);
  return m ? m[1] : null;
}

/**
 * Classify a user prompt (see `classify`) and, for a promotion, the version
 * it names (`version`: bare semver without "v", else null = the latest alpha).
 * A named version makes the run promotion-only: do-ship promotes exactly
 * that version and never ships new work first (a stale card button must not
 * ship later edits).
 *
 * @param {string} prompt the user's prompt as submitted
 * @returns {{ ship: boolean, promote: boolean, channel: string|null, version: string|null }}
 */
function parseShipRequest(prompt) {
  const r = classify(prompt);
  return { ...r, version: r.promote ? promotionVersion(prompt) : null };
}

/**
 * True when the prompt asks for a ship — a slash invocation, one of the
 * direct keywords, or a promotion (a promotion is a do-ship run now). Pure,
 * no session state.
 *
 * @param {string} prompt the user's prompt as submitted
 * @returns {boolean}
 */
function isShipIntent(prompt) {
  return parseShipRequest(prompt).ship;
}

module.exports = {
  SHIP_SLASH, PROMOTE_SLASH, SHIP_KEYWORDS, KEYWORD_MAX_CHARS, CHANNELS,
  isShipIntent, parseShipRequest,
};
