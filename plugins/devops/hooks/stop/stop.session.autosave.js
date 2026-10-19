#!/usr/bin/env node
/**
 * @hook stop.session.autosave
 * @version 0.2.0
 * @event Stop
 * @plugin devops
 * @description Safety net for session worktrees: a turn that ends with
 *   uncommitted work or unpushed commits in .claude/worktrees/<name> and no
 *   open PR is snapshotted to the local branch parked/autosave/<name>
 *   (lib/session-autosave.js) — the user's branch, index and files are never
 *   touched. Config: sessionEnd.autosave = local (default) | push | off.
 *   Silent unless it saved something; never blocks, never fails the stop.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');

async function main(hook) {
  if (hook.agent_id) return null;
  const cwd = hook.cwd || process.cwd();
  const mode = require('../lib/devops-config').load(cwd).values.sessionEnd.autosave;
  if (mode === 'off') return null;
  const res = await require('../lib/session-autosave').autosave({
    cwd, mode, shipActive: (top) => require('../lib/ship-sentinel').isActive(top),
  });
  // Stop has no additionalContext channel: systemMessage is the one-line notice
  return res ? JSON.stringify({ systemMessage: res.message }) : null;
}

module.exports = { main };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', async () => {
    try {
      const hook = parseHookInput(raw);
      const out = hook ? await main(hook) : null;
      if (out) process.stdout.write(`${out}\n`);
    } catch {
      // fail open
    }
    process.exitCode = 0;
  });
}
