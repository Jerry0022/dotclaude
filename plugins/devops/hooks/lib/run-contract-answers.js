'use strict';
/**
 * @module run-contract-answers
 * @version 0.1.1
 * @plugin devops
 * @description Run-contract answer extraction: the do-run router / follow-up
 *   AskUserQuestion parsing (spec B) and the machine-prompt parsing
 *   (spec G). Split out of run-contract.js (AUD-016) — run-contract.js
 *   stays the facade every caller requires.
 *
 *   - Follow-ups: only the exact `Issues` / `Milestones` headers and their
 *     numbered continuations (`Issues 2`, `Issues (2)`, `Issues 2/3`,
 *     `Milestones 2`), merged within one call; an empty / Other answer
 *     leaves the list unchanged (H-B7, RT3-R7).
 *   - A partial router call merges into this session's active contract of
 *     any age (no 30-min window); the post hook arms instead after a fresh
 *     do-run marker and reports an unrecordable one (RT3-R8).
 */

const { MACHINE_ARM_RE, BACKLOG_AUTOSTART_RE } = require('./run-contract-calls');
const { readContract, update, nowOf } = require('./run-contract-store');

const MERGE_WINDOW_MS = 30 * 60_000;

// ── answer extraction ──────────────────────────────────────────────────────

/** Header guessed from a question text (text-only answer forms carry no header). */
const QUESTION_HEADERS = [
  [/was soll dieser run/i, 'Was?'],
  [/bleibst du erreichbar|bist du dabei|wer shippt/i, 'Ablauf?'],
  [/wie weit darf die änderung/i, 'Umfang?'],
  [/welche durchgänge/i, 'Durchgänge?'],
];

function guessHeader(question) {
  for (const [re, h] of QUESTION_HEADERS) if (re.test(question)) return h;
  return null;
}

function parseAnswerText(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  const re = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

function textOf(resp) {
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(textOf).join('\n');
  if (resp && typeof resp === 'object') {
    if (typeof resp.text === 'string') return resp.text;
    if (resp.content !== undefined) return textOf(resp.content);
    if (typeof resp.result === 'string') return resp.result;
  }
  return '';
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/**
 * `{questions, answers}` from an AskUserQuestion PostToolUse payload (or a
 * transcript `toolUseResult`). Answers: `tool_response.answers` →
 * `tool_input.answers` → text form `"<question>"="<answer>"`. Without
 * questions, they are synthesized from the answer keys (header guessed).
 */
function extractAnswers(toolResponse, toolInput) {
  const resp = toolResponse;
  const input = isPlainObject(toolInput) ? toolInput : {};
  let questions = Array.isArray(input.questions) ? input.questions
    : (isPlainObject(resp) && Array.isArray(resp.questions) ? resp.questions : []);
  let answers = null;
  if (isPlainObject(resp) && isPlainObject(resp.answers)) answers = resp.answers;
  else if (isPlainObject(input.answers)) answers = input.answers;
  else {
    const parsed = parseAnswerText(textOf(resp));
    answers = Object.keys(parsed).length ? parsed : {};
  }
  if (!questions.length) {
    questions = Object.keys(answers).map(q => ({ question: q, header: guessHeader(q) }));
  }
  return { questions, answers };
}

// ── router parsing ─────────────────────────────────────────────────────────

const RECOMMENDED_RE = /\s*\((?:recommended|empfohlen)\)\s*/gi;
function cleanLabel(s) { return String(s == null ? '' : s).replace(RECOMMENDED_RE, ' ').replace(/\s+/g, ' ').trim(); }
function hasRecommended(s) { return /\((?:recommended|empfohlen)\)/i.test(String(s || '')); }

function headerOf(q) { return q && typeof q.header === 'string' ? q.header.trim() : (q && q.question ? guessHeader(q.question) : null); }

/** English / alternative router headers → the canonical German key. */
const HEADER_ALIASES = {
  what: 'was', flow: 'ablauf', scope: 'umfang', passes: 'durchgänge',
  result: 'ergebnis', 'audit scope': 'audit-umfang', 'audit-scope': 'audit-umfang', 'pc after': 'pc danach',
};

/** Header normalised: NFC, trimmed, trailing `?` stripped, case-folded, aliases mapped. */
function canonHeader(h) {
  if (typeof h !== 'string') return '';
  const s = h.normalize('NFC').trim().replace(/\s*\?+$/, '').trim().toLowerCase().replace(/\s+/g, ' ');
  return HEADER_ALIASES[s] || s;
}

function findQuestion(questions, header) {
  const want = canonHeader(header);
  return (questions || []).find(q => canonHeader(headerOf(q)) === want) || null;
}

function optionLabels(q) {
  return Array.isArray(q && q.options) ? q.options.map(o => (typeof o === 'string' ? o : o && o.label) || '').filter(Boolean) : [];
}

/** Raw answer value for a question: keyed by question text, else by header. */
function answerFor(answers, q) {
  if (!answers || !q) return undefined;
  if (q.question && Object.prototype.hasOwnProperty.call(answers, q.question)) return answers[q.question];
  const h = headerOf(q);
  if (h && Object.prototype.hasOwnProperty.call(answers, h)) return answers[h];
  return undefined;
}

/** Answer → list of cleaned tokens. A string that is no exact option label is split on `,`. */
function answerTokens(value, q) {
  if (value == null) return [];
  const labels = optionLabels(q).map(cleanLabel);
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const v of list) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (labels.includes(cleanLabel(s)) || !s.includes(',')) out.push(cleanLabel(s));
    else for (const part of s.split(',')) { const c = cleanLabel(part); if (c) out.push(c); }
  }
  return out;
}

