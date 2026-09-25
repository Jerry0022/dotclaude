/**
 * @module guide-handoff
 * @version 0.5.0
 * @description Detection + pending-hint state for stop.guide.handoff —
 *   decides whether the turn's own final answer hands the user a manual,
 *   click-through job on an external website/dashboard instead of invoking
 *   the devops auto-guide skill (formerly web-guide) to drive it live.
 *
 *   Usage data (1 128 sessions, 14.08.-23.09.2026): web-guide (now auto-guide) was invoked 0
 *   times although Claude repeatedly wrote out numbered click-throughs for
 *   Upstash, Discord, Supabase MCP login, … The signal lives in Claude's own
 *   answer, not the user's prompt — stop.guide.handoff passes every
 *   assistant entry of the current turn (lib/skill-invocations
 *   turnAssistantTexts), each cut at the completion card.
 *
 *   A hand-off needs BOTH:
 *     (a) an external service — a known SaaS/dashboard name
 *         (SERVICE_PATTERNS), a known provider domain (`*.vercel.app`, …), or
 *         an http(s) URL that is not excluded. Excluded: localhost/loopback
 *         (the user's own dev server) and every github.com link except
 *         `/settings` pages — PR, issue, commit, blob and the repo's own
 *         links are report links, not a click-through.
 *     (b) user-directed steps, in one of three shapes:
 *         - a numbered list whose items contain a UI verb (de+en: öffnen,
 *           klicken, wählen, anlegen, einloggen, open, click, paste, …), or
 *         - at least two `→` arrows AND a NAMED service (a bare URL is not
 *           enough for the arrow shape), or
 *         - one PROSE sentence naming the service that also contains an
 *           account/credential noun (Account/Konto, API-Token/Key, Bucket,
 *           Secret, OAuth-App, Webhook) AND a user-directed creation verb
 *           (anlegen, erstellen, einrichten, create, set up, generate) —
 *           `hasHandoffSentence`. A sentence where Claude reports having done
 *           it itself ("ich habe … angelegt", "I created …") is excluded.
 *     Prose that merely mentions a service plus a verb does not count.
 *
 *   The completion card's rendered chrome is out of scope: only the text
 *   BEFORE the first ✨✨✨ marker of each entry (card-guard.CARD_MARKER — the
 *   terminal title, or the stand-in card-guard.deliveredCardText builds for a
 *   Desktop card widget) is scanned here. The card's `userFinalTest`/`open`
 *   PAYLOAD (the structured fields passed to `render_completion_card`, not
 *   this rendered text) is scanned separately by `detectCardHandoff`, called
 *   from the MCP completion server so a hit there renders a live "Web-Guide
 *   starten" button instead of only a pending hint.
 *
 *   Pending hint: when the hand-off sits in a turn that already ends with
 *   the card, stop.guide.handoff must not block (that would force a second
 *   card, stop.flow.guard's "card last" contract). It records the service via
 *   lib/guide-pending.js instead (re-exported here); prompt.skill.enforce
 *   turns it into ONE non-mandatory hint on the next real user prompt and
 *   clears it.
 */

const { CARD_MARKER } = require('./card-guard');
const { skillInvokedThisTurn } = require('./skill-invocations');
const { PENDING_PREFIX, writePendingHandoff, consumePendingHandoff, buildPendingHint } = require('./guide-pending');

/**
 * Known SaaS / dashboard names Claude has actually handed off to in the
 * scanned session history. Common names (GitHub, Google, AWS, OpenAI,
 * Anthropic) only count with a qualifying word.
 */
const SERVICE_PATTERNS = [
  { name: 'Supabase', re: /\bsupabase\b/i },
  { name: 'Vercel', re: /\bvercel\b/i },
  { name: 'Upstash', re: /\bupstash\b/i },
  { name: 'Cloudflare', re: /\bcloudflare\b/i },
  { name: 'Stripe', re: /\bstripe\b/i },
  { name: 'Firebase', re: /\bfirebase\b/i },
  { name: 'Netlify', re: /\bnetlify\b/i },
  { name: 'Discord Developer Portal', re: /\bdiscord\s+(?:developer\s+portal|bot)\b/i },
  { name: 'GitHub Settings', re: /\bgithub\s+settings\b/i },
  { name: 'Google Cloud', re: /\bgoogle\s+cloud\b/i },
  { name: 'AWS Console', re: /\baws\s+console\b/i },
  { name: 'OpenAI Console', re: /\bopenai\s+console\b/i },
  { name: 'Anthropic Console', re: /\banthropic\s+console\b/i },
  { name: 'cron-job.org', re: /\bcron-job\.org\b/i },
  // "Neon" alone is too common a word (colour, sign) — only counts near its
  // Postgres/database context (#519, StretchTimer: Vercel Marketplace → Neon).
  {
    name: 'Neon',
    re: /\bneon\b(?=[\s\S]{0,40}?\b(?:postgres|database|datenbank|db)\b)|\b(?:postgres|database|datenbank|db)\b(?=[\s\S]{0,40}?\bneon\b)/i,
  },
];

