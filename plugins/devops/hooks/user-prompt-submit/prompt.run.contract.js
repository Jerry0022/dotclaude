#!/usr/bin/env node
/**
 * @hook prompt.run.contract
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Arm or refresh the do-run RUN CONTRACT from a machine prompt
 *   (run-contract spec G): `RUN_BACKLOG_AUTOSTART:` / `AUTONOMOUS_AUTOSTART:`
 *   carry the run's answers as key=value pairs (ship=, passes=, strict=,
 *   queue=, burnMode=, phase=). An active contract of the same mode is
 *   refreshed in place (events and segments kept — every wake of a loop
 *   re-sends the prompt); otherwise a new one is armed with `source: machine`.
 *   `phase=presence` sets `presence: false`. Silent: never prints, never
 *   blocks. Kill switch DOTCLAUDE_RUN_CONTRACT=off.
 */

require('../lib/plugin-guard');

const MACHINE_RE = /^\s*(RUN_BACKLOG_AUTOSTART|AUTONOMOUS_AUTOSTART)\s*:/i;

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  try {
    const { parseHookInput } = require('../lib/hook-input');
    const hook = parseHookInput(inputData);
    if (!hook) process.exit(0);
    const text = hook.prompt || hook.user_message || hook.message || '';
    if (typeof text !== 'string' || !MACHINE_RE.test(text)) process.exit(0);
    const RC = require('../lib/run-contract');
    if (RC.disabled()) process.exit(0);
    const fields = RC.parseMachinePrompt(text);
    if (!fields) process.exit(0);
    const { projectRoot } = require('../lib/project-root');
    const root = projectRoot(hook.cwd || process.cwd());
    const active = RC.readContract(root);
    if (active && active.mode === fields.mode) {
      const patch = { ...fields };
      delete patch.source; // a router-armed contract stays router-armed
      RC.update(root, patch);
    } else {
      RC.arm(root, { ...fields, sessionId: hook.session_id || null });
    }
  } catch { /* silent */ }
  process.exit(0);
});
