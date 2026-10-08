#!/usr/bin/env node
/**
 * @hook post.flow.title-mode
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Skill|Bash|PowerShell
 * @description Hands Claude the exact session title a skill's mode step needs,
 *   so the skill no longer runs the `get_session` → strip → `set_session_title`
 *   ritual (each extra tool round trip re-reads the whole context):
 *   - Skill `do-ship` loaded → `🚀 Shipping – ` (do-ship Pre-Step C).
 *   - the do-batch activate command (`batch-state.js').activate(`) ran →
 *     `📥 Batch – ` (do-batch 2.2b).
 *   - the do-batch deactivate command ran → the leading `📥 Batch – `
 *     stripped (merge.md § Retire: 4.8, Step 5, expiry).
 *   The current title comes off the transcript tail (lib/session-title.js),
 *   the rules are that lib's (`nextTitle`, `batchTitle`, `unbatchTitle`) —
 *   the same prefix semantics the old prose routine spelled out. The reply
 *   asks for set_session_title in the SAME message as Claude's next tool
 *   call, so the rename costs no API call of its own.
 *   Title already right → no output (the skills read silence as "done").
 *   Title unknown (no transcript, no title entry yet) → a one-line pointer to
 *   the skill's get_session fallback, so the semantics never break.
 *   A ship typed as `/do-ship` loads no Skill tool — prompt.flow.title-work
 *   marks that prompt itself.
 */

require('../lib/plugin-guard');

const { runHook } = require('../lib/hook-input');
const { isSkillTool, normalizeSkillName } = require('../lib/skill-invocations');
const {
  SHIPPING_PREFIX, nextTitle, batchTitle, unbatchTitle, readCurrentTitle,
} = require('../lib/session-title');

const TAG = '[post.flow.title-mode]';

/** The do-batch state calls the skill runs (`require('…/batch-state.js').activate(…)`). */
const BATCH_CALL_RE = /batch-state(?:\.js)?['"]?\s*\)\s*\.(activate|deactivate)\s*\(/g;

/**
 * The title mode a tool call starts or ends, or null.
 *
 * @param {object} hook PostToolUse payload
 * @returns {'ship'|'batch-on'|'batch-off'|null}
 */
function modeOf(hook) {
  const input = hook && hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  if (isSkillTool(hook.tool_name)) {
    return normalizeSkillName(input.skill) === 'do-ship' ? 'ship' : null;
  }
  if (hook.tool_name !== 'Bash' && hook.tool_name !== 'PowerShell') return null;
  const cmd = typeof input.command === 'string' ? input.command : '';
  let last = null;
  for (const m of cmd.matchAll(BATCH_CALL_RE)) last = m[1];
  if (last === 'activate') return 'batch-on';
  if (last === 'deactivate') return 'batch-off';
  return null;
}

/** Where each mode's skill keeps its get_session fallback. */
const FALLBACK = {
  ship: 'do-ship Pre-Step C',
  'batch-on': 'do-batch deep-knowledge/activation.md § Session title prefix',
  'batch-off': 'do-batch deep-knowledge/merge.md § Retire',
};

/** `current` → the title `mode` leaves, or null for "leave it". */
function targetFor(mode, current) {
  if (mode === 'ship') return nextTitle(current, { prefix: SHIPPING_PREFIX });
  if (mode === 'batch-on') return batchTitle(current);
  return unbatchTitle(current);
}

/**
 * The instruction for a known target title: set it in parallel with the next
 * tool call — no get_session, no message of its own.
 */
function setInstruction(title, mode) {
  return [
    `${TAG} Desktop app only, once: mcp__ccd_session_mgmt__set_session_title ` +
      `{session_id:"self", title:${JSON.stringify(title)}} in the SAME message as your next tool call ` +
      '(parallel — no get_session, no message of its own). No further tool call this turn → call it alone.',
    `This replaces the get_session steps of ${FALLBACK[mode]}.`,
    'Only deferred → ToolSearch "select:mcp__ccd_session_mgmt__set_session_title" in that batch, the set call in the next. ' +
      'Not even deferred, or it fails: skip silently.',
    'Do not mention this to the user.',
  ].join('\n');
}

/** The instruction when the transcript does not reveal the title. */
function unknownInstruction(mode) {
  return `${TAG} Title unknown here — run the get_session fallback of ${FALLBACK[mode]} (Desktop app only; skip silently elsewhere). Do not mention this to the user.`;
}

/**
 * The reply for a PostToolUse payload.
 *
 * @param {object} hook
 * @param {{ readTitle?: (p: string|undefined) => string|null }} [deps] test seam
 * @returns {{context: string}|null}
 */
function main(hook, deps = {}) {
  const mode = modeOf(hook);
  if (!mode) return null;
  const current = (deps.readTitle || readCurrentTitle)(hook.transcript_path);
  if (current === null) return { context: unknownInstruction(mode) };
  const next = targetFor(mode, current);
  return next === null ? null : { context: setInstruction(next, mode) };
}

if (require.main === module) runHook(main, { event: 'PostToolUse' });

module.exports = { main, modeOf, targetFor, setInstruction, unknownInstruction };