/** Every http(s) URL in a text. */
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/gi;

/** Domains of known providers even without a scheme (e.g. `x.vercel.app`). */
const KNOWN_DOMAIN_RE =
  /\b[\w-]+\.(?:vercel\.app|supabase\.co|upstash\.io|cloudflare\.com|netlify\.app|firebaseapp\.com)\b/i;

/** A numbered step line ("1. …", "  2) …", "**3. …**"). */
const STEP_LINE_RE = /^[\s*_>-]*\d+[.)]\s+\S/;
const ARROW_RE = /→/g;

/** Account/credential nouns (de+en) — signal (b) of the prose shape. */
const CREDENTIAL_NOUN_RE_SRC = [
  String.raw`accounts?`, String.raw`konten?`, String.raw`konto`,
  String.raw`api[-\s]?tokens?`, String.raw`api[-\s]?keys?`,
  String.raw`buckets?`, String.raw`secrets?`, String.raw`oauth[-\s]?apps?`,
  String.raw`webhooks?`, String.raw`cron[-\s]?jobs?`,
];

/** User-directed creation verbs (de+en, incl. zu-infinitives) — signal (c). */
const CREATION_VERB_RE_SRC = [
  String.raw`anlegen`, String.raw`anzulegen`, String.raw`erstellen`,
  String.raw`einrichten`, String.raw`einzurichten`,
  String.raw`create`, String.raw`creating`,
  String.raw`set\s+up`, String.raw`setting\s+up`,
  String.raw`generate`, String.raw`generating`,
];

/** Unicode-aware whole-word alternative (JS `\b` is ASCII-only, so
 *  `\böffnen` never matched after a space). */
function wordAlt(src) {
  return String.raw`(?<![\p{L}\p{N}_])(?:` + src + String.raw`)(?![\p{L}\p{N}_])`;
}

/**
 * UI verbs (de+en) telling the USER to interact with a web UI. German
 * technical writing often ends the clause with a bare infinitive ("die URL …
 * öffnen"), so infinitives are included alongside imperatives.
 */
const IMPERATIVE_RE = new RegExp(
  [
    // German
    String.raw`öffnen?`, String.raw`klick(?:e|en)?`, String.raw`w[äa]hlen?`,
    String.raw`autorisier(?:e|en)`, String.raw`authentifizier(?:e|en)`,
    String.raw`durchlaufen`, String.raw`anlegen`, String.raw`erstell(?:e|en)`,
    String.raw`leg(?:e)?\s+[^\n]*?an`,
    String.raw`eintragen`, String.raw`trag(?:e)?\s+[^\n]*?ein`, String.raw`einloggen`,
    String.raw`anmelden`, String.raw`kopier(?:e|en)`, String.raw`einfügen`,
    String.raw`aktivier(?:e|en)`, String.raw`navigier(?:e|en)`,
    // English
    String.raw`go\s+to`, String.raw`open`, String.raw`click`, String.raw`paste`,
    String.raw`authorize`, String.raw`authenticate`, String.raw`create`,
    String.raw`choose`, String.raw`select`, String.raw`navigate\s+to`,
    String.raw`log\s+in`, String.raw`sign\s+(?:in|up)`, String.raw`copy`,
    String.raw`enable`,
  ].map(wordAlt).join('|'),
  'iu'
);

const CREDENTIAL_NOUN_RE = new RegExp(CREDENTIAL_NOUN_RE_SRC.map(wordAlt).join('|'), 'iu');
const CREATION_VERB_RE = new RegExp(CREATION_VERB_RE_SRC.map(wordAlt).join('|'), 'iu');

/**
 * "Ich habe … angelegt" / "I created …" — Claude reporting it did the step
 * itself, not handing it to the user. Excluded from the prose shape so a
 * self-performed setup never reads as a hand-off (the participle forms here
 * — angelegt, erstellt, eingerichtet, created, generated — never collide
 * with the infinitives/imperatives in CREATION_VERB_RE_SRC above; "set up"
 * is spelled the same in both tenses, so it only counts here behind "I").
 */
const SELF_PERFORMED_RE = new RegExp(
  '(?:' + wordAlt('ich') + String.raw`[^.!?\n]{0,60}?` +
    wordAlt(['angelegt', 'erstellt', 'eingerichtet'].join('|')) + ')' +
  '|(?:' + wordAlt('i') + String.raw`[^.!?\n]{0,60}?` +
    wordAlt(['created', 'generated', String.raw`set\s+up`, 'configured'].join('|')) + ')',
  'iu'
);

