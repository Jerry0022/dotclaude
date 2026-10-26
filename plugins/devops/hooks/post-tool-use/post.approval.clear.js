#!/usr/bin/env node
/**
 * @hook post.approval.clear
 * @version 0.1.0
 * @event PostToolUse, PostToolUseFailure
 * @plugin devops
 * @description A background agent's tool call finished: drops its permission
 *   wait (and every one the agent moved past — a denied dialog fires no
 *   event) from lib/approval-wait.js, so perm.approval.watch can put the ⏳
 *   head back. Subagent calls only; one stat when nothing waits. Silent,
 *   fail-open.
 */

require('../lib/plugin-guard');

function main(hook) {
  if (!hook.agent_id) return null;
  require('../lib/approval-wait').clear(hook);
  return null;
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PostToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main };
