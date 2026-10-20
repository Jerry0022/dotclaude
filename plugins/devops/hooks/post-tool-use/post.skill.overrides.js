#!/usr/bin/env node
/**
 * @hook post.skill.overrides
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Skill
 * @description The override loader for a skill started through the Skill
 *   tool: resolves the skill's global + project `reference.md` (legacy
 *   `SKILL.md`, pre-PR-2 dir names), parses the directive headings (Add /
 *   Skip / Replace / Step N) and injects ONE `[skill-overrides]` block —
 *   the skill's Step 0. Records the active overrides for the completion
 *   card's "🧩 Override aktiv" line. No override file → no output.
 *   Logic: lib/skill-overrides.js. A typed `/skill` loads no Skill tool —
 *   prompt.skill.overrides covers that path.
 */

require('../lib/plugin-guard');

const { runHook } = require('../lib/hook-input');
const { isSkillTool } = require('../lib/skill-invocations');
const { overrideBlock, recordOverrides } = require('../lib/skill-overrides');

/**
 * @param {object} hook PostToolUse payload
 * @param {{home?:string, dir?:string, pluginRoot?:string}} [opts] test seam
 * @returns {{context:string}|null}
 */
function main(hook, opts = {}) {
  if (!hook || !isSkillTool(hook.tool_name)) return null;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  if (typeof input.skill !== 'string') return null;
  const block = overrideBlock(input.skill, {
    cwd: hook.cwd,
    args: typeof input.args === 'string' ? input.args : '',
    home: opts.home,
    pluginRoot: opts.pluginRoot,
  });
  if (!block) return null;
  try { recordOverrides(hook.session_id, block.record, { dir: opts.dir }); } catch { /* advisory */ }
  return { context: block.text };
}

if (require.main === module) runHook(main, { event: 'PostToolUse' });

module.exports = { main };