/** Split into rough sentences on sentence-ending punctuation or newlines. */
function splitSentences(text) {
  return String(text).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

/**
 * The prose hand-off shape: one sentence naming a service AND carrying an
 * account/credential noun AND a user-directed creation verb, none of it a
 * self-performed report.
 * @param {string} text
 * @returns {{service:string}|null}
 */
function hasHandoffSentence(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const sentence of splitSentences(text)) {
    if (SELF_PERFORMED_RE.test(sentence)) continue;
    const service = matchService(sentence);
    if (!service || !service.named) continue;
    if (!CREDENTIAL_NOUN_RE.test(sentence)) continue;
    if (!CREATION_VERB_RE.test(sentence)) continue;
    return { service: service.name };
  }
  return null;
}

/** Everything before the first completion-card marker. */
function stripCompletionCard(text) {
  if (typeof text !== 'string' || !text) return '';
  const idx = text.indexOf(CARD_MARKER);
  return idx === -1 ? text : text.slice(0, idx);
}

/** Does the text contain the completion-card marker at all? */
function containsCompletionCard(text) {
  return typeof text === 'string' && text.includes(CARD_MARKER);
}

/** A URL that is not a web hand-off target: loopback, or a GitHub report
 *  link (anything on github.com except a settings page). */
function isExcludedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return true; }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]' || host === '::1') return true;
  if (host.endsWith('githubusercontent.com')) return true;
  if (host === 'github.com' || host === 'www.github.com') {
    return !/(^|\/)settings(\/|$)/.test(u.pathname);
  }
  return false;
}

/**
 * The external service the text points at.
 * @returns {{name:string, named:boolean}|null} `named` = a known service or
 *   provider domain, not just a URL
 */
function matchService(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const { name, re } of SERVICE_PATTERNS) {
    if (re.test(text)) return { name, named: true };
  }
  const domain = text.match(KNOWN_DOMAIN_RE);
  if (domain) return { name: domain[0], named: true };
  for (const m of text.matchAll(URL_RE)) {
    if (!isExcludedUrl(m[0])) return { name: 'external URL', named: false };
  }
  return null;
}

/** Numbered list with a UI verb in at least one item. */
function hasNumberedUiSteps(text) {
  return String(text).split('\n').some(l => STEP_LINE_RE.test(l) && IMPERATIVE_RE.test(l));
}

/** Two or more `→` arrows. */
function hasArrowChain(text) {
  const m = String(text).match(ARROW_RE);
  return !!m && m.length >= 2;
}

/**
 * Decide whether the turn's last assistant text hands the user a manual web
 * step. Returns `{ service }` when it does, else null.
 * @param {string} lastAssistantText
 */
function detectWebHandoff(lastAssistantText) {
  const body = stripCompletionCard(lastAssistantText);
  if (!body) return null;
  const service = matchService(body);
  if (service && (hasNumberedUiSteps(body) || (service.named && hasArrowChain(body)))) {
    return { service: service.name };
  }
  return hasHandoffSentence(body);
}

/** A card `open`/`userFinalTest` item as plain text, whatever shape it was passed in. */
function itemText(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return String(item.text || item.action || '');
  return '';
}

/**
 * Scan the completion card's PAYLOAD (`userFinalTest` and `open`, as passed
 * to `render_completion_card` — not the rendered markdown/widget chrome) for
 * the same prose-hand-off signal as `detectWebHandoff`. Called from the MCP
 * completion server at render time, so a hit renders a live "Web-Guide
 * starten" button instead of only recording a pending hint (#506).
 * @param {{userFinalTest?: unknown[], open?: unknown[]}} card
 * @returns {{service:string}|null}
 */
function detectCardHandoff(card) {
  const items = [
    ...(Array.isArray(card && card.userFinalTest) ? card.userFinalTest : []),
    ...(Array.isArray(card && card.open) ? card.open : []),
  ];
  for (const item of items) {
    const hit = hasHandoffSentence(itemText(item));
    if (hit) return hit;
  }
  return null;
}

/** Skill input naming auto-guide or its pre-PR-2 name web-guide. */
const GUIDE_SKILL_RE = /(?:web|auto)[-_]?guide/i;

function invokesWebGuide(input, name) {
  if (name && GUIDE_SKILL_RE.test(name)) return true;
  try { return GUIDE_SKILL_RE.test(JSON.stringify(input || {})); } catch { return false; }
}

/**
 * Did THIS turn already invoke auto-guide (or the old name web-guide)?
 * @param {string} transcriptContent
 */
function webGuideInvokedThisTurn(transcriptContent) {
  return skillInvokedThisTurn(transcriptContent, invokesWebGuide);
}

module.exports = {
  SERVICE_PATTERNS,
  URL_RE,
  KNOWN_DOMAIN_RE,
  STEP_LINE_RE,
  IMPERATIVE_RE,
  CREDENTIAL_NOUN_RE,
  CREATION_VERB_RE,
  PENDING_PREFIX,
  stripCompletionCard,
  containsCompletionCard,
  isExcludedUrl,
  matchService,
  hasNumberedUiSteps,
  hasArrowChain,
  hasHandoffSentence,
  detectWebHandoff,
  detectCardHandoff,
  webGuideInvokedThisTurn,
  writePendingHandoff,
  consumePendingHandoff,
  buildPendingHint,
};
