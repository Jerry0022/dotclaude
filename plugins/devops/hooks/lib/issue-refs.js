/**
 * @module issue-refs
 * @version 0.1.4
 * @description Which issue numbers in a prompt ask for work — for
 *   prompt.issue.detect. Every `#N` used to count as "the user referenced
 *   issue #N": the numbers were tracked, set In Progress, and every card of
 *   the session asked for Done/Todo plus a comment. On 2026-09-26 a task-chip
 *   prompt that quoted "[issue-status] Tracked issues this session: #530,
 *   #409, #431, #469" as an example put four unrelated issues on that track.
 *
 *   Deterministic — a few patterns, no parser:
 *     1. Non-prose is masked: code and quotes (the skill router's
 *        stripCodeAndQuotes, which prompt.skill.enforce uses too; a fence left
 *        open runs to the end), brackets, and whole lines of pasted output
 *        (blockquote, `[tag] …`, timestamp, log level, Claude Code hook
 *        output). A number there is no reference.
 *     2. `#N` and `Issue N` in the rest — `#N` only as a token of its own,
 *        so a hex colour is no issue: glued to a letter or digit
 *        (`#7d84a8`), to a CSS property (`color:#123456`) or with a leading
 *        zero (`#000080`). A prompt about card colours once put issues #7
 *        and #8 on the track above (2026-09-26). A pull request ("PR #471",
 *        "merge #490"), a milestone ("Meilenstein #14") or an item of another
 *        list ("Punkt #2", "retry #3") is no issue. Numbers joined only by `,`
 *        `/` `&` `and` `und` … form one list, and a list of 3+ is an
 *        enumeration, not a work item — a range ("#19–#24") included —
 *        unless a work verb leads it: "fix #12, #13 and #14" and "arbeite
 *        #19–#24 ab" track every number of it.
 *     2a. A digit-only `#333` / `#123456` (3, 4, 6 or 8 digits) is a hex
 *        colour when a colour word (color, Farbe, Rahmenfarbe, background,
 *        border, fill, rgb, hex, …) stands right beside it — directly before
 *        (only `:`/`=`/one preposition between) or as the first or second
 *        word after, with no dash, colon or comma between — or a hyphenated
 *        CSS property with a colon precedes it (`border-top-color: #333`).
 *        "fix the #333 text colour" and "setze #999 als Rahmenfarbe" tracked
 *        #333 and #999 (2026-09-26). A close keyword, a work verb or the word
 *        issue/ticket directly before the `#N` beats the colour word ("Closes
 *        #412 border radius"); only "keyword: #N" with a colour word beside
 *        stays a colour ("fix: #999 border"). The first cut (AUD-011) let any
 *        colour word within 20 characters claim the number and lost real
 *        3-digit references ("fix the border bug #412", "#540 fill the TOC",
 *        red-team R3). `hashRefs` / `isColourRef` are the one copy of this
 *        rule: closesOf (run-contract-calls), the run's issue picker
 *        (run-contract-answers) and refine matching (run-contract-obligations)
 *        use them too.
 *     3. A number (or a pair) is `track` when a work verb leads it ("fix #12",
 *        "arbeite an #12", "mach Issue #12 fertig", "closes #12", "fix the
 *        border bug #412" — one free word before bug/issue/task), a German
 *        infinitive follows it ("#12 bitte umsetzen") or it opens the prompt
 *        ("#12", "Issue #12: …"). Any other number is only mentioned: with no
 *        `track`, one or two of them are `ask` — the hook asks instead of
 *        asserting. Three or more mentioned numbers are a text citing issues,
 *        not a choice among them: nothing to ask.
 */

'use strict';

const { stripCodeAndQuotes } = require('./skill-trigger-router');

/** Stands in for a masked span: no whitespace, no word, no list separator —
 *  it breaks a verb window and a list alike. */
const MASK = ' … ';

