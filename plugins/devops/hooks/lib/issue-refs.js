/**
 * @module issue-refs
 * @version 0.1.0
 * @description Which issue numbers in a prompt ask for work — for
 *   prompt.issue.detect. Every `#N` used to count as "the user referenced
 *   issue #N": the numbers were tracked, set In Progress, and every card of
 *   the session asked for Done/Todo plus a comment. On 2026-09-26 a task-chip
 *   prompt that quoted "[issue-status] Tracked issues this session: #530,
 *   #409, #431, #469" as an example put four unrelated issues on that track.
 *
 *   Deterministic — a few patterns, no parser:
 *     1. Non-prose is masked: code fences and spans, quotes, brackets, and
 *        whole lines of pasted output (blockquote, `[tag] …`, timestamp, log
 *        level, Claude Code hook output). A number there is no reference.
 *     2. `#N` and `Issue N` in the rest. A pull request ("PR #471",
 *        "merge #490"), a milestone ("Meilenstein #14") or an item of another
 *        list ("Punkt #2", "retry #3") is no issue. Numbers joined only by `,`
 *        `/` `&` `and` `und` … form one list, and a list of 3+ is an
 *        enumeration, not a work item — a range ("#19–#24") included.
 *     3. A number (or a pair) is `track` when a work verb leads it ("fix #12",
 *        "arbeite an #12", "mach Issue #12 fertig", "closes #12"), a German
 *        infinitive follows it ("#12 bitte umsetzen") or it opens the prompt
 *        ("#12", "Issue #12: …"). Any other number is only mentioned: with no
 *        `track`, one or two of them are `ask` — the hook asks instead of
 *        asserting. Three or more mentioned numbers are a text citing issues,
 *        not a choice among them: nothing to ask.
 */

'use strict';

/** Stands in for a masked span: no whitespace, no word, no list separator —
 *  it breaks a verb window and a list alike. */
const MASK = ' … ';

/** An open fence runs to the end of the prompt. */
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

/** Same-line spans. German quotes before English ones: „…“ closes with the
 *  mark English opens with. The ASCII single quote only pairs when it is no
 *  apostrophe (don't, it's). */
const SPAN_RES = [
  /`[^`\n]+`/g,
  /„[^„“”\n]*[“”]/g,
  /‚[^‚‘’\n]*[‘’]/g,
  /“[^“”\n]*”/g,
  /‘[^‘’\n]*’/g,
  /«[^«»\n]*»/g,
  /»[^«»\n]*«/g,
  /‹[^‹›\n]*›/g,
  /›[^‹›\n]*‹/g,
  /"[^"\n]*"/g,
  /(?<![\p{L}\p{N}])'(?=\S)[^'\n]*?(?<=\S)'(?![\p{L}\p{N}])/gu,
];

/** Innermost first; the caller repeats for nesting. */
const BRACKET_RES = [/\([^()\n]*\)/g, /\[[^[\]\n]*\]/g];

/** `#12` (not `page#12`, `owner/repo#12`, `&#12;`) or `Issue 12` / `Issue #12`. */
const REF_RE =
  /(?<![\p{L}\p{N}_/&#])#(\d{1,7})(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:issues?|tickets?)[ \t]*#?(\d{1,7})(?![\p{L}\p{N}_])/giu;

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

const LEAD_RE = new RegExp(
  `${NOT_WORD_BEFORE}(?:${alt(LEAD_VERBS)}):?(?:\\s+(?:${alt(LEAD_FILLERS)})){0,3}\\s*$`, 'iu');
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

/**
 * The prompt with every non-prose span replaced by a mask.
 * @param {string} text
 * @returns {string}
 */
function maskNonProse(text) {
  let s = String(text).replace(FENCE_RE, MASK);
  s = s.split('\n').map(line => (LOG_LINE_RES.some(rx => rx.test(line)) ? MASK : line)).join('\n');
  for (const rx of SPAN_RES) s = s.replace(rx, MASK);
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
    const n = String(Number(m[1] || m[2]));
    if (n === '0') continue;
    const start = m.index;
    const end = start + m[0].length;
    const last = runs[runs.length - 1];
    const between = last ? prose.slice(last.end, start) : '';
    if (last && RANGE_SEP_RE.test(between)) {
      last.size += Math.max(1, Math.abs(Number(n) - Number(last.items[last.items.length - 1])));
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
    if (run.size >= MIN_LIST) continue;
    const before = prose.slice(Math.max(0, run.start - WINDOW), run.start);
    const after = prose.slice(run.end, run.end + WINDOW);
    if (NOT_ISSUE_BEFORE_RE.test(before) || NOT_ISSUE_AFTER_RE.test(after)) continue;
    const opensPrompt = run.items.length === 1 && SUBJECT_BEFORE_RE.test(prose.slice(0, run.start));
    const requested = opensPrompt || LEAD_RE.test(before) || TRAIL_RE.test(after);
    const into = requested ? track : mentioned;
    for (const n of run.items) if (!into.includes(n)) into.push(n);
  }
  const rest = mentioned.filter(n => !track.includes(n));
  const ask = track.length > 0 || rest.length > MAX_ASK ? [] : rest;
  return { track, ask };
}

module.exports = { issueRefs, maskNonProse };
