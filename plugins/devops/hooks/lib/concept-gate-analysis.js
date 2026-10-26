/**
 * @module concept-gate-analysis
 * @description Gate rules for the analysis presentation (Full + Lite) and the
 *   seven decision modes of auto-concept — contract in
 *   skills/auto-concept/deep-knowledge/templates-analysis.md, rule table in
 *   validation-gate.md § Analysis & decision modes (A1–A9).
 *
 *   Errors (block the page):
 *     A1  Full without a briefing (what / why / potential)
 *     A2  a decision without data-rec, or whose preselection is not the
 *         recommendation
 *     A3  unknown data-decision-mode
 *   Warnings (advisory, never part of `ok`):
 *     A4  more than 3 topics per Full / more than 7 decisions per topic
 *     A5  Lite with more than 5 decisions (use Full)
 *     A6  quantitative finding without a visual
 *     A7  an exclusive choice built as N bi-states
 *     A8  timing as a decision
 *
 *   The page is tokenised with a tolerant tag parser (script / style / comment
 *   bodies blanked first): the engine JS of a built page quotes these
 *   attribute names in strings, which must not count as markup.
 */

'use strict';

const MODES = ['single', 'multi', 'yesnoalt', 'slider', 'order', 'verify', 'wording'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG_RE = /<(\/?)([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

const TOPIC_MAX = 3;
const PER_TOPIC_MAX = 7;
const LITE_MAX = 5;

const TIMING_RE = /\b(welle|wellen|wann\s+(?:\w+\s+){0,2}umsetz\w*|wann\s+einbauen|when\s+to\s+(?:implement|ship|build|do)|which\s+wave|in\s+which\s+(?:wave|release)|rollout\s+wave)\b/i;
const QUANT_RE = /\d[\d.,]*\s*(?:%|×|x\b|k\b|m\b|ms\b|s\b|sek|min|h\b|tokens?|mb|gb|kb|€|\$|mal\b|fach)/i;

function blank(html) {
  const mask = m => m.replace(/[^\n]/g, ' ');
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, mask)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, b, c) => a + mask(b) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, b, c) => a + mask(b) + c);
}

/** Flat element list with source extents; tolerant of unclosed non-void tags. */
function parse(html) {
  const src = blank(html);
  const nodes = [];
  const stack = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src)) !== null) {
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          while (stack.length > i) { const n = stack.pop(); n.innerEnd = m.index; n.end = m.index + m[0].length; }
          break;
        }
      }
      continue;
    }
    const node = { tag, attrs: m[3], start: m.index, innerStart: m.index + m[0].length, innerEnd: src.length, end: src.length };
    nodes.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
    else node.innerEnd = node.end = node.innerStart;
  }
  return { src, nodes };
}

function attr(node, name) {
  const m = new RegExp(`(?:^|\\s)${name}(?:=("|')([^"']*)\\1|(?=\\s|/|$))`, 'i').exec(node.attrs);
  return m ? (m[2] === undefined ? '' : m[2]) : null;
}
const has = (node, name) => attr(node, name) !== null;
const inside = (outer, n) => n !== outer && n.start >= outer.innerStart && n.start < outer.innerEnd;
const textOf = (doc, n) => doc.src.slice(n.innerStart, n.innerEnd).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const decode = s => String(s).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const lineAt = (doc, at) => doc.src.slice(0, at).split('\n').length;

function labelOf(doc, n) {
  return decode(attr(n, 'data-label') || attr(n, 'data-decision') || n.tag);
}