/** Closed fences, and an open one up to the end of the prompt. */
const FENCE_RE = /(`{3,}|~{3,})[\s\S]*?(?:\1|$)/g;

/** Whole lines of pasted output, not the user's sentence. */
const LOG_LINE_RES = [
  /^\s*>/,                                              // blockquote
  /^\s*(?:[-*•]\s+)?\[[A-Za-z][^\]\n]{1,40}\]/,         // [issue-status] …  [WARN] …
  /^\s*\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,            // 2026-09-26T06:41 …
  /^\s*\[?\d{2}:\d{2}:\d{2}\b/,                         // 06:41:44 …
  /^\s*(?:error|warn(?:ing)?|info|debug|trace|fatal)\s*[:\]]/i,
  /^\s*[\w:.-]+ hook (?:success|error|feedback|blocking error|additional context)\b/i,
];

/** Innermost first; the caller repeats for nesting. */
const BRACKET_RES = [/\([^()\n]*\)/g, /\[[^[\]\n]*\]/g];

/** `#12` (not `page#12`, `owner/repo#12`, `&#12;`, `color:#123456`, `#7d84a8`,
 *  `#000080`) or `Issue 12` / `Issue #12`. Issue numbers never start with 0. */
const REF_RE =
  /(?<![\p{L}\p{N}_/&#:])#([1-9]\d{0,6})(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:issues?|tickets?)[ \t]*#?([1-9]\d{0,6})(?![\p{L}\p{N}_])/giu;

/** `#N` as a token of its own — the `#` form of REF_RE, for the shared helpers. */
const HASH_RE = /(?<![\p{L}\p{N}_/&#:])#([1-9]\d*)(?![\p{L}\p{N}_])/gu;

/** Hex colour lengths: #RGB, #RGBA, #RRGGBB, #RRGGBBAA. */
const COLOUR_LENGTHS = new Set([3, 4, 6, 8]);
/** Colour words, German compounds included (Rahmenfarbe, Textfarbe, Hintergrundbild). */
const COLOUR_WORD_RE = /(?<![\p{L}\p{N}_])(?:\p{L}*(?:farbe|farben|color|colors|colour|colours|hintergrund)\p{L}*|background|backgrounds|bg|border|borders|fill|stroke|solid|rgba?|hex|hsla?|shade|tint|palette|accent|akzent|farbton|outline)(?![\p{L}\p{N}_])/iu;
/** `border-top-color: #333`, `box-shadow: #333`, `--accent: #333` — a
 *  colour-bearing CSS property (or a custom property) before the value. Any
 *  other hyphenated word before a colon is prose: "Follow-up: #540",
 *  "Re-test: #1234". */
const CSS_PROP_BEFORE_RE = /(?<![\p{L}\p{N}_-])-*(?:[\p{L}\p{N}]+-)*(?:color|colour|background|border|fill|stroke|outline|shadow|accent|caret|decoration|rule)(?:-[\p{L}\p{N}]+)*\s*:\s*$|(?<![\p{L}\p{N}_-])--[\p{L}\p{N}-]+\s*:\s*$/iu;
/** A colour word right before the value: only `:` `=`, whitespace and at most
 *  one preposition between ("color: #123456", "set the border to #333"). */
const COLOUR_BEFORE_RE = new RegExp(
  String.raw`${COLOUR_WORD_RE.source}\s*[:=]?\s*(?:(?:to|in|of|as|auf|zu|von|mit|als)\s+)?$`, 'iu');
/** A colour word as the first or second word after the value, whitespace only
 *  between — any dash, colon or comma ends the clause ("#412 — border").
 *  A colour word followed by an article is a verb ("#540 fill the TOC"). */
const COLOUR_AFTER_RE = new RegExp(
  String.raw`^\s+(?:[\p{L}\p{N}]+\s+)?${COLOUR_WORD_RE.source}(?!\s+(?:the|a|an|this|that|die|der|das|den|dem|ein|eine|einen)(?![\p{L}]))`, 'iu');
/** Directly before `#N` (only whitespace, or a colon, between), these make it
 *  an issue whatever colour word stands near: a close keyword, a work verb, the
 *  word issue/ticket. "setz(e)" stays out — setting a value is colour talk
 *  ("setze #999 als Rahmenfarbe"). Capture 1 is the colon. */
const ISSUE_ANCHOR_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|schließt|behebt|issues?|tickets?|${
    ['fix', 'fixes', 'close', 'closes', 'resolve', 'resolves', 'solve', 'implement', 'work on',
      'tackle', 'handle', 'address', 'finish', 'complete', 'continue', 'start', 'ship', 'pick up',
      'take care of', 'fixe', 'mach', 'mache', 'arbeite', 'bearbeite', 'löse', 'loese', 'erledige',
      'implementiere', 'schließ', 'schließe', 'schliess', 'schliesse', 'übernimm', 'starte',
      'beginne', 'kümmer', 'kümmere', 'behebe', 'beheb', 'repariere', 'weiter mit', 'weiter an']
      .map(w => w.split(' ').join('\\s+')).join('|')})[ \t]*(:?)[ \t]*$`, 'iu');

/**
 * Whether the `#N` at `text[index, end)` is a hex colour, not an issue.
 * Only a digit-only `#N` of hex length can be one. In order:
 *   1. A close keyword, a work verb or issue/ticket directly before it makes it
 *      an issue ("fix #412 border", "Closes #412", "issue #412") — unless a
 *      colon follows the keyword and a colour word sits right beside the value
 *      ("fix: #999 border" is a colour; "fix: #412" is an issue).
 *   2. A CSS property with a colon before it makes it a colour.
 *   3. A colour word right before it, or as the first or second word after it
 *      in the same clause, makes it a colour ("the border #333", "#333 text
 *      colour", "#999 als Rahmenfarbe"). A colour word farther off describes
 *      something else ("fix the border bug #412", "#412 — background image").
 * @param {string} text
 * @param {number} index  position of the `#`
 * @param {number} end    position after the last digit
 * @returns {boolean}
 */
function isColourRef(text, index, end) {
  const s = String(text);
  const digits = s.slice(index + 1, end);
  if (!/^\d+$/.test(digits) || !COLOUR_LENGTHS.has(digits.length)) return false;
  const before = s.slice(Math.max(0, index - 80), index);
  const after = s.slice(end, end + 80);
  const beside = COLOUR_BEFORE_RE.test(before) || COLOUR_AFTER_RE.test(after);
  const anchor = before.match(ISSUE_ANCHOR_RE);
  if (anchor) return anchor[1] === ':' && beside;
  return CSS_PROP_BEFORE_RE.test(before) || beside;
}

/**
 * Every `#N` token of `text` that is no hex colour — the shared reading of a
 * `#N` for closesOf, the issue picker and refine matching.
 * @param {string} text
 * @returns {{n:string, index:number, end:number}[]}
 */
function hashRefs(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(HASH_RE)) {
    const end = m.index + m[0].length;
    if (!isColourRef(text, m.index, end)) out.push({ n: m[1], index: m.index, end });
  }
  return out;
}

/** What may sit between two numbers of one list. */
const LIST_SEP_RE = /^[\s,/&+]*(?:(?:and|und|or|oder|sowie|bzw\.?)[\s,]*)?$/i;
/** A range counts every number it spans: "#19–#24" is a list of six. A spaced
 *  dash stays a sentence dash. */
const RANGE_SEP_RE = /^(?:[-–]|\s+(?:bis|to|through|thru)\s+)$/i;

/** Imperatives that start work on an issue. Past forms ("fixed in #12") are
 *  citations and stay out. Phrases match with any whitespace between words. */
const LEAD_VERBS = [
  'fix', 'fixes', 'close', 'closes', 'resolve', 'resolves', 'solve', 'implement', 'work on',
  'tackle', 'handle', 'address', 'finish', 'complete', 'continue', 'start', 'ship', 'pick up',
  'take care of',
  'fixe', 'mach', 'mache', 'arbeite', 'bearbeite', 'löse', 'loese', 'erledige', 'implementiere',
  'setz', 'setze', 'schließ', 'schließe', 'schliess', 'schliesse', 'übernimm', 'starte',
  'beginne', 'kümmer', 'kümmere', 'behebe', 'beheb', 'repariere', 'weiter mit', 'weiter an',
];

/** Up to three of these may stand between the verb and the number. */
const LEAD_FILLERS = [
  'on', 'at', 'with', 'the', 'up', 'now', 'please', 'also',
  'an', 'am', 'mit', 'den', 'die', 'das', 'dem', 'der', 'dir', 'dich', 'um', 'mal', 'bitte',
  'jetzt', 'noch', 'weiter', 'auch', 'gleich', 'direkt', 'endlich',
  'issue', 'ticket', 'bug', 'task', 'aufgabe',
];

/** German verb-final requests: "#12 bitte umsetzen", "kannst du #12 fixen?". */
const TRAIL_VERBS = [
  'fixen', 'umsetzen', 'erledigen', 'bearbeiten', 'implementieren', 'lösen', 'loesen',
  'schließen', 'schliessen', 'abschließen', 'abschliessen', 'beheben', 'reparieren', 'machen',
  'angehen', 'abarbeiten', 'fertigmachen', 'fertigstellen', 'weitermachen', 'übernehmen',
  'starten', 'anfangen', 'arbeiten', 'weiterarbeiten', 'shippen',
];

/** Up to two of these may stand between the number and the infinitive. */
const TRAIL_FILLERS = [
  'bitte', 'mal', 'noch', 'jetzt', 'gleich', 'heute', 'direkt', 'weiter', 'fertig', 'zuerst',
  'endlich', 'als', 'nächstes', 'naechstes', 'erst', 'auch',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (list) => list.map(w => w.split(' ').map(escapeRe).join('\\s+')).join('|');
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}_])';

/** One free word may name the kind of issue: "fix the border bug #412". */
const LEAD_NOUNS = ['bug', 'bugs', 'issue', 'ticket', 'task', 'aufgabe', 'problem', 'fehler'];
const LEAD_RE = new RegExp(
  `${NOT_WORD_BEFORE}(?:${alt(LEAD_VERBS)}):?(?:\\s+(?:${alt(LEAD_FILLERS)})){0,3}` +
  `(?:\\s+[\\p{L}\\p{N}-]+\\s+(?:${alt(LEAD_NOUNS)}))?\\s*$`, 'iu');
const TRAIL_RE = new RegExp(
  `^:?(?:\\s+(?:${alt(TRAIL_FILLERS)})){0,2}\\s+(?:${alt(TRAIL_VERBS)})${NOT_WORD_AFTER}`, 'iu');

/** A number right after one of these is a pull request, a milestone or an
 *  item of some other list — never an issue. The optional suffix carries the
 *  plurals (PRs, Punkte, Optionen). */
const NOT_ISSUE_NOUNS = [
  'pr', 'mr', 'pull request', 'pull-request', 'merge request', 'merge-request',
  'merge', 'mergen', 'merged', 'gemergt', 'rebase', 'rebasen', 'approve',
  'milestone', 'meilenstein', 'sprint',
  'punkt', 'point', 'option', 'variante', 'variant', 'schritt', 'step', 'versuch', 'attempt',
  'try', 'retry', 'runde', 'round', 'frage', 'question', 'phase', 'stufe', 'level', 'welle', 'wave',
];
const NOT_ISSUE_FILLERS = [
  'the', 'now', 'then', 'first', 'please', 'also',
  'den', 'die', 'das', 'dann', 'erst', 'bitte', 'mal', 'noch', 'jetzt', 'auch',
];
const NOT_ISSUE_BEFORE_RE = new RegExp(
  `${NOT_WORD_BEFORE}(?:${alt(NOT_ISSUE_NOUNS)})(?:s|e|en|n)?(?:\\s+(?:${alt(NOT_ISSUE_FILLERS)}))?[ \\t]*$`, 'iu');
/** "#490 mergen" — the German verb-final form of the same. */
const NOT_ISSUE_AFTER_RE = new RegExp(
  `^(?:\\s+(?:${alt(NOT_ISSUE_FILLERS)}))?\\s+(?:mergen|rebasen|approven)${NOT_WORD_AFTER}`, 'iu');
/** Only markup may precede a number that opens the prompt. */
const SUBJECT_BEFORE_RE = /^[\s#*_-]*$/;

/** Longer than any verb plus its fillers, so the window never starts inside the verb. */
const WINDOW = 120;
const MIN_LIST = 3;
const MAX_ASK = 2;
/** A range longer than this is no work list — only its ends are named. */
const MAX_RANGE = 30;

/**
 * The prompt with every non-prose span replaced by a mask.
 * @param {string} text
 * @returns {string}
 */
function maskNonProse(text) {
  let s = String(text).replace(FENCE_RE, MASK);
  s = s.split('\n').map(line => (LOG_LINE_RES.some(rx => rx.test(line)) ? MASK : line)).join('\n');
  s = stripCodeAndQuotes(s);
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const rx of BRACKET_RES) s = s.replace(rx, MASK);
    if (s === before) break;
  }
  return s;
}

