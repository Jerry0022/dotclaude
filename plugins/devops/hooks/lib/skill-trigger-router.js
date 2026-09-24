/**
 * @module skill-trigger-router
 * @version 0.7.0
 * @description Pure trigger-matching core for `prompt.skill.enforce`'s router
 *   half (PR 1 + PR 2 of the skill restructure —
 *   docs/superpowers/specs/2026-09-24-skill-restructure-design.md "Triggers —
 *   how hidden skills still run").
 *
 *   The router turns a match into a MANDATORY Skill load, so it only uses
 *   signals that are unambiguous on their own. Everything else is left to the
 *   model, which still reads each skill's full description (including its
 *   "Do NOT trigger for …" negations). Three signal sources:
 *
 *   1. **Alias mentions** — the pre-PR-2 names (`/fix`, `/concept`,
 *      `/claude-learn`, `/run-backlog`, `/promote`, …) mapped to the skill
 *      that now owns them via `ALIAS_MAP` (built from `skill-names.js`);
 *      a folded name also carries its mode (`/run-backlog` → do-run mode
 *      `backlog`). The PR-3 RETIRED names (`/setup-readme`, `/auto-graph`,
 *      `/auto-usage`, `/claude-strict`) have no alias at all — they name no
 *      skill; prompt.knowledge.dispatch points at their docs and
 *      prompt.strict.enforce owns the strict switch. A 1:1 alias of a skill
 *      owned by a dedicated hook
 *      (`SKIP_SKILLS`: do-ship, do-batch) emits nothing —
 *      `prompt.ship.detect` and `prompt.batch.collect` recognise `/ship`
 *      and `/claude-batch` themselves. do-ship is owned WHOLE by its hook
 *      (`HOOK_OWNED_MODES`): its folded `promote` mode (`/promote`,
 *      "promote to stable") is a target channel of the ship now, parsed by
 *      `lib/ship-intent.js`, so the router emits nothing for it either. The NEW names are real skills and go through the inline
 *      mention path in `prompt.skill.enforce`.
 *      Reach: only a prompt that reaches UserPromptSubmit is seen here. A
 *      typed `/old-name` at the very start of a prompt is a slash command to
 *      the harness; whether an unknown one is rejected locally or passed on
 *      is undocumented (spec § Triggers), so the alias is only guaranteed
 *      for mid-prompt mentions ("mach das mit /fix").
 *   2. **Trigger phrases** from every skill's `triggers:` frontmatter
 *      (`hooks/lib/skill-meta.js`) — but only three kinds:
 *        - **multi-word phrases** ("this is broken", "führe mich durch"),
 *          minus the per-skill `PHRASE_DENYLIST` of phrases that are
 *          ambiguous in everyday speech ("prüf alles", "neue version");
 *        - **slash forms** that are not a skill directory name themselves
 *          (`/devops-learn` → do-learn; a real `/name` is the inline
 *          mention path in `prompt.skill.enforce.js`);
 *        - **single words** only when listed in the curated
 *          `SINGLE_WORD_ALLOWLIST` (words nobody uses by accident:
 *          "festgefahren", "feinschliff", …). A bare "error", "debug",
 *          "audit", "polish", "stuck", "strict", "promote", "concept" never
 *          forces a load — the model decides from the description.
 *      Plus the router-only `ROUTER_PHRASES` (not frontmatter): the
 *      verb-object forms of a word whose bare form is too ambiguous —
 *      "ein concept", "concept für", "als concept", "concept-seite", … —
 *      so "concept A passt" or "der concept skill …" stay silent.
 *      The frontmatter itself stays complete (trigger-preservation test);
 *      the allowlist/denylist only narrow what the ROUTER acts on.
 *   3. **Error patterns** — language-independent bug-report signals route to
 *      `auto-fix`. A stack frame or `Traceback` counts anywhere, including inside
 *      a fenced code block (that is where a pasted trace lives). A bare
 *      `…Error:` / `…Exception:` only counts in the prose OUTSIDE fences
 *      (pasted code like `except ValueError:` is not a report). An HTTP
 *      4xx/5xx counts only in prose, next to an HTTP context word, an error
 *      word AND a bug phrase ("geht nicht", "broken", …) — a feature request
 *      ("GET on an unknown route should return 404 not found") is no bug.
 *
 *   ## Meta-word proximity (soft matches)
 *
 *   A trigger phrase with a meta word (skill, hook, runner, guard, hint,
 *   trigger, router, extension, agent — plurals included) within
 *   `META_WINDOW` tokens on either side talks ABOUT the component ("der web
 *   guide hint nervt"), so its entry carries `nearMeta: true`; the caller
 *   turns it into a non-mandatory hint.
 *
 *   ## Suppression zone
 *
 *   Alias mentions and trigger phrases are matched against the prompt with
 *   fenced code, inline code spans and quoted strings removed ("…", '…',
 *   „…“, “…”, »…«, «…»). Apostrophes inside words ("doesn't", "it's") are
 *   not quotes. Word boundaries are Unicode-aware and also refuse `_`, `-`,
 *   `/`, `\` and a `.` glued to a letter, so identifiers and paths
 *   (`AUTONOMOUS_RESUME`, `docs/concept-page.md`) never match. Han/Kana
 *   phrases (no spaces) of 3+ characters count as multi-word and match as a
 *   substring.
 *
 *   ## Latency
 *
 *   Phrases are matched with `indexOf` on a lowercased, whitespace-collapsed
 *   haystack plus two boundary regexes compiled once — not one `\p{L}` regex
 *   per phrase (~0.8 ms compile each, ~90 ms for the corpus). Measured
 *   2026-09-24: first call ~2 ms, then ~0.2 ms per prompt.
 *
 *   ## Context the caller applies (prompt.skill.enforce)
 *
 *   Machine prompts, batch mode, a running skill, strict mode and consumer
 *   plugin-scope routing are state checks, not text matching — they live in
 *   the hook, which filters this module's output (see its header).
 */