function preselectionIssue(doc, el, mode, rec) {
  const id = attr(el, 'data-decision');
  const name = `dm-${id}`;
  const inputs = doc.nodes.filter(n => n.tag === 'input' && inside(el, n));
  const checked = n => /(?:^|\s)checked(?:\s|=|\/|$)/i.test(n.attrs);
  if (mode === 'single' || mode === 'verify' || mode === 'wording' || mode === 'yesnoalt') {
    const hit = inputs.find(n => attr(n, 'type') === 'radio' && attr(n, 'name') === name && checked(n));
    if (!hit) return `no radio of "${name}" is pre-checked`;
    if (attr(hit, 'value') !== rec) return `the pre-checked option "${attr(hit, 'value')}" is not the recommendation "${rec}"`;
    return null;
  }
  if (mode === 'multi') {
    const want = rec.split(/\s+/).filter(Boolean).sort().join(' ');
    const got = inputs.filter(n => attr(n, 'type') === 'checkbox' && (attr(n, 'name') || '').startsWith(`${name}.`) && checked(n))
      .map(n => attr(n, 'name').slice(name.length + 1)).sort().join(' ');
    return got === want ? null : `the pre-checked boxes ("${got}") are not the recommendation ("${want}")`;
  }
  if (mode === 'slider') {
    const r = inputs.find(n => attr(n, 'name') === name && attr(n, 'type') === 'range');
    if (!r) return `no <input type="range" name="${name}">`;
    return Number(attr(r, 'value')) === Number(rec) && attr(r, 'value') !== '' ? null : `the slider value "${attr(r, 'value')}" is not the recommendation "${rec}"`;
  }
  if (mode === 'order') {
    const h = inputs.find(n => attr(n, 'name') === name);
    if (!h) return `no <input type="hidden" name="${name}"> holding the order`;
    return (attr(h, 'value') || '').replace(/\s+/g, '') === rec.replace(/\s+/g, '') ? null : `the initial order "${attr(h, 'value')}" is not the recommended order "${rec}"`;
  }
  return null;
}

/**
 * @returns {{errors:Array<{kind:string,why:string,at:number}>, warnings:Array<{kind:string,why:string,at:number}>}}
 */