function isRouterCall(questions) {
  if (!Array.isArray(questions)) return false;
  return !!findQuestion(questions, 'Durchgänge?') || (!!findQuestion(questions, 'Ablauf?') && !!findQuestion(questions, 'Umfang?'));
}

const Q1_FIXED = ['prompt', 'audit', 'backlog'];

function modeOfLabel(label) {
  const s = label.toLowerCase();
  if (/prompt/.test(s)) return 'prompt';
  if (/audit/.test(s)) return 'audit';
  if (/backlog/.test(s)) return 'backlog';
  return null;
}

/** Q1 tokens → {mode, alsoAudit} or null. Handles free text like "1 und 2". */
function parseQ1(tokens, q) {
  const named = new Set();
  const labels = optionLabels(q).map(cleanLabel);
  for (const tok of tokens) {
    const direct = modeOfLabel(tok);
    if (direct) { named.add(direct); }
    for (const m of tok.matchAll(/(?<!\d)([1-3])(?!\d)/g)) {
      const idx = Number(m[1]) - 1;
      const byOption = labels[idx] ? modeOfLabel(labels[idx]) : null;
      named.add(byOption || Q1_FIXED[idx]);
    }
  }
  if (!named.size) return null;
  if (named.has('prompt')) return { mode: 'prompt', alsoAudit: named.has('audit') };
  if (named.has('audit')) return { mode: 'audit', alsoAudit: false };
  return { mode: 'backlog', alsoAudit: false };
}

function passFlagsOf(tokens, out) {
  for (const tok of tokens) {
    const s = tok.toLowerCase();
    if (/harden/.test(s)) out.passes.add('harden');
    if (/polish/.test(s)) out.passes.add('polish');
    if (/rethink/.test(s)) out.rethink = true;
    if (/budget|burn|verbrennen/.test(s)) out.burn = true;
  }
}

/** Fields implied by the do-run args (preset Q1). */
function argFields(doRunArgs) {
  const s = typeof doRunArgs === 'string' ? doRunArgs.trim() : '';
  const out = { mode: null, flow: null, burn: false, rethink: false };
  if (!s) return out;
  if (/--from=do-batch\b/i.test(s)) out.mode = 'prompt';
  const first = (s.split(/\s+/)[0] || '').toLowerCase();
  if (first === 'backlog') out.mode = out.mode || 'backlog';
  else if (first === 'audit') out.mode = out.mode || 'audit';
  else if (first === 'autonomous') out.flow = 'autonomous';
  else if (first === 'burn') out.burn = true;
  else if (first === 'rethink') out.rethink = true;
  return out;
}

/**
 * Header fields from the do-run router's answers (spec B), or null when the
 * call is not the router.
 * @param {object[]} questions AskUserQuestion `questions`
 * @param {object} answers keyed by question text (or header)
 * @param {{doRunArgs?:string}} [opts]
 */
