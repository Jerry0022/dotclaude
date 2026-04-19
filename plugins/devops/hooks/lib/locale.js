/**
 * @module locale
 * @version 0.1.0
 * @description Session-scoped UI locale detection and lookup.
 *
 *   The plugin renders user-facing strings (completion-card CTAs, hook prompts,
 *   skill output templates) in either English or German. The locale is detected
 *   ONCE per session from the first non-trivial user prompt — heuristically by
 *   counting German-language markers — then cached in a session file so all
 *   subsequent hooks/skills agree without re-detecting.
 *
 *   Why per-session, not global: the same user may run a German chat in one
 *   project and an English chat in another; per-session keeps that decoupled.
 *
 *   Default fallback: 'en' (safe for an open-source plugin used by mixed
 *   audiences). Detected German overrides the default.
 *
 * Usage:
 *   const { detectFromPrompt, getLocale, setLocale, t } = require('../lib/locale');
 *   const lang = getLocale(hook.session_id); // 'de' | 'en'
 *   const msg  = t('desktop_test.question', lang, DICT);
 */

const { sessionFile, readSessionFile, writeSessionFile } = require('./session-id');

const DEFAULT_LOCALE = 'en';
const SUPPORTED = ['en', 'de'];
const SESSION_PREFIX = 'dotclaude-locale';

// German-language markers. Curated to avoid English collisions:
//   - 'die' (English verb), 'in' (identical EN/DE), 'der' (ambiguous in
//     code contexts) and similar were dropped after research review.
//   - 'das', 'den' kept — rare in English text, common as German articles.
// Two distinct hits → de. A single umlaut also tips it to de (English text
// essentially never contains äöüß).
const DE_WORDS = [
  'ich', 'du', 'wir', 'ihr', 'mir', 'mich', 'dich', 'dir',
  'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einem', 'einer',
  'ist', 'sind', 'war', 'sein', 'wird', 'werden', 'wurde',
  'hat', 'haben', 'hatte',
  'kann', 'soll', 'muss', 'darf', 'mag', 'will',
  'nicht', 'nur', 'noch', 'schon', 'auch', 'aber', 'oder', 'und',
  'mit', 'für', 'auf', 'bei', 'aus', 'nach', 'von', 'vor',
  'wenn', 'dann', 'weil', 'damit', 'dass',
  'mach', 'machen', 'lass', 'lasse', 'bitte', 'gerne',
];

/**
 * Detect locale heuristically from a user prompt.
 * Returns one of SUPPORTED. Conservative: defaults to 'en' unless German
 * markers are clearly present.
 */
function detectFromPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return DEFAULT_LOCALE;
  const lower = prompt.toLowerCase();

  // Umlaut/eszett → strong German signal
  if (/[äöüß]/.test(lower)) return 'de';

  // Tokenize on word boundaries, count distinct German-marker hits
  const tokens = new Set(lower.match(/[a-zäöüß]+/g) || []);
  let hits = 0;
  for (const w of DE_WORDS) {
    if (tokens.has(w)) {
      hits += 1;
      if (hits >= 2) return 'de';
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Read cached session locale. Returns one of SUPPORTED, defaulting to
 * DEFAULT_LOCALE when no cache exists or the cached value is invalid.
 */
function getLocale(sessionId) {
  const result = readSessionFile(SESSION_PREFIX, sessionId);
  if (!result) return DEFAULT_LOCALE;
  const lang = result.content.trim();
  return SUPPORTED.includes(lang) ? lang : DEFAULT_LOCALE;
}

/**
 * Persist session locale. No-op for invalid values.
 */
function setLocale(sessionId, lang) {
  if (!SUPPORTED.includes(lang)) return;
  try {
    writeSessionFile(sessionFile(SESSION_PREFIX, sessionId), lang);
  } catch {}
}

/**
 * Idempotent: if no locale is cached for this session yet, detect from
 * `prompt` and persist; otherwise return the cached value untouched.
 * Returns `{ lang, isFresh }` — `isFresh` is true only on the first call
 * per session, so callers can announce the locale to Claude exactly once.
 */
function ensureLocale(sessionId, prompt) {
  const cached = readSessionFile(SESSION_PREFIX, sessionId);
  if (cached) {
    const lang = cached.content.trim();
    if (SUPPORTED.includes(lang)) return { lang, isFresh: false };
  }
  const detected = detectFromPrompt(prompt);
  setLocale(sessionId, detected);
  return { lang: detected, isFresh: true };
}

/**
 * Lookup a translation key in a dict shaped { en: { key: '...' }, de: { ... } }.
 * Falls back to English, then to the key itself, so a missing translation
 * never crashes a caller.
 */
function t(key, lang, dict) {
  const bucket = (dict && dict[lang]) || (dict && dict.en) || {};
  return bucket[key] != null ? bucket[key] : key;
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED,
  detectFromPrompt,
  getLocale,
  setLocale,
  ensureLocale,
  t,
};