function findAnalysisIssues(html) {
  const errors = [];
  const warnings = [];
  const out = { errors, warnings };
  const raw = String(html || '');
  if (!/data-analysis|data-decision-mode/.test(raw)) return out;
  const doc = parse(raw);
  const err = (kind, why, at) => errors.push({ kind, why, at });
  const warn = (kind, why, at) => warnings.push({ kind, why, at });

  const fulls = doc.nodes.filter(n => n.tag === 'section' && attr(n, 'data-analysis') === 'full');
  const lites = doc.nodes.filter(n => attr(n, 'data-analysis') === 'lite');
  const decisions = doc.nodes.filter(n => has(n, 'data-decision-mode'));
  if (!fulls.length && !lites.length && !decisions.length) return out;

  // A1 — Full needs a briefing: what / why / potential
  for (const f of fulls) {
    const where = `Full analysis (iteration ${attr(f, 'data-iteration') || '?'})`;
    const brief = doc.nodes.find(n => has(n, 'data-analysis-briefing') && inside(f, n));
    if (!brief) { err('briefing-missing', `${where}: no [data-analysis-briefing] — a Full analysis opens with a briefing (what was found, why it matters, the potential)`, f.start); continue; }
    const part = name => doc.nodes.find(n => has(n, name) && inside(brief, n));
    const what = part('data-briefing-what'), why = part('data-briefing-why'), pot = part('data-briefing-potential');
    if (!what || !textOf(doc, what)) err('briefing-what', `${where}: the briefing has no non-empty [data-briefing-what] (the analysis in a sentence)`, brief.start);
    if (!why || !textOf(doc, why)) err('briefing-why', `${where}: the briefing has no non-empty [data-briefing-why] (why this matters)`, brief.start);
    if (!pot || !(textOf(doc, pot) || attr(pot, 'data-viz-spec'))) err('briefing-potential', `${where}: the briefing has no [data-briefing-potential] with a value (e.g. "≈ 51 M tokens")`, brief.start);
  }

  // A2 / A3 — every decision: known mode, recommendation, preselection
  for (const d of decisions) {
    const mode = attr(d, 'data-decision-mode');
    const id = attr(d, 'data-decision');
    if (!id) { err('decision-id', `a [data-decision-mode="${mode}"] element has no data-decision id`, d.start); continue; }
    if (!MODES.includes(mode)) { err('decision-mode', `decision "${id}": data-decision-mode="${mode}" is none of ${MODES.join(', ')}`, d.start); continue; }
    const rec = (attr(d, 'data-rec') || '').trim();
    if (!rec) { err('decision-rec', `decision "${id}" (${mode}): no data-rec — every decision names its recommended option, preselected`, d.start); continue; }
    const issue = preselectionIssue(doc, d, mode, rec);
    if (issue) err('decision-preselect', `decision "${id}" (${mode}): ${issue} — the recommendation is always preselected`, d.start);
  }

  // A4 — groups ≤ 3, decisions per group ≤ 7
  for (const f of fulls) {
    const topics = doc.nodes.filter(n => has(n, 'data-topic') && inside(f, n));
    if (topics.length > TOPIC_MAX) warn('topics-max', `Full analysis has ${topics.length} topics — keep it to ${TOPIC_MAX} (split the concept or merge topics)`, f.start);
    for (const t of topics) {
      const n = decisions.filter(d => inside(t, d)).length;
      if (n > PER_TOPIC_MAX) warn('topic-decisions-max', `topic "${decode(attr(t, 'data-nav-label') || attr(t, 'id') || '?')}" holds ${n} decisions — keep it to ${PER_TOPIC_MAX}`, t.start);
    }
  }
  // A5 — Lite ≤ 5
  for (const l of lites) {
    const n = decisions.filter(d => inside(l, d)).length;
    if (n > LITE_MAX) warn('lite-max', `Lite analysis holds ${n} decisions — more than ${LITE_MAX} belong in a Full analysis`, l.start);
  }

  // A6 — a quantitative finding wants a visual
  for (const d of decisions) {
    const l3 = doc.nodes.find(n => attr(n, 'data-alevel') === '3' && inside(d, n));
    if (!l3) continue;
    const quant = attr(d, 'data-finding-quant') === 'true' || (attr(d, 'data-finding-quant') !== 'false' && QUANT_RE.test(textOf(doc, l3)));
    if (!quant) continue;
    const viz = doc.nodes.some(n => has(n, 'data-viz') && attr(n, 'data-viz') !== 'text' && inside(l3, n));
    if (!viz) warn('finding-visual', `decision "${attr(d, 'data-decision')}": its finding carries numbers but no palette visual (data-viz other than "text") — show it, do not only state it`, d.start);
  }

  // A7 — N bi-states standing in for one exclusive choice (analysis pages only)
  const legacy = doc.nodes.filter(n => has(n, 'data-decision') && !has(n, 'data-decision-mode'));
  const byParent = new Map();
  for (const g of legacy) {
    const parent = doc.nodes.filter(n => n.tag === 'section' && inside(n, g)).pop();
    if (!parent) continue;
    byParent.set(parent, (byParent.get(parent) || 0) + 1);
  }
  for (const [parent, n] of byParent) {
    if (n >= 3) warn('bistate-choice', `section "${decode(attr(parent, 'id') || attr(parent, 'data-nav-label') || '?')}" holds ${n} include/discard groups — if they are alternatives of ONE question use data-decision-mode="single" (radio cards), not ${n} bi-states`, parent.start);
  }

  // A8 — timing is never a decision
  for (const d of [...decisions, ...legacy]) {
    const q = doc.nodes.find(n => has(n, 'data-question') && inside(d, n));
    const hay = [attr(d, 'data-label') || '', q ? textOf(doc, q) : ''].join(' ');
    if (TIMING_RE.test(hay)) warn('timing-decision', `decision "${attr(d, 'data-decision')}" (${decode(hay.trim())}) asks WHEN — timing is never a decision (default: implement now); offer "Als Issue anlegen" instead`, d.start);
  }
  return out;
}

module.exports = { findAnalysisIssues, MODES, TOPIC_MAX, PER_TOPIC_MAX, LITE_MAX, parse, lineAt };
