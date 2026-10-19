#!/usr/bin/env node
/**
 * @hook stop.session.autosave
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Safety net for session worktrees: a turn that ends with
 *   uncommitted work or unpushed commits in .claude/worktrees/<name> and no
 *   open PR gets a WIP commit and a push (lib/session-autosave.js). Config:
 *   sessionEnd.autosave = push (default) | local | off. Silent unless it
 *   saved something; never blocks, never fails the stop.
 */

require('../lib/plugin-guard');

const { runHook } = require('../lib/hook-input');

function main(hook) {
  if (hook.agent_id) return null;
  const cwd = hook.cwd || process.cwd();
  const mode = require('../lib/devops-config').load(cwd).values.sessionEnd.autosave;
  if (mode === 'off') return null;
  const res = require('../lib/session-autosave').autosave({
    cwd, mode, shipActive: (top) => require('../lib/ship-sentinel').isActive(top),
  });
  return res ? JSON.stringify({ systemMessage: res.message }) : null; // Stop has no additionalContext channel
}

module.exports = { main };

if (require.main === module) {
  try {
    runHook(main, { event: 'Stop' });
  } catch {
    // fail open
  }
}
