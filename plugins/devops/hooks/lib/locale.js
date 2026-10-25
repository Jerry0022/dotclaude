/**
 * @module locale
 * @version 0.2.0
 * @description Session-scoped UI locale detection and lookup.
 *
 *   The plugin renders user-facing strings (completion-card CTAs, hook prompts,
 *   skill output templates) in either English or German. The locale is detected
 *   from the first non-trivial user prompt — heuristically by counting
 *   German-language markers — and cached in a session file so all hooks/skills
 *   agree. Each later prompt with a clear language signal updates the cache,
 *   so the locale follows the language the user is writing in right now.
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

// English markers for the switch-back direction. Only consulted when the
// prompt has fewer than two German hits, so German prompts that quote code
// or English terms never flip to 'en'.
const EN_WORDS = [
  'the', 'this', 'that', 'these', 'those', 'please', 'what', 'why', 'how',
  'should', 'could', 'would', 'does', 'did', 'is', 'are', 'was', 'were',
  'you', 'your', 'it', 'its', 'can', 'with', 'from', 'about', 'again',
];

/**
 * Like detectFromPrompt, but returns null when the prompt carries no clear
 * language signal ("ok", "/do-ship", a pasted path). A cached session locale
 * only switches on a clear signal, so short acknowledgements never flip it.
 */
function detectSignal(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  if (detectFromPrompt(prompt) === 'de') return 'de';
  const tokens = new Set(prompt.toLowerCase().match(/[a-z]+/g) || []);
  let hits = 0;
  for (const w of EN_WORDS) {
    if (tokens.has(w)) {
      hits += 1;
      if (hits >= 3) return 'en';
    }
  }
  return null;
}

// Prompts the app, the harness or the plugin itself put into the user slot.
// They are English by construction and say nothing about the user's language:
// letting them through flipped 27 of 120 German sessions to `[ui-locale: en]`
// (audit 2026-10-22), mostly on <task-notification> turns, and Claude then
// answered in English. Matched against the trimmed start of the prompt.
const INJECTED_PROMPT = new RegExp('^(?:' + [
  '<task-notification', '<side-sessions-event', '<ci-monitor-event',
  '<system-reminder', '<scheduled-task', '<local-command',
  'Continue from where you left off',
  'The app was quit while you were working',
  '\\[Your previous response',
  '\\[Request interrupted',
  'This session is being continued',
  'Stop hook feedback:',
  'Silently run via Bash:',
  'Base directory for this skill:',
  'Skill /',
  'AUTONOMOUS_',
  'Another Claude session sent a message',
].join('|') + ')');

/** True when the prompt was generated, not typed by the user. */
function isInjectedPrompt(prompt) {
  return typeof prompt === 'string' && INJECTED_PROMPT.test(prompt.trimStart());
}

// Pasted material and harness reminders inside a typed prompt are not the
// user's own words either ("ok" + a pasted English log must not flip to en).
function ownWords(prompt) {
  return prompt
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, ' ');
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
 * First call per session: detect from `prompt` and persist. Later calls
 * follow the language of the latest prompt, but only when it carries a clear
 * signal (detectSignal); otherwise the cached value stands. Locking the
 * locale to the first prompt made a session that opened with "/do-ship" or an
 * English sentence answer in English for its whole lifetime.
 * Returns `{ lang, isFresh }` — `isFresh` is true only on the first call
 * per session, so callers can announce the locale to Claude exactly once.
 */
function ensureLocale(sessionId, prompt) {
  const cached = readSessionFile(SESSION_PREFIX, sessionId);
  if (isInjectedPrompt(prompt)) {
    // Never detect from, cache from or announce on a generated prompt.
    const lang = cached && cached.content.trim();
    return { lang: SUPPORTED.includes(lang) ? lang : DEFAULT_LOCALE, isFresh: false };
  }
  if (typeof prompt === 'string') prompt = ownWords(prompt);
  if (cached) {
    const lang = cached.content.trim();
    if (SUPPORTED.includes(lang)) {
      const signal = detectSignal(prompt);
      if (signal && signal !== lang) {
        setLocale(sessionId, signal);
        return { lang: signal, isFresh: false };
      }
      return { lang, isFresh: false };
    }
  }
  const detected = detectFromPrompt(prompt);
  setLocale(sessionId, detected);
  return { lang: detected, isFresh: true };
}

/**
 * The cached session locale, or null when none was set yet. Never detects —
 * for turns that are not the user's own words (task notifications, ticks).
 */
function peekLocale(sessionId) {
  const cached = readSessionFile(SESSION_PREFIX, sessionId, { exact: true });
  const lang = cached && cached.content.trim();
  return SUPPORTED.includes(lang) ? lang : null;
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
  detectSignal,
  getLocale,
  setLocale,
  ensureLocale,
  peekLocale,
  isInjectedPrompt,
  t,
};