/** Issue numbers in the prose, grouped into lists; `size` counts a range in full. */
function numberRuns(prose) {
  const runs = [];
  for (const m of prose.matchAll(REF_RE)) {
    const n = m[1] || m[2];
    const start = m.index;
    const end = start + m[0].length;
    if (m[1] && isColourRef(prose, start, end)) continue;
    const last = runs[runs.length - 1];
    const between = last ? prose.slice(last.end, start) : '';
    if (last && RANGE_SEP_RE.test(between)) {
      const from = Number(last.items[last.items.length - 1]);
      last.size += Math.max(1, Math.abs(Number(n) - from));
      // "#19–#24" asks for 20–23 too; a reversed or huge span stays its ends.
      if (Number(n) > from && Number(n) - from <= MAX_RANGE) {
        for (let k = from + 1; k < Number(n); k++) last.items.push(String(k));
      }
      last.items.push(n);
      last.end = end;
    } else if (last && LIST_SEP_RE.test(between)) {
      last.size += 1;
      last.items.push(n);
      last.end = end;
    } else {
      runs.push({ items: [n], size: 1, start, end });
    }
  }
  return runs;
}

/**
 * @param {string} message  the user's prompt
 * @returns {{ track: string[], ask: string[] }}  `track`: the prompt asks for
 *   work on these; `ask`: only mentioned — ask before tracking.
 */
