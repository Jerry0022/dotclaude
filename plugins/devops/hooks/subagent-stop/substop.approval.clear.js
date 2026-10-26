#!/usr/bin/env node
/**
 * @hook substop.approval.clear
 * @version 0.1.0
 * @event SubagentStop
 * @plugin devops
 * @description A background agent ended: every permission wait it left in
 *   lib/approval-wait.js goes (a denied last dialog fires no other event), so
 *   perm.approval.watch can put the ⏳ head back. Silent, fail-open.
 */

require('../lib/plugin-guard');

function main(hook) {
  if (!hook.agent_id) return null;
  require('../lib/approval-wait').clear({ ...hook, hook_event_name: 'SubagentStop' });
  return null;
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'SubagentStop' });
  } catch {
    // fail open
  }
}

module.exports = { main };
