'use strict';
/**
 * @module card-guard-answer
 * @plugin devops
 * @description Safety net for a lost answer (#757). The normal path puts the
 *   answer into the card's `answer` field, where it rides inside the widget.
 *   This covers the one case the card cannot: a turn that ended WITHOUT any
 *   card, where the user asked a question and the turn's last persisted
 *   assistant output carries no text (the answer was written before a
 *   further tool call and the Desktop app dropped or rephrased it).
 *
 *   Conservative on purpose: only a real user prompt (no task-notification,
 *   no meta entry) that reads as a question, only when the turn's final
 *   assistant block is a tool call or an empty text, and the stop guard
 *   blocks at most once per turn (stop_hook_active + its own marker).
 */

const { isPromptEntry } = require('./skill-invocations');

/** Per-session marker: the re-emit was already asked for this turn. */
const ANSWER_ASKED_FLAG = 'dotclaude-devops-answer-reemit';

/** Interrogative openers only — no auxiliaries ("Do the ship", "Ist erledigt" are no questions). */
const QUESTION_WORD_RE = /^(?:wie|was|warum|wieso|weshalb|wo|wann|welche[rsmn]?|wer|how|what|why|where|when|which|who)(?![\p{L}\d_])/iu;

/** Explanation requests without a question mark ("erkläre mir X", "explain Y", "show me Z"). */
const EXPLAIN_RE = /(?<![\p{L}\d_])(?:erkl(?:ä|ae)r(?:e|en|st|t)?|zeig\s+mir|explain|show\s+me|walk\s+me\s+through)(?![\p{L}\d_])/iu;

function promptText(entry) {
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

/** Does the prompt read as a question? Fenced code and inline code are ignored. */
function isQuestion(text) {
  const t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
    .trim();
  if (!t || t.includes('<task-notification>')) return false;
  if (/\?(?:\s|$)/.test(t)) return true;
  return QUESTION_WORD_RE.test(t) || EXPLAIN_RE.test(t);
}

/**
 * Inspect the current turn (entries after the last real prompt).
 * @param {string} transcriptContent JSONL tail
 * @returns {{ question: boolean, answerMissing: boolean }} both false when unreadable
 */
function turnAnswerState(transcriptContent) {
  const none = { question: false, answerMissing: false };
  if (!transcriptContent) return none;
  const lines = transcriptContent.split('\n');
  let last = null; // 'text' | 'empty' | 'tool' — the newest assistant output block
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type === 'user' && isPromptEntry(entry)) {
      return { question: isQuestion(promptText(entry)), answerMissing: last === null || last === 'empty' || last === 'tool' };
    }
    if (entry.type !== 'assistant' || last !== null) continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    // Newest block first; thinking blocks are no output and are skipped.
    for (let j = content.length - 1; j >= 0 && last === null; j--) {
      const b = content[j];
      if (!b) continue;
      if (b.type === 'text') last = typeof b.text === 'string' && b.text.trim() ? 'text' : 'empty';
      else if (b.type === 'tool_use') last = 'tool';
    }
  }
  return none; // the prompt is outside the tail — never block blind
}

/**
 * Should the stop guard ask once to re-emit the answer?
 * @param {{ cardRendered: boolean, stopHookActive: boolean, alreadyAsked: boolean,
 *   silent?: boolean, exempt?: boolean, transcript: string }} s
 */
function shouldAskForAnswer(s) {
  if (!s || s.cardRendered || s.stopHookActive || s.alreadyAsked || s.silent || s.exempt) return false;
  const st = turnAnswerState(s.transcript);
  return st.question && st.answerMissing;
}

function buildAnswerMissingReason() {
  return [
    '[devops] The user asked a question, but this turn ends without a visible answer:',
    'the last assistant output carries no text (an answer written before a further tool',
    'call can be dropped by the app). Write the full answer now as plain text — no tool',
    'call, no card. One-time reminder; the next stop passes.',
  ].join(' ');
}

module.exports = { ANSWER_ASKED_FLAG, isQuestion, turnAnswerState, shouldAskForAnswer, buildAnswerMissingReason };
