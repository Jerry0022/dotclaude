#!/usr/bin/env node
/**
 * @hook pre.cleanup.gate
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description While /auto-cleanup is armed in this session
 *   (post.cleanup.gate), refuses every branch / worktree delete that no
 *   answered Dry-Run-Confirm names, and every delete of a branch whose
 *   content has not landed in the default branch without its own
 *   `Unmerged` yes (lib/cleanup-gate.js). Outside an armed session it does
 *   nothing. Exit 2 + stderr on a refusal.
 */

function gitFor(dir) {
  const { gitRun } = require('../lib/git-timeout');
  return (args) => {
    try { return String(gitRun(dir, args)).trim(); } catch { return null; }
  };
}

function main(hook) {
  const name = hook.tool_name || '';
  if (name !== 'Bash' && name !== 'PowerShell') return null;
  const command = hook.tool_input && hook.tool_input.command;
  if (!command || typeof command !== 'string' || !hook.session_id) return null;
  const gate = require('../lib/cleanup-gate');
  const state = gate.readState(hook.session_id);
  if (!state) return null;
  return gate.decide({ command, cwd: hook.cwd || process.cwd(), state, gitFor });
}

if (require.main === module) {
  try {
    require('../lib/plugin-guard');
    require('../lib/hook-input').runHook(main, { event: 'PreToolUse' });
  } catch {
    // fail open — a lib that fails to load never surfaces as a hook error
  }
}

module.exports = { main, gitFor };