function issueRefs(message) {
  if (typeof message !== 'string' || !message) return { track: [], ask: [] };
  const prose = maskNonProse(message);
  const track = [];
  const mentioned = [];
  for (const run of numberRuns(prose)) {
    const before = prose.slice(Math.max(0, run.start - WINDOW), run.start);
    const after = prose.slice(run.end, run.end + WINDOW);
    if (NOT_ISSUE_BEFORE_RE.test(before) || NOT_ISSUE_AFTER_RE.test(after)) continue;
    // A list of 3+ is an enumeration — unless a work verb leads it (R5).
    if (run.size >= MIN_LIST) {
      if (!LEAD_RE.test(before)) continue;
      for (const n of run.items) if (!track.includes(n)) track.push(n);
      continue;
    }
    const opensPrompt = run.items.length === 1 && SUBJECT_BEFORE_RE.test(prose.slice(0, run.start));
    const requested = opensPrompt || LEAD_RE.test(before) || TRAIL_RE.test(after);
    const into = requested ? track : mentioned;
    for (const n of run.items) if (!into.includes(n)) into.push(n);
  }
  const rest = mentioned.filter(n => !track.includes(n));
  const ask = track.length > 0 || rest.length > MAX_ASK ? [] : rest;
  return { track, ask };
}

module.exports = { issueRefs, maskNonProse, hashRefs, isColourRef };