function parseRouterAnswers(questions, answers, opts = {}) {
  if (!isRouterCall(questions)) return null;
  const a = answers || {};
  const args = argFields(opts.doRunArgs);
  const out = {
    mode: 'prompt', alsoAudit: false, flow: 'interactive', ship: 'manual', strict: false,
    passes: ['harden', 'polish'], rethink: args.rethink, burn: args.burn,
  };

  const answered = [];
  const q1 = findQuestion(questions, 'Was?');
  const q1r = q1 ? parseQ1(answerTokens(answerFor(a, q1), q1), q1) : null;
  const hint = followUpModeHint(questions);
  out.modeFrom = 'default';
  if (q1r) { out.mode = q1r.mode; out.alsoAudit = q1r.alsoAudit; out.modeFrom = 'q1'; answered.push('mode', 'alsoAudit', 'modeFrom'); }
  else if (args.mode) { out.mode = args.mode; out.modeFrom = 'args'; }
  else if (hint) { out.mode = hint; out.modeFrom = 'follow-up'; }

  const q2 = findQuestion(questions, 'Ablauf?');
  const q2t = q2 ? answerTokens(answerFor(a, q2), q2).join(' ') : '';
  if (q2t) {
    const s = q2t.toLowerCase();
    if (/^\s*(autonom|weg|away)/.test(s)) out.flow = 'autonomous';
    else if (/^\s*(interaktiv|dabei|interactive|present|with you|here)/.test(s)) out.flow = 'interactive';
    else if (/autonom|\bweg\b|\baway\b/.test(s)) out.flow = 'autonomous';
    if (/ship automatisch|ship automatic|ship auto\b/.test(s)) out.ship = 'auto';
    else if (/ship manuell|ship manual/.test(s)) out.ship = 'manual';
    answered.push('flow', 'ship');
  } else if (args.flow) out.flow = args.flow;

  const q3 = findQuestion(questions, 'Umfang?');
  const q3t = q3 ? answerTokens(answerFor(a, q3), q3).join(' ').toLowerCase() : '';
  if (/strikt|strict|nur das|only this|just this/.test(q3t)) out.strict = true;
  if (q3t) answered.push('strict');

  const q4 = findQuestion(questions, 'Durchgänge?');
  if (q4) {
    const tokens = answerTokens(answerFor(a, q4), q4);
    const r = parseQ4(tokens, q4);
    out.passes = r.passes;
    out.rethink = out.rethink || r.rethink;
    out.burn = out.burn || r.burn;
    out.unresolved = r.unresolved;
    if (tokens.length) answered.push('passes', 'rethink', 'burn', 'unresolved');
  }
  Object.defineProperty(out, 'answered', { value: answered, enumerable: false });
  return out;
}

// AUD-015d: the ONE list of "Other" placeholder tokens — post.ask.answers.js
// (spec F) imports this instead of keeping its own, so the two never drift.
const OTHER_PLACEHOLDERS = Object.freeze(['something else', 'other', 'etwas anderes', 'sonstiges', 'andere']);
const PLACEHOLDER_RE = new RegExp(`^(${OTHER_PLACEHOLDERS.join('|')})$`, 'i');
const NONE_RE = /^(keine?|none|nichts|no|no passes)(\s+(durchgänge|passes))?$/i;
const NEG_RE = /^(?:ohne|kein(?:e|en)?|without|no)\s+(.+)$/i;

/**
 * Q4 tokens → {passes, rethink, burn, unresolved} (R7). Empty → the
 * recommended set. `ohne X` / `kein X` / `without X` / `no X` excludes X.
 * An unrecognised or Other-placeholder token → the recommended set (minus
 * exclusions) when no pass was named, and `unresolved: true` either way.
 */
function parseQ4(tokens, q4) {
  const rec = { passes: new Set(), rethink: false, burn: false };
  const recLabels = optionLabels(q4).filter(hasRecommended);
  if (recLabels.length) passFlagsOf(recLabels, rec);
  else { rec.passes.add('harden'); rec.passes.add('polish'); }
  const recommended = ['harden', 'polish'].filter(p => rec.passes.has(p));
  if (!tokens.length) return { passes: recommended, rethink: rec.rethink, burn: rec.burn, unresolved: false };
  if (tokens.some(t => NONE_RE.test(t.trim()))) return { passes: [], rethink: false, burn: false, unresolved: false };
  const flags = { passes: new Set(), rethink: false, burn: false };
  const neg = new Set();
  let unresolved = false;
  let named = false;
  for (const tok of tokens) {
    const t = tok.trim();
    if (PLACEHOLDER_RE.test(t)) { unresolved = true; continue; }
    const nm = t.match(NEG_RE);
    if (nm) {
      const f = { passes: new Set(), rethink: false, burn: false };
      passFlagsOf([nm[1]], f);
      if (!f.passes.size) unresolved = true;
      f.passes.forEach(p => neg.add(p));
      continue;
    }
    const before = flags.passes.size + Number(flags.rethink) + Number(flags.burn);
    passFlagsOf([t], flags);
    const after = flags.passes.size + Number(flags.rethink) + Number(flags.burn);
    if (after === before) unresolved = true;
    else named = true;
  }
  let passes;
  if (flags.passes.size) passes = ['harden', 'polish'].filter(p => flags.passes.has(p) && !neg.has(p));
  else if (neg.size || unresolved || !named) passes = recommended.filter(p => !neg.has(p));
  else passes = [];
  return { passes, rethink: flags.rethink, burn: flags.burn, unresolved };
}