const { RENAMED, FOLDED, modeForPhrase } = require('./skill-names');

/** Skills owned by a dedicated UserPromptSubmit hook: `do-ship`
 *  (prompt.ship.detect), `do-batch` (prompt.batch.collect). Strict is no
 *  skill any more (PR 3) — prompt.strict.enforce owns it outright. The
 *  router never emits them —
 *  not from phrases and not from 1:1 aliases — so two hooks never issue
 *  conflicting mandates for one prompt. A phrase or alias of a FOLDED mode
 *  of such a skill still routes, tagged with its mode — unless the skill is
 *  in HOOK_OWNED_MODES. */
const SKIP_SKILLS = new Set(['do-ship', 'do-batch']);

/** Dedicated-hook skills whose folded modes the hook owns too. do-ship: the
 *  promote mode became the ship's target channel ("promote stable" = ship if
 *  needed, then promote), and prompt.ship.detect parses it
 *  (lib/ship-intent.js) — a router mandate with args "promote" next to the
 *  hook's args "stable" would be two conflicting orders. */
const HOOK_OWNED_MODES = new Set(['do-ship']);

/** Multi-word (and a few single-word) frontmatter phrases the router ignores
 *  because they are ambiguous in ordinary prose, or owned elsewhere:
 *  - do-ship "release" — a ship-intent keyword (prompt.ship.detect; the
 *    whole of do-ship is hook-owned anyway, HOOK_OWNED_MODES);
 *  - do-run (audit mode) "prüf alles" — "prüf alles nochmal" is a review
 *    request;
 *  - auto-update "neue version" — "neue Version der Datei"; "update plugin",
 *    "plugin updaten", "self update" — generic consumer-project phrases
 *    ("update plugin settings for eslint", "das vite plugin updaten"), and
 *    auto-update is explicit-only per its description;
 *  - auto-concept "visualize this" — "visualize this as a bar chart";
 *  - auto-guide "guide me through" — "guide me through this code" is a
 *    code walkthrough, not a website guide;
 *  - auto-agents "use agents" / "parallel agents" — a hard go for the
 *    delegation policy (spawn directly), not a request for the auto-agents
 *    ceremony (deep-knowledge/agent-proactivity.md);
 *  - auto-issue "new issue" / "neues issue" — "that's a new issue after
 *    the merge", "das ist ein neues Issue";
 *  - auto-harden "lint und fix" — "lint und fix, dann ship" is a plain
 *    to-do list, not a hardening pass.
 *  (setup-readme, auto-graph and auto-usage had entries here until PR 3
 *  retired them; their phrases now only point at a deep-knowledge doc,
 *  lib/knowledge-pointers.js.)
 *  Compared lowercase. */
