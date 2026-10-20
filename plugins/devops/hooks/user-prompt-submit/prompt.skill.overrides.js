#!/usr/bin/env node
/**
 * @hook prompt.skill.overrides
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Two jobs of the override loader (lib/skill-overrides.js) on a
 *   user prompt:
 *   - a skill the user TYPED (`/do-ship`, `/devops:do-run backlog`, or the
 *     harness `<command-name>` form) loads no Skill tool, so
 *     post.skill.overrides never fires — this hook injects the same
 *     `[skill-overrides]` block and records it for the card;
 *   - a record the completion card already showed is cleared, so the card's
 *     "🧩 Override aktiv" line names only overrides active since the last card.
 *   No override file → no output.
 */

require('../lib/plugin-guard');

const { runHook } = require('../lib/hook-input');
const { overrideBlock, recordOverrides, clearRendered } = require('../lib/skill-overrides');
const { commandsIn } = require('./prompt.run.contract');

/**
 * @param {object} hook UserPromptSubmit payload
 * @param {{home?:string, dir?:string, pluginRoot?:string}} [opts] test seam
 * @returns {{context:string}|null}
 */
function main(hook, opts = {}) {
  if (!hook) return null;
  try { clearRendered(hook.session_id, { dir: opts.dir }); } catch { /* advisory */ }
  const prompt = typeof hook.prompt === 'string' ? hook.prompt : '';
  const texts = [];
  for (const cmd of commandsIn(prompt)) {
    const block = overrideBlock(cmd.name, {
      cwd: hook.cwd,
      args: cmd.args,
      home: opts.home,
      pluginRoot: opts.pluginRoot,
    });
    if (!block) continue;
    try { recordOverrides(hook.session_id, block.record, { dir: opts.dir }); } catch { /* advisory */ }
    texts.push(block.text);
  }
  return texts.length ? { context: texts.join('\n\n') } : null;
}

if (require.main === module) runHook(main, { event: 'UserPromptSubmit' });

module.exports = { main };