/**
 * Only the fields a router-shaped call actually answered (R7 merge): a
 * later call carrying some of the router headers updates just those.
 */
function answeredFields(fields) {
  const out = {};
  for (const k of (fields && fields.answered) || []) if (fields[k] !== undefined) out[k] = fields[k];
  return out;
}

/** A router call that lacks one of Ablauf / Umfang / Durchgänge. */
function isPartialRouterCall(questions) {
  return isRouterCall(questions) && !['Ablauf?', 'Umfang?', 'Durchgänge?'].every(h => findQuestion(questions, h));
}

/**
 * A partial router call MERGES into this session's active contract (R7),
 * whatever its age (RT3-R8: a re-ask 40 min in must not be dropped). The
 * caller arms instead when a fresh do-run marker exists. Returns the updated
 * header, or null (no active contract of this session).
 */
function mergeRouterAnswers(cwd, questions, fields, opts = {}) {
  if (!fields || !isPartialRouterCall(questions)) return null;
  const now = nowOf(opts);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  return update(cwd, answeredFields(fields), { now, sessionId: opts.sessionId });
}

// H-B7 / RT3-R7: exactly the headers do-run emits — F4 "Issues" / F3
// "Milestones" (SKILL.md) and their numbered continuations of backlog.md
// Step 1.2 ("Issues 2", "Issues (2)", "Issues 2/3") — never a header that
// merely starts with the word ("Issues found", "Open issues list").
const ISSUES_HEADER_RE = /^issues(?: (?:\d+(?:\/\d+)?|\(\d+(?:\/\d+)?\)))?$/;
const MILESTONES_HEADER_RE = /^milestones(?: (?:\d+(?:\/\d+)?|\(\d+(?:\/\d+)?\)))?$/;

/** Mode a follow-up header implies (Q1 was preset away): backlog | audit | null. */
function followUpModeHint(questions) {
  let hint = null;
  for (const q of Array.isArray(questions) ? questions : []) {
    const h = canonHeader(headerOf(q));
    if (MILESTONES_HEADER_RE.test(h) || ISSUES_HEADER_RE.test(h)) return 'backlog';
    if (h === 'ergebnis' || h === 'audit-umfang') hint = hint || 'audit';
  }
  return hint;
}

/** Does the call carry a question with this (canonical) header? */
function hasHeader(questions, key) {
  return (Array.isArray(questions) ? questions : []).some(q => canonHeader(headerOf(q)) === canonHeader(key));
}

/**
 * Apply a follow-up patch to the active contract. Its `modeHint` upgrades a
 * prompt-mode contract whose mode was only defaulted (no Q1 answer, no do-run
 * args) and that was armed ≤ 30 min ago in this session (R2).
 */
function applyFollowUp(cwd, patch, opts = {}) {
  if (!patch) return null;
  const now = nowOf(opts);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  const p = { ...patch };
  const hint = p.modeHint;
  delete p.modeHint;
  const armed = Date.parse(h.armedAt);
  if (hint && h.mode === 'prompt' && h.modeFrom === 'default' && Number.isFinite(armed) && now - armed <= MERGE_WINDOW_MS) {
    p.mode = hint;
    p.alsoAudit = false;
    p.modeFrom = 'follow-up';
  }
  return update(cwd, p, { now, sessionId: opts.sessionId });
}

/**
 * Patch from the router's follow-up call (spec B), or null when the call
 * carries none of its headers. `modeHint` names the mode its headers imply.
 */
