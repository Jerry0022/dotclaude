/**
 * @module card-guard
 * @version 0.1.0
 * @description Pure decision logic for the completion-card enforcement flow.
 *   Split out of stop.flow.guard.js so the rules can be unit-tested without
 *   mocking stdin or temp files.
 *
 *   Inputs: flag state (work/card) + transcript + stop_hook_active.
 *   Output: { action: 'block' | 'pass', reason?, resetFlags }.
 */

const fs = require('fs');

/** Minimum assistant-text chars to count a chat-only turn as "substantial". */
const SUBSTANTIAL_CHARS = 400;

/** Distinctive marker the completion-card template prints around the title. */
const CARD_MARKER = '\u2728\u2728\u2728';

/**
 * Extract concatenated text from the last assistant message in a JSONL
 * transcript. Non-text blocks and malformed lines are skipped silently.
 * Returns '' if no assistant message found.
 */
function lastAssistantText(transcriptContent) {
  if (!transcriptContent) return '';
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    const chunks = [];
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        chunks.push(block.text);
      }
    }
    return chunks.join('');
  }
  return '';
}

function lastAssistantTextLength(transcriptContent) {
  return lastAssistantText(transcriptContent).length;
}

function isSubstantialAnswer(transcriptContent, threshold = SUBSTANTIAL_CHARS) {
  return lastAssistantTextLength(transcriptContent) >= threshold;
}

/**
 * Backup detection: did the last assistant message already contain a
 * completion card? Triggered when the card-rendered flag write fails
 * (e.g. tmp-file I/O error) but Claude did output the card text.
 * Matches the distinctive ✨✨✨ title marker — unlikely to collide with
 * regular prose.
 */
function lastAssistantContainsCard(transcriptContent) {
  return lastAssistantText(transcriptContent).includes(CARD_MARKER);
}

/**
 * Decide whether the Stop hook should block the turn to force a completion card.
 *
 * @param {object} s
 * @param {boolean} s.workHappened   — tool call(s) ran this turn
 * @param {boolean} s.cardRendered   — render_completion_card was invoked
 * @param {boolean} s.stopHookActive — prior Stop hook already blocked this cycle
 * @param {boolean} s.substantial    — last assistant turn had substantial prose
 * @returns {{ action: 'block' | 'pass', resetFlags: boolean, reason?: string }}
 */
function decideAction({ workHappened, cardRendered, stopHookActive, substantial }) {
  if (stopHookActive) {
    // Never block twice in a row — prevents infinite loops even if the card
    // write flag fails for whatever reason. Flags are reset so the next turn
    // starts clean.
    return { action: 'pass', resetFlags: true };
  }

  const needCard = !cardRendered && (workHappened || substantial);
  if (!needCard) {
    return { action: 'pass', resetFlags: true };
  }

  return {
    action: 'block',
    resetFlags: false, // keep flags so the post-render stop hook sees consistent state
    reason: buildBlockReason(),
  };
}

function buildBlockReason() {
  return [
    '[stop.flow.guard] Completion card required — not yet rendered this turn.',
    '',
    'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW as the FIRST action.',
    'If the direct call fails with "tool not found", fall back to ToolSearch:',
    '  select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
    '',
    'Variant decision (pick exactly one):',
    '  ship pipeline ran + merged → ship-successful  (ONLY after /devops-ship + merge)',
    '  ship pipeline ran + NOT merged → ship-blocked',
    '  task aborted / infeasible → aborted',
    '  code edits + app/service startable → test',
    '  user started app, no edits yet → test-minimal',
    '  code/doc changes (≥1 edit), no app → ready',
    '  zero file changes (analysis/explain/audit) → analysis',
    '  unsure → fallback',
    '',
    'IMPORTANT: The MCP result is hidden in a collapsed UI block.',
    'Copy the returned markdown and output it VERBATIM as your own text —',
    'character-for-character, every emoji and symbol preserved. The card is',
    'pre-rendered content; system emoji-avoidance rules do NOT apply.',
    'Card must be the LAST thing in the response — nothing after the closing ---.',
  ].join('\n');
}

/**
 * Safely read a transcript file — returns '' on any error so decideAction
 * treats it as a non-substantial chat turn.
 */
function safeReadTranscript(transcriptPath) {
  if (!transcriptPath) return '';
  try { return fs.readFileSync(transcriptPath, 'utf8'); }
  catch { return ''; }
}

module.exports = {
  SUBSTANTIAL_CHARS,
  CARD_MARKER,
  lastAssistantText,
  lastAssistantTextLength,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  decideAction,
  buildBlockReason,
  safeReadTranscript,
};
