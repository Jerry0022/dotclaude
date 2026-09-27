/**
 * @module agent-model-gate
 * @version 0.1.0
 * @description Should this Agent spawn be refused once for an unchosen model?
 *
 *   Transcripts of 2026-09-24..27: 55 of 253 spawns (Explore, general-purpose,
 *   claude-code-guide) ran without a `model` and silently inherited the Opus
 *   session — Explore only locates, and the policy asks for sonnet there.
 *   The rule: every spawn names its model, even when it equals the session's.
 *   A spawn whose model would be inherited (no frontmatter model, or
 *   `model: inherit`) and that passes no `model` is refused once with the
 *   reason; repeating the identical spawn goes through — the deliberate
 *   exception. Effort cannot be passed at spawn (the Agent tool has no
 *   effort parameter): a cheap locator with a fixed effort is `devops:scout`.
 *
 *   Stateless on purpose: pre.agent.announce runs in parallel with the gate
 *   and must know whether the spawn goes through (a refused spawn gets no
 *   card). Both read the same transcript — "was an identical spawn of this
 *   turn already refused?" — so no session file can race.
 */

'use strict';

const MARKER = '[agent-model]';

/** Is this transcript entry the user's prompt (not a tool result, not meta)? */
function isPromptEntry(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta === true) return false;
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.some(b => b && b.type !== 'tool_result');
}

function sameSpawn(a, b) {
  return (a.subagent_type || 'general-purpose') === (b.subagent_type || 'general-purpose') &&
    String(a.description || '') === String(b.description || '');
}

function resultText(block) {
  const c = block && block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x && typeof x.text === 'string' ? x.text : '')).join('\n');
  return '';
}

/** Was an identical spawn refused by this gate earlier in the current turn? */
function refusedBefore(transcriptText, input, toolUseId) {
  const spawns = new Map(); // tool_use id → input
  const refused = new Set();
  for (const line of String(transcriptText || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    if (isPromptEntry(e)) { spawns.clear(); refused.clear(); continue; }
    const content = e.message && e.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (e.type === 'assistant' && b.type === 'tool_use' && b.name === 'Agent' && b.id !== toolUseId) spawns.set(b.id, b.input || {});
      if (e.type === 'user' && b.type === 'tool_result' && resultText(b).includes(MARKER)) refused.add(b.tool_use_id);
    }
  }
  for (const id of refused) {
    const prev = spawns.get(id);
    if (prev && sameSpawn(prev, input)) return true;
  }
  return false;
}

/**
 * @param {object} input Agent tool input
 * @param {string|null} frontmatterModel the agent file's `model`, null when none
 * @param {string} transcriptText
 * @param {string} [toolUseId]
 * @returns {boolean} true → refuse this spawn once
 */
function wouldRefuse(input, frontmatterModel, transcriptText, toolUseId) {
  if (typeof input.model === 'string' && input.model) return false;
  const base = frontmatterModel || 'inherit';
  if (base !== 'inherit') return false;
  // No transcript → the retry could never be recognised: fail open.
  if (!String(transcriptText || '').trim()) return false;
  return !refusedBefore(transcriptText, input, toolUseId);
}

function refusalText(input) {
  const type = input.subagent_type || 'general-purpose';
  const locate = /^(Explore|general-purpose)$/.test(type)
    ? ' Locating or a sweep → `devops:scout` (sonnet · low) instead of Explore.'
    : '';
  return (
    `${MARKER} \`${type}\` has no model of its own and would silently inherit the session model. ` +
    'Name the model in the spawn — `model: "sonnet"` for locating and routine work, `"opus"` only ' +
    `when the task needs the depth — even when it equals the session's.${locate} ` +
    'To keep the session model on purpose, repeat this exact spawn unchanged; it goes through.'
  );
}

module.exports = { MARKER, refusedBefore, wouldRefuse, refusalText };