const PHRASE_DENYLIST = Object.freeze({
  'do-ship': new Set(['release']),
  'do-run': new Set(['prüf alles']),
  'auto-update': new Set(['neue version', 'update plugin', 'plugin updaten', 'self update']),
  'auto-agents': new Set(['use agents', 'parallel agents']),
  'auto-issue': new Set(['new issue', 'neues issue']),
  'auto-harden': new Set(['lint und fix']),
  'auto-concept': new Set(['visualize this']),
  'auto-guide': new Set(['guide me through']),
});

/** The ONLY single-word triggers that force a load — words that name the
 *  skill's job and hardly occur otherwise. Compared lowercase; a word must
 *  also be in the skill's own `triggers:` to count. */
const SINGLE_WORD_ALLOWLIST = Object.freeze({
  // rethink mode: festgefahren, unstuck · audit mode: the three audit words
  'do-run': new Set(['festgefahren', 'unstuck', 'auditiere', 'auditieren', 'qualitätsaudit']),
  'auto-harden': new Set(['stabilisieren', 'härten']),
  'auto-polish': new Set(['feinschliff']),
});

/** Router-only phrases (not in any frontmatter): verb-object forms of a word
 *  that is too ambiguous alone. A bare "concept" is everyday talk in this
 *  repo ("concept A passt", "im concept fehlt X", "der concept skill …") and
 *  a false match forces a 1.4k-line skill, so only a request FOR a concept
 *  routes. Compared lowercase; matched with the same word-boundary rules. */
const ROUTER_PHRASES = Object.freeze({
  'auto-concept': Object.freeze([
    'ein concept', 'concept für', 'concept dazu', 'als concept', 'concept-seite', 'concept-page',
    'make a concept', 'create a concept', 'a concept for',
  ]),
});

/** Words that make a nearby trigger phrase talk ABOUT a plugin component
 *  ("der backlog runner parkt zu früh") instead of asking for it. */
const META_WORD_RE = /^(?:skill|hook|runner|guard|hint|trigger|router|extension|agent)(?:s|en)?$/;
/** Tokens inspected on each side of a phrase for a meta word. */
const META_WINDOW = 3;
/** Meta words are ASCII, so splitting on whitespace and ASCII punctuation is
 *  enough — and avoids a lazily compiled `\p{L}` regex (~2 ms first call). */
