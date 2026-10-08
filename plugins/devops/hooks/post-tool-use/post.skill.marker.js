#!/usr/bin/env node
/**
 * @hook post.skill.marker
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Skill
 * @description Record a loaded skill in the caller's per-turn marker
 *   (lib/skill-turn-marker) — the "skill ran this turn" signal for runs with
 *   no transcript on disk (`claude -p --no-session-persistence`, the A/B eval
 *   runner), read by pre.issue.guard only when the transcript is missing.
 *   Keyed by session_id (+ agent_id for a subagent). Silent: no output,
 *   always exit 0.
 */

require('../lib/plugin-guard');

const { runHook } = require('../lib/hook-input');
const { isSkillTool } = require('../lib/skill-invocations');
const { recordSkill } = require('../lib/skill-turn-marker');

/**
 * @param {object} hook parsed PostToolUse payload
 * @returns {null}
 */
function main(hook) {
  if (!isSkillTool(hook.tool_name)) return null;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  if (typeof input.skill === 'string') recordSkill(hook, input.skill);
  return null;
}

if (require.main === module) runHook(main, { event: 'PostToolUse' });

module.exports = { main };
