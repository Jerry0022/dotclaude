#!/usr/bin/env node
/**
 * @hook pre.strict.agent-gate
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @description While `/claude-strict` is active, refuse an Agent spawn whose
 *   prompt does not start with the contract block, and tell the caller how to
 *   fix it. This is how strict reaches every subagent — recursively, because
 *   plugin hooks also run inside subagents, so an agent spawning an agent hits
 *   the same gate.
 *
 *   Why a gate and not a rewrite: Claude Code ignores `updatedInput` for the
 *   Agent tool (anthropics/claude-code#44412), so the prompt cannot be patched
 *   here. Refusing once with a precise reason makes the caller prepend the
 *   block itself; the retry passes.
 *
 *   Worktree agents: an agent spawned with `isolation: worktree` runs in its
 *   own checkout on `<parent>-<role>`. It has no mode file of its own, so the
 *   gate falls back to the main worktree's mode when the branch derives from
 *   the armed one (strict-state.resolveInherited).
 *
 *   Injects nothing — prompt.strict.enforce is the only contract injector.
 */

require('../lib/plugin-guard');

const path = require('path');
const S = require('../lib/strict-state');

const LIB = path.resolve(__dirname, '..', 'lib', 'strict-state.js');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  if (hook.tool_name && hook.tool_name !== 'Agent') process.exit(0);

  const cwd = hook.cwd || process.cwd();
  let ev;
  try { ev = S.evaluate(cwd, { inherit: true }); } catch { process.exit(0); }
  if (!ev.active) process.exit(0);

  const input = hook.tool_input || {};
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (S.hasContract(prompt)) process.exit(0);

  const branch = ev.mode && ev.mode.branch ? ev.mode.branch : 'this worktree';
  process.stderr.write(
    `[claude-strict] BLOCKED: strict mode is active (${branch}) and this Agent prompt has no contract block.\n` +
    `Every spawned agent inherits strict. Prepend the block VERBATIM as the first lines of the prompt and retry.\n` +
    `Print it with:\n  node "${LIB}" contract\n` +
    'Then the task text as before — do not paraphrase or shorten the block.\n',
  );
  process.exit(2);
});