const TOKEN_SPLIT_RE = /[\s!-/:-@[-`{-~]+/;

/**
 * Alias map after the PR 2 renames: every OLD name → the skill that owns it
 * now, plus the mode for a folded skill (`run-burn` → do-run mode `burn`).
 * Built from `skill-names.js` so the renames live in exactly one table.
 * A 1:1 alias whose target is in SKIP_SKILLS (`/ship`, `/claude-batch`) is
 * filtered out by `detectAliasHits` — the dedicated hook owns it. A folded
 * alias passes unless its skill is in HOOK_OWNED_MODES (`/promote` →
 * prompt.ship.detect).
 * @type {Readonly<Record<string, {skill:string, mode:string|null}>>}
 */
const ALIAS_MAP = Object.freeze(Object.fromEntries([
  ...Object.entries(RENAMED).map(([oldName, skill]) => [oldName, Object.freeze({ skill, mode: null })]),
  ...Object.entries(FOLDED).map(([oldName, f]) => [oldName, Object.freeze({ skill: f.skill, mode: f.mode })]),
]));

/** `/<name>` preceded by start, whitespace or opening punctuation — never a
 *  path segment. Mirrors `prompt.skill.enforce`'s MENTION_RE. */
const SLASH_MENTION_RE = /(^|[\s([{>])\/([a-z][a-z0-9-]*)/gi;

/** Letters/digits and identifier/path glue — nothing a trigger may touch.
 *  Two regexes compiled ONCE: a per-phrase \p{L} regex costs ~0.8 ms to
 *  compile, which for ~100 phrases blew the router's latency budget. */
const LETTER_DIGIT_RE = /[\p{L}\p{N}]/u;
const GLUE_CHAR_RE = /[\p{L}\p{N}_\-/\\]/u;

/** Lowercase + collapse whitespace + straighten typographic apostrophes, so
 *  phrases compare with plain indexOf. Apply to haystack and needle alike. */
function normalizeForMatch(text) {
  return String(text).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
}

/** Straight / curly single quotes only count at a word edge ("doesn't"). */
const QUOTE_SINGLE_RE = /(^|[^\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;
const QUOTE_CURLY_SINGLE_RE = /(^|[^\p{L}\p{N}])\u2018[^\u2019\n]*\u2019(?![\p{L}\p{N}])/gu;

/**
 * Remove fenced code, inline code spans and quoted strings. Straight single
 * quotes only count as quotes at a word edge, so "doesn't … it's" is kept.
 * @param {string} message
 * @returns {string}
 */
function stripCodeAndQuotes(message) {
  if (typeof message !== 'string') return '';
  return message
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/„[^"“”\n]*[“”"]/g, ' ')
    .replace(/“[^”\n]*”/g, ' ')
    .replace(/»[^«\n]*«/g, ' ')
    .replace(/«[^»\n]*»/g, ' ')
    .replace(QUOTE_SINGLE_RE, '$1 ')
    .replace(QUOTE_CURLY_SINGLE_RE, '$1 ');
}

/** Only fenced code removed — the prose a user wrote around a pasted trace. */
function stripFences(message) {
  if (typeof message !== 'string') return '';
  return message.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
}

/**
 * Detect old-name slash mentions (`/fix`, `/claude-learn`, `/run-backlog`,
 * …) outside code and quotes and map them to the skill (and mode) that owns
 * them now. 1:1 aliases of SKIP_SKILLS are dropped.
 * @param {string} message
 * @returns {{skill:string, mode:string|null, alias:string}[]} deduped by
 *   skill, in order of appearance
 */
function detectAliasHits(message) {
  if (typeof message !== 'string' || !message) return [];
  const found = [];
  for (const m of stripCodeAndQuotes(message).matchAll(SLASH_MENTION_RE)) {
    const alias = m[2].toLowerCase().replace(/-+$/, '');
    if (!Object.prototype.hasOwnProperty.call(ALIAS_MAP, alias)) continue;
    const target = ALIAS_MAP[alias];
    if (SKIP_SKILLS.has(target.skill) && (!target.mode || HOOK_OWNED_MODES.has(target.skill))) continue;
    if (found.some(h => h.skill === target.skill)) continue;
    found.push({ skill: target.skill, mode: target.mode, alias });
  }
  return found;
}

/**
 * Skill names only — see `detectAliasHits`.
 * @param {string} message
 * @returns {string[]} deduped current skill names, in order of appearance
 */
function detectAliasMentions(message) {
  return detectAliasHits(message).map(h => h.skill);
}

/** Chinese/Japanese script ranges: no inter-word spaces, so a trigger phrase
 *  in these scripts is matched as a plain substring. */
const NO_SPACE_SCRIPT_RE = /[一-鿿぀-ヿｦ-ﾟ]/;

/** Every index where `needle` occurs in `hay`. */
function* occurrences(hay, needle) {
  if (!needle) return;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    yield i;
    i = hay.indexOf(needle, i + 1);
  }
}

/**
 * Build a matcher for one trigger phrase. `find`/`test` expect a haystack
 * already passed through `normalizeForMatch` (matchWordTriggers does that
 * once). `find` returns the index of the first valid match, or -1.
 * @param {string} phrase
 * @returns {{find:(hay:string)=>number, test:(hay:string)=>boolean, length:number, isSingleWord:boolean}}
 */
function buildPhraseMatcher(phrase) {
  const p = String(phrase).trim();
  const isSingleWord = !/\s/.test(p);
  const needle = normalizeForMatch(p);
  let find;
  if (NO_SPACE_SCRIPT_RE.test(p)) {
    find = (hay) => hay.indexOf(needle);
  } else if (needle.startsWith('/')) {
    find = (hay) => {
      for (const i of occurrences(hay, needle)) {
        const before = i === 0 ? '' : hay[i - 1];
        const after = hay[i + needle.length] || '';
        if ((before === '' || /[\s([{>]/.test(before)) && !(after && GLUE_CHAR_RE.test(after))) return i;
      }
      return -1;
    };
  } else {
    find = (hay) => {
      for (const i of occurrences(hay, needle)) {
        const before = i === 0 ? '' : hay[i - 1];
        const after = hay[i + needle.length] || '';
        const next = hay[i + needle.length + 1] || '';
        if (before && (before === '.' || GLUE_CHAR_RE.test(before))) continue;
        if (after && GLUE_CHAR_RE.test(after)) continue;
        if (after === '.' && next && LETTER_DIGIT_RE.test(next)) continue;
        return i;
      }
      return -1;
    };
  }
  return { find, test: (hay) => find(hay) !== -1, length: needle.length, isSingleWord };
}

/**
 * Is a meta word within META_WINDOW tokens before or after the match?
 * @param {string} hay normalized haystack
 * @param {number} start match index
 * @param {number} length match length
 */
function nearMetaWord(hay, start, length) {
  const before = hay.slice(0, start).split(TOKEN_SPLIT_RE).filter(Boolean).slice(-META_WINDOW);
  const after = hay.slice(start + length).split(TOKEN_SPLIT_RE).filter(Boolean).slice(0, META_WINDOW);
  return before.some(t => META_WORD_RE.test(t)) || after.some(t => META_WORD_RE.test(t));
}

/**
 * Should the router act on this frontmatter phrase?
 * @param {string} skill
 * @param {string} phrase
 * @param {Set<string>} skillNames every skill directory name
 */
function isRoutablePhrase(skill, phrase, skillNames) {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return false;
  const denied = PHRASE_DENYLIST[skill];
  if (denied && denied.has(lower)) return false;
  if (lower.startsWith('/')) {
    // A real skill name is the inline-mention path's job.
    return !skillNames.has(lower.slice(1));
  }
  if (/\s/.test(lower)) return true;
  // Han/Kana have no spaces: a phrase of 3+ characters is several words.
  if (NO_SPACE_SCRIPT_RE.test(lower) && [...lower].length >= 3) return true;
  const allowed = SINGLE_WORD_ALLOWLIST[skill];
  return !!(allowed && allowed.has(lower));
}

/**
 * Flatten every skill's `triggers:` frontmatter plus `ROUTER_PHRASES` into
 * the router corpus (SKIP_SKILLS dropped except the folded-mode phrases of
 * a skill outside HOOK_OWNED_MODES, only routable phrases kept). A phrase of a folded mode carries `mode`.
 * @param {Record<string, object>} skills — from `skill-meta.loadAllSkills`
 * @returns {{skill:string, phrase:string, matcher:object, mode?:string}[]} longest first
 */
function buildWordTriggerCorpus(skills) {
  const entries = [];
  const names = new Set(Object.keys(skills || {}).map(n => n.toLowerCase()));
  for (const [name, meta] of Object.entries(skills || {})) {
    const skipped = SKIP_SKILLS.has(name);
    const skippedWhole = skipped && HOOK_OWNED_MODES.has(name);
    const byLang = meta && meta.triggers && typeof meta.triggers === 'object' ? meta.triggers : {};
    for (const list of Object.values(byLang)) {
      if (!Array.isArray(list)) continue;
      for (const phrase of list) {
        if (typeof phrase !== 'string' || !phrase.trim()) continue;
        const mode = modeForPhrase(name, phrase);
        if (skipped && (!mode || skippedWhole)) continue;
        if (!isRoutablePhrase(name, phrase, names)) continue;
        const entry = { skill: name, phrase, matcher: buildPhraseMatcher(phrase) };
        if (mode) entry.mode = mode;
        entries.push(entry);
      }
    }
    if (skipped) continue;
    for (const phrase of ROUTER_PHRASES[name] || []) {
      entries.push({ skill: name, phrase, matcher: buildPhraseMatcher(phrase) });
    }
  }
  entries.sort((a, b) => b.phrase.length - a.phrase.length);
  return entries;
}

/**
 * Match the corpus against a message (code and quotes removed first).
 * @param {string} message raw prompt
 * @param {{skill:string,phrase:string,matcher:object}[]} corpus
 * @returns {{skill:string, phrase:string, mode?:string, nearMeta?:true}[]}
 *   deduped by skill; `nearMeta` only when a meta word sits next to the match
 */
function matchWordTriggers(message, corpus) {
  if (typeof message !== 'string' || !message) return [];
  const haystack = normalizeForMatch(stripCodeAndQuotes(message));
  const seen = new Set();
  const out = [];
  for (const entry of corpus) {
    if (seen.has(entry.skill)) continue;
    const i = entry.matcher.find(haystack);
    if (i === -1) continue;
    seen.add(entry.skill);
    const hit = { skill: entry.skill, phrase: entry.phrase };
    if (entry.mode) hit.mode = entry.mode;
    if (nearMetaWord(haystack, i, entry.matcher.length)) hit.nearMeta = true;
    out.push(hit);
  }
  return out;
}

// --- Language-independent error-pattern → auto-fix routing -----------------

const STACK_FRAME_RE = /\bat\s+[^\s(]+\s*\([^()\n]*:\d+:\d+\)/; // "at fn (file:line:col)"
const PY_FRAME_RE = /File\s+"[^"\n]+",\s+line\s+\d+/; // File "x.py", line N
const TRACEBACK_RE = /Traceback\s*\(most recent call last\)/i;
const ERROR_CLASS_RE = /\b[A-Z][A-Za-z0-9_]*(?:Error|Exception)\b\s*:/; // TypeError:, NullPointerException:
/** A 4xx/5xx that is not an issue/PR number (`#471`), a version or a path. */
const HTTP_STATUS_RE = /(?<![#\d./:-])\b[45]\d{2}\b(?![\d.])/;
/** The status must sit in an HTTP context, not just next to "failed". */
const HTTP_CONTEXT_RE = /\b(?:HTTP|status|GET|POST|PUT|PATCH|DELETE|response)\b/i;
const ERROR_WORD_RE = /\b(error|failed|failure|exception|unauthorized|forbidden|not\s+found)\b/i;

/** A prompt phrased as a question ABOUT an error, not a report of one. */
const EXPLAIN_QUESTION_RE = /\b(what\s+(is|does|are)|why\s+(is|does|do)|explain|erklär\w*|was\s+(ist|bedeutet))\b/i;

/** Words that make a question a bug report after all ("why does this crash?"). */
const BUG_PHRASE_RE =
  /(?<![\p{L}\p{N}])(?:broken|kaputt|crash\w*|abgestürzt|stürzt\w*|doesn'?t\s+work|does\s+not\s+work|not\s+working|won'?t\s+(?:start|load|build|run)|geht\s+nicht|funktioniert\s+nicht|klappt\s+nicht|fails?|failing|schlägt\s+fehl|fehlgeschlagen)(?![\p{L}\p{N}])/iu;

/**
 * Language-independent bug-report detector. A stack frame / Traceback is
 * searched in the whole message (a pasted trace lives in a code fence); a
 * bare `…Error:` class and the HTTP signal only in the prose OUTSIDE fences
 * (pasted code is not a report), the HTTP signal additionally only with a
 * bug phrase. The question guard reads only the prose.
 * @param {string} message
 * @returns {boolean}
 */
function looksLikeBugReport(message) {
  if (typeof message !== 'string' || !message) return false;
  const prose = stripFences(message);
  const strong = STACK_FRAME_RE.test(message)
    || PY_FRAME_RE.test(message)
    || TRACEBACK_RE.test(message)
    || ERROR_CLASS_RE.test(prose);
  const httpCandidate = HTTP_STATUS_RE.test(prose)
    && HTTP_CONTEXT_RE.test(prose)
    && ERROR_WORD_RE.test(prose);
  // The \p{…} bug-phrase regex compiles lazily (~1 ms) — only test it when
  // there is a signal at all.
  if (!strong && !httpCandidate) return false;
  const hasBugPhrase = BUG_PHRASE_RE.test(prose);
  if (!strong && !hasBugPhrase) return false;
  // A question in the user's own prose (not a `?` inside a URL/query).
  if (/\?(?=\s|$)/.test(prose) && !hasBugPhrase) return false;
  if (message.trim().endsWith('?') && EXPLAIN_QUESTION_RE.test(message) && !hasBugPhrase) return false;
  return true;
}

/**
 * Dedupe by skill (first occurrence wins) and cap.
 * @param {{skill:string, reason:string}[]} entries
 * @param {number} cap
 */
function capAndDedupe(entries, cap = 4) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (seen.has(e.skill)) continue;
    seen.add(e.skill);
    out.push(e);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Full router: alias mentions, trigger phrases, error patterns — ordered,
 * deduped, capped. Each entry carries `explicit: true` when the user typed a
 * name (alias), so the caller's context filters (already running, strict …)
 * can spare it; `phrase: true` for a trigger-phrase match (the caller softens
 * those in the plugin source repo) and `nearMeta: true` when a meta word
 * sits next to that phrase.
 *
 * @param {string} message raw prompt
 * @param {Record<string, object>} skills — `skill-meta.loadAllSkills` output
 * @param {{cap?:number}} [opts]
 * @returns {{skill:string, reason:string, mode?:string, explicit?:boolean, phrase?:boolean, nearMeta?:boolean}[]}
 */
function routeMessage(message, skills, opts = {}) {
  const cap = opts.cap || 4;
  if (typeof message !== 'string' || !message) return [];
  const known = skills && typeof skills === 'object' ? skills : {};

  const entries = [];

  for (const { skill, mode, alias } of detectAliasHits(message)) {
    if (!known[skill]) continue;
    const e = { skill, reason: `alias /${alias}${mode ? ` (mode ${mode})` : ''}`, explicit: true };
    if (mode) e.mode = mode;
    entries.push(e);
  }

  // Before the phrases: when both hit `auto-fix`, the dedupe keeps the error
  // pattern, which the caller never softens.
  if (known['auto-fix'] && looksLikeBugReport(message)) {
    entries.push({ skill: 'auto-fix', reason: 'error pattern (stack trace / Traceback / Error class / HTTP status)' });
  }

  const corpus = buildWordTriggerCorpus(known);
  for (const { skill, phrase, nearMeta, mode } of matchWordTriggers(message, corpus)) {
    const e = { skill, reason: `trigger phrase "${phrase}"${mode ? ` (mode ${mode})` : ''}`, phrase: true };
    if (mode) e.mode = mode;
    if (nearMeta) e.nearMeta = true;
    entries.push(e);
  }

  return capAndDedupe(entries, cap);
}

module.exports = {
  ALIAS_MAP,
  SKIP_SKILLS,
  HOOK_OWNED_MODES,
  PHRASE_DENYLIST,
  SINGLE_WORD_ALLOWLIST,
  ROUTER_PHRASES,
  META_WORD_RE,
  nearMetaWord,
  detectAliasMentions,
  detectAliasHits,
  buildPhraseMatcher,
  isRoutablePhrase,
  buildWordTriggerCorpus,
  stripCodeAndQuotes,
  stripFences,
  matchWordTriggers,
  looksLikeBugReport,
  capAndDedupe,
  routeMessage,
};
