#!/usr/bin/env node
/**
 * @hook post.ask.answers
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher AskUserQuestion
 * @description Answer-check (run-contract spec F): an AskUserQuestion answer
 *   token that equals the Other placeholder (`Something else`, `Other`,
 *   `Etwas anderes`, `Sonstiges`, case-insensitive) and is not an option label
 *   of that question means the user picked Other WITHOUT typing. Injects
 *   `[answer-check]` context so the model asks what, instead of silently
 *   ignoring the answer. Works for every AskUserQuestion, contract or not.
 */

require('../lib/plugin-guard');

const PLACEHOLDERS = new Set(['something else', 'other', 'etwas anderes', 'sonstiges']);

function clean(s) {
  return String(s == null ? '' : s).replace(/\s*\((?:recommended|empfohlen)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

function labelsOf(q) {
  return Array.isArray(q && q.options)
    ? q.options.map(o => clean(typeof o === 'string' ? o : o && o.label)).filter(Boolean).map(s => s.toLowerCase())
    : [];
}

function tokensOf(value, labels) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const out = [];
  for (const v of list) {
    const s = clean(v);
    if (!s) continue;
    if (labels.includes(s.toLowerCase()) || !s.includes(',')) out.push(s);
    else for (const part of s.split(',')) { const c = clean(part); if (c) out.push(c); }
  }
  return out;
}

/**
 * The `[answer-check]` notes for one AskUserQuestion result.
 * @param {object[]} questions
 * @param {object} answers keyed by question text (or header)
 * @returns {string[]}
 */
function answerChecks(questions, answers) {
  const notes = [];
  if (!answers || typeof answers !== 'object') return notes;
  const qs = Array.isArray(questions) && questions.length
    ? questions
    : Object.keys(answers).map(k => ({ question: k }));
  for (const q of qs) {
    const text = q && typeof q.question === 'string' ? q.question : '';
    let value;
    if (text && Object.prototype.hasOwnProperty.call(answers, text)) value = answers[text];
    else if (q && q.header && Object.prototype.hasOwnProperty.call(answers, q.header)) value = answers[q.header];
    else continue;
    const labels = labelsOf(q);
    const hit = tokensOf(value, labels).find(t => PLACEHOLDERS.has(t.toLowerCase()) && !labels.includes(t.toLowerCase()));
    if (!hit) continue;
    notes.push([
      `[answer-check] "${text || q.header}" was answered with "${hit}" and no text.`,
      'The user wants something the options did not offer. Ask what, in ONE',
      "AskUserQuestion, before acting on this question's answer.",
    ].join('\n'));
  }
  return notes;
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const { parseHookInput } = require('../lib/hook-input');
      const hook = parseHookInput(inputData);
      if (!hook || hook.tool_name !== 'AskUserQuestion') process.exit(0);
      const { extractAnswers } = require('../lib/run-contract');
      const { questions, answers } = extractAnswers(hook.tool_response, hook.tool_input);
      const notes = answerChecks(questions, answers);
      if (notes.length) {
        process.stdout.write(`${JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n\n') },
        })}\n`);
      }
    } catch { /* never surfaces as a hook failure */ }
    process.exit(0);
  });
}

module.exports = { answerChecks, PLACEHOLDERS };
