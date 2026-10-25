'use strict';
/**
 * @module frustration-detect
 * @version 0.1.0
 * @plugin devops
 * @feature frustrated-mode (alpha)
 * @description Pure scoring of one user prompt against the running state of a
 *   session. Spec: docs/superpowers/specs/2026-10-25-frustrated-mode-trigger-detection-design.md
 *   (§ 2 triggers, § 3 counter-indicators, § 4 score and thresholds).
 *
 *   UserPromptSubmit is the only hook that sees the user's words, so the
 *   scorer works from the prompt plus a small state object that the caller
 *   persists (hooks/lib/frustration-state.js). It never touches the disk and
 *   never throws.
 *
 *   Flag rule: rounds >= 3 AND score >= 6 on the current target. Claude itself
 *   makes the final call whether the session is really stuck — this score only
 *   decides when to ask Claude to judge.
 */

const MIN_ROUNDS = 3;
const MIN_SCORE = 6;
const MAX_TOKEN_SETS = 8;

// T1 — phrases that refer to the previous result ("still wrong").
const STRONG = [
  /\b(?:still|again)\s+(?:not|wrong|broken|failing|doesn'?t|isn'?t)\b/i,
  /\bthat'?s\s+(?:still\s+)?(?:wrong|not\s+(?:right|it|what))/i,
  /\bnot\s+what\s+i\s+(?:asked|wanted|meant)\b/i,
  /\bi\s+(?:already|just)\s+(?:said|told|asked)\b/i,
  /\bsame\s+(?:error|problem|bug|issue)\s+again\b/i,
  /\bimmer\s+noch\b/i,
  /\bschon\s+wieder\b/i,
  /\bnoch\s+immer\s+nicht\b/i,
  /\bdas\s+ist\s+(?:immer\s+noch\s+)?falsch\b/i,
  /\bnicht\s+das,?\s+was\s+ich\s+(?:wollte|meinte|gesagt)/i,
  /\bhab(?:e)?\s+ich\s+(?:doch|schon)\s+(?:gesagt|geschrieben)/i,
  /\bwieder\s+(?:nicht|falsch|kaputt)\b/i,
];
// T1 weak.
const WEAK = [
  /\b(?:wrong|broken|nope|still|again|nochmal|falsch|kaputt|nein)\b/i,
];
// T4 — the user asks for a revert.
const REVERT = [
  /\b(?:undo|revert|roll\s*back|back\s+to\s+(?:how|what)\s+it\s+was)\b/i,
  /\brückgängig\b/i,
  /\bwie\s+vorher\b/i,
];
// C1 acknowledgment, C2 additive scope.
const ACK = /^\s*(?:ok(?:ay)?[,.!\s]|good\b|great\b|perfect\b|works?\b|thanks?\b|thx\b|passt\b|perfekt\b|super\b|danke\b|top\b|klappt\b|funktioniert\b|gut\b)/i;
const ADDITIVE = /\b(?:and\s+now\s+also|next\s*[,:]|now\s+also|jetzt\s+noch|außerdem|ausserdem|als\s+nächstes|and\s+now)\b/i;
const SNOOZE = /(?:stop\s+suggest|don'?t\s+suggest|nicht\s+mehr\s+vorschlagen|keine\s+vorschläge)/i;
// T2 — the previous assistant turn claimed completion.
const DONE_CLAIM = /(?:\bfixed\b|\bdone\b|should\s+(?:now\s+)?work|now\s+works|\bresolved\b|behoben|erledigt|sollte\s+(?:jetzt\s+)?(?:funktionieren|klappen)|funktioniert\s+jetzt|\bgefixt\b|fertig)/i;
// C4 — design tuning is iteration by design.
const DESIGN_TUNING = /\b(?:a\s+bit|bit\s+more|slightly|etwas|ein\s+bisschen|bisschen|mehr\s+abstand|more\s+spacing|größer|kleiner|bigger|smaller)\b/i;

/** Remove code blocks, quotes, stack traces and pasted logs before matching. */
function stripNoise(prompt) {
  let s = String(prompt || '');
  s = s.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  s = s.split('\n')
    .filter((l) => !/^\s*>/.test(l) && !/^\s+at\s+\S+\s*\(/.test(l) && !/^\s*(?:Error|TypeError|at)\b.*:\d+/.test(l) && !/^\s*\d{4}-\d\d-\d\d[T ]\d\d:/.test(l))
    .join('\n');
  s = s.replace(/"[^"\n]{12,}"/g, ' ');
  return s.trim();
}

/** Explicit target references: file names and #N. */
function targetRefs(text) {
  const refs = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(/(?:^|[\s("'`])((?:[\w.-]+[\\/])*[\w.-]+\.[a-z]{1,5})(?=$|[\s)"'`:,.;])/gi)) refs.add(m[1].toLowerCase());
  for (const m of s.matchAll(/(?:^|\s)#(\d{1,6})\b/g)) refs.add(`#${m[1]}`);
  return [...refs];
}

function tokens(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().split(/[^a-zäöüß0-9]+/)) if (w.length >= 4) out.add(w);
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function emptyState() {
  return { target: [], rounds: 0, score: 0, tokenSets: [], userPrompts: 0, snoozed: false, offer: null, updatedAt: 0 };
}

function normState(state) {
  const base = emptyState();
  if (!state || typeof state !== 'object') return base;
  return {
    ...base, ...state,
    target: Array.isArray(state.target) ? state.target : [],
    tokenSets: Array.isArray(state.tokenSets) ? state.tokenSets : [],
  };
}

/** T8: a lone question-mark run, a run of "!", or all caps. Weak. */
function promptShape(raw) {
  const t = raw.trim();
  if (!t) return false;
  if (/^[?!.\s]*\?{2,}[?!.\s]*$/.test(t)) return true;
  if (/!{3,}/.test(t)) return true;
  const letters = t.replace(/[^A-Za-zÄÖÜäöü]/g, '');
  return letters.length >= 8 && letters === letters.toUpperCase();
}

/** The flag rule on a state: enough rounds and score, not snoozed, past the cooldown of an earlier offer. */
function isFlagged(st, { ignoreCooldown = false } = {}) {
  if (!st || st.snoozed) return false;
  if (st.rounds < MIN_ROUNDS || st.score < MIN_SCORE) return false;
  if (!ignoreCooldown && st.offer && (st.rounds < st.offer.rounds + MIN_ROUNDS || st.score < st.offer.score + MIN_SCORE)) return false;
  return true;
}

function clearTarget(st) {
  st.target = []; st.rounds = 0; st.score = 0; st.tokenSets = []; st.offer = null;
}

/**
 * Score one prompt.
 * @param {string} prompt
 * @param {object} [state] previous state (see emptyState)
 * @param {{claimedDone?:boolean, iterativeSkill?:boolean, nowMs?:number}} [ctx]
 *   claimedDone: the previous assistant turn claimed completion (T2).
 *   iterativeSkill: auto-concept / auto-polish active (C4): weak signals ignored.
 * @returns {{score:number, rounds:number, signals:string[], flagged:boolean, state:object}}
 */
function detect(prompt, state, ctx = {}) {
  try {
    const st = normState(state);
    const raw = String(prompt || '');
    const text = stripNoise(raw);
    const signals = [];
    st.updatedAt = ctx.nowMs || Date.now();
    st.userPrompts += 1;

    if (SNOOZE.test(text)) {
      st.snoozed = true;
      return { score: st.score, rounds: st.rounds, signals: ['snooze'], flagged: false, state: st };
    }

    const strong = STRONG.some((r) => r.test(text));
    if (!strong && (ACK.test(text) || ADDITIVE.test(text))) {
      clearTarget(st);
      return { score: 0, rounds: 0, signals: [ACK.test(text) ? 'C1' : 'C2'], flagged: false, state: st };
    }

    const refs = targetRefs(text);
    if (refs.length && st.target.length && !refs.some((r) => st.target.includes(r))) clearTarget(st); // C2: new target
    if (refs.length) st.target = [...new Set([...st.target, ...refs])].slice(0, 8);

    const weak = !strong && WEAK.some((r) => r.test(text));
    const revert = REVERT.some((r) => r.test(text));
    const iterative = !!ctx.iterativeSkill || DESIGN_TUNING.test(text);

    let pts = 0;
    if (ctx.claimedDone && (strong || weak)) { pts += 3; signals.push('T2'); }
    if (revert) { pts += 2; signals.push('T4'); }
    if (strong && !(iterative && !ctx.claimedDone)) { pts += 2; signals.push('T1s'); }
    const tk = tokens(text);
    if (tk.size >= 5 && st.tokenSets.some((prev) => jaccard(tk, new Set(prev)) >= 0.6)) { pts += 1; signals.push('T9'); }
    const shape = promptShape(raw);
    if (!iterative && (weak || shape) && !signals.includes('T1s')) { pts += 1; signals.push(weak ? 'T1w' : 'T8'); }

    // C8: a long prompt with new material is cooperative debugging, counts half.
    if (raw.length > 600 && /```|screenshot|attachment|anhang/i.test(raw)) { pts /= 2; signals.push('C8'); }

    st.rounds += 1;
    st.score = Math.round((st.score + pts) * 10) / 10;
    if (tk.size >= 5) st.tokenSets = [...st.tokenSets, [...tk]].slice(-MAX_TOKEN_SETS);

    return { score: st.score, rounds: st.rounds, signals, flagged: isFlagged(st), state: st };
  } catch {
    return { score: 0, rounds: 0, signals: [], flagged: false, state: emptyState() };
  }
}

/** True when the previous assistant text claims the work is done (T2 input). */
function claimsDone(assistantText) {
  return DONE_CLAIM.test(String(assistantText || '').slice(-1500));
}

module.exports = { detect, isFlagged, claimsDone, stripNoise, targetRefs, emptyState, MIN_ROUNDS, MIN_SCORE };
