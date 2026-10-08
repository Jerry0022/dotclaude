#!/usr/bin/env node
/**
 * @hook post.cleanup.gate
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Skill|AskUserQuestion
 * @description Arms and feeds the /auto-cleanup deletion gate
 *   (lib/cleanup-gate.js). A loaded auto-cleanup skill arms the gate for this
 *   session and drops every earlier confirmation; an ANSWERED AskUserQuestion
 *   with a `Dry-Run…` or `Unmerged…` header is recorded as a yes (an option
 *   label starting with Ja/Yes) or — Dry-Run only — revokes the earlier
 *   approvals. An AskUserQuestion that errors or is denied fires no
 *   PostToolUse, so it records nothing: no answer stays a no.
 *   pre.cleanup.gate reads the state.
 */

function main(hook) {
  const gate = require('../lib/cleanup-gate');
  const sessionId = hook.session_id;
  if (!sessionId) return null;
  const name = hook.tool_name || '';
  if (name === 'Skill' || name.endsWith('__Skill')) {
    const skill = hook.tool_input && hook.tool_input.skill;
    if (gate.isCleanupSkill(skill)) gate.arm(sessionId);
    return null;
  }
  if (name !== 'AskUserQuestion') return null;
  const state = gate.readState(sessionId);
  if (!state) return null;
  const { extractAnswers } = require('../lib/run-contract-answers');
  const { questions, answers } = extractAnswers(hook.tool_response, hook.tool_input);
  gate.recordAnswers(state, questions, answers);
  gate.writeState(sessionId, state);
  return null;
}

if (require.main === module) {
  try {
    require('../lib/plugin-guard');
    require('../lib/hook-input').runHook(main, { event: 'PostToolUse' });
  } catch {
    // fail open — a lib that fails to load never surfaces as a hook error
  }
}

module.exports = { main };
