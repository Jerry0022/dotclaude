#!/usr/bin/env node
/**
 * @hook pre.agent.model
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Agent
 * @description Refuses an Agent spawn once when it would silently inherit the
 *   session model — no `model` passed and the agent has none of its own
 *   (Explore, general-purpose, other plugins' agents, `model: inherit`).
 *   The identical spawn repeated goes through (the deliberate exception).
 *   An Explore spawn that passes gets a one-line hint toward devops:scout.
 *   Decision and reason: lib/agent-model-gate.js. Silent inside a subagent
 *   and for a spawn pre.strict.agent-gate refuses anyway. Fail-open.
 */

require('../lib/plugin-guard');

const gate = require('../lib/agent-model-gate');

function main(hook) {
  if (hook.tool_name && hook.tool_name !== 'Agent') return null;
  if (hook.agent_id) return null;
  const input = hook.tool_input || {};
  const cwd = hook.cwd || process.cwd();
  const announce = require('./pre.agent.announce');
  if (announce.strictWillBlock(cwd, typeof input.prompt === 'string' ? input.prompt : '')) return null;
  const file = announce.findAgentFile(input.subagent_type || 'general-purpose', cwd);
  const fm = (file && announce.readFrontmatter(file)) || {};
  const text = require('../lib/agent-card-relay').readTail(hook.transcript_path);
  if (gate.wouldRefuse(input, fm.model || null, text, hook.tool_use_id)) return { block: gate.refusalText(input) };
  const hint = gate.locateHint(input);
  return hint ? { context: hint } : null;
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PreToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main };