function parseFollowUp(questions, answers) {
  if (!Array.isArray(questions)) return null;
  const a = answers || {};
  const patch = {};
  let hit = false;
  for (const q of questions) {
    const h = canonHeader(headerOf(q));
    const tokens = answerTokens(answerFor(a, q), q);
    if (/^ergebnis$/i.test(h)) {
      hit = true;
      const s = tokens.join(' ').toLowerCase();
      // R2 (red-team round 2 Q2): SKILL.md F1 ("Audit umsetzen") and
      // modes/audit.md Q2 ("Audit + Umsetzung (Recommended)") use different
      // German nouns/verbs for the same choice — "umsetz" (not "umsetzen")
      // covers both "umsetzen" and "Umsetzung".
      if (/concept/.test(s)) { patch.auditResult = 'concept'; patch.passes = []; }
      else if (/umsetz|implement/.test(s)) patch.auditResult = 'implement';
    } else if (MILESTONES_HEADER_RE.test(h)) {
      hit = true;
      // H-B7: only a real selection patches — an empty / "Other" answer
      // must not overwrite a recorded list with [].
      const picked = tokens.filter(t => !PLACEHOLDER_RE.test(t.trim()));
      if (picked.length) patch.milestones = [...new Set([...(patch.milestones || []), ...picked])];
    } else if (ISSUES_HEADER_RE.test(h)) {
      hit = true;
      const nums = [];
      for (const t of tokens) for (const m of t.matchAll(/#(\d+)/g)) nums.push(m[1]);
      if (nums.length) patch.items = [...new Set([...(patch.items || []), ...nums])];
    } else if (/^pc danach$/i.test(h)) {
      hit = true;
      patch.pcAfter = tokens.join(', ') || null;
    } else if (/^audit-umfang$/i.test(h)) {
      hit = true;
    }
  }
  if (!hit) return null;
  const hint = followUpModeHint(questions);
  if (hint) patch.modeHint = hint;
  return patch;
}

// ── machine prompts ────────────────────────────────────────────────────────

function kvPairs(text) {
  const out = {};
  for (const m of text.matchAll(/\b([A-Za-z]+)=(\S*)/g)) {
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key] = m[2].replace(/[,.;]+$/, '');
  }
  return out;
}

const YES_RE = /^(yes|y|true|on|ja|1)$/i;

/**
 * Header fields from a `RUN_BACKLOG_AUTOSTART:` / `AUTONOMOUS_AUTOSTART:`
 * prompt (spec G), or null for any other text.
 */
function parseMachinePrompt(text) {
  if (typeof text !== 'string') return null;
  if (!MACHINE_ARM_RE.test(text)) return null;
  const backlog = BACKLOG_AUTOSTART_RE.test(text);
  const kv = kvPairs(text);
  const out = { source: 'machine', flow: 'autonomous' };
  if (backlog) out.mode = 'backlog';
  else out.mode = /^audit/i.test(kv.mode || '') ? 'audit' : 'prompt';
  if (kv.ship) {
    if (/^auto/i.test(kv.ship)) out.ship = 'auto';
    else if (/^man/i.test(kv.ship)) out.ship = 'manual';
  }
  if (kv.passes !== undefined) {
    out.passes = /^(none|keine|)$/i.test(kv.passes) ? []
      : kv.passes.split(',').map(s => s.trim().toLowerCase()).filter(p => p === 'harden' || p === 'polish');
  }
  if (kv.strict) out.strict = /^(on|yes|true|an)$/i.test(kv.strict);
  if (kv.queue) out.items = kv.queue.split(',').map(s => s.trim().replace(/^#/, '')).filter(s => /^\d+$/.test(s));
  if (kv.burnMode) out.burn = YES_RE.test(kv.burnMode);
  if (kv.phase) {
    out.phase = kv.phase.toLowerCase();
    if (out.phase === 'presence') out.presence = false;
  }
  return out;
}

/**
 * Patch for an ACTIVE same-session contract from a machine prompt (R5): only
 * ship / passes / strict / items / presence are refreshed, the mode never
 * changes — except `RUN_BACKLOG_AUTOSTART` (forces backlog) and
 * `mode=analyze` over an audit contract (audit as concept: passes cleared).
 */
function machinePatch(active, text) {
  const fields = parseMachinePrompt(text);
  if (!fields) return null;
  const patch = {};
  for (const k of ['ship', 'passes', 'strict', 'items', 'presence']) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  if (BACKLOG_AUTOSTART_RE.test(text)) patch.mode = 'backlog';
  else if (active && active.mode === 'audit' && /^analy/i.test(kvPairs(text).mode || '')) {
    patch.passes = [];
    patch.auditResult = 'concept';
  }
  return patch;
}

module.exports = {
  OTHER_PLACEHOLDERS,
  applyFollowUp, answeredFields, isPartialRouterCall, mergeRouterAnswers, hasHeader, followUpModeHint, machinePatch,
  extractAnswers, isRouterCall, parseRouterAnswers, parseFollowUp, parseMachinePrompt,
};
