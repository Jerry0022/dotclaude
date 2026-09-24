#!/usr/bin/env node
/**
 * @hook prompt.run.contract
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Arm, refresh or pre-arm the do-run RUN CONTRACT from the prompt
 *   (run-contract spec B, G):
 *   - A user-typed `/do-run …` (or the harness form
 *     `<command-name>/devops:do-run</command-name><command-args>…`) makes no
 *     Skill tool call — it writes the arm marker with its args, so the router
 *     answers that follow get the preset mode (R2).
 *   - `RUN_BACKLOG_AUTOSTART:` / `AUTONOMOUS_AUTOSTART:` carry the run's
 *     answers as key=value pairs (ship=, passes=, strict=, queue=, burnMode=,
 *     phase=). An active contract of THIS session is refreshed in place
 *     (ship / passes / strict / items / presence only; the mode never changes
 *     except RUN_BACKLOG_AUTOSTART → backlog and `mode=analyze` over audit →
 *     passes cleared — R5). Otherwise a new one is armed with `source: machine`.
 *   Silent: never prints, never blocks. Kill switch DOTCLAUDE_RUN_CONTRACT=off.
 */

require('../lib/plugin-guard');

const MACHINE_RE = /^\s*(RUN_BACKLOG_AUTOSTART|AUTONOMOUS_AUTOSTART)\s*:/i;
const SLASH_RE = /^\s*\/(?:devops:)?do-run\b(.*)$/is;
const TAG_RE = /<command-name>\s*\/?(?:devops:)?do-run\s*<\/command-name>/i;
const TAG_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/i;

/** Args of a user-typed do-run slash command, or null when the prompt is none. */
function doRunSlashArgs(text) {
  if (typeof text !== 'string') return null;
  if (TAG_RE.test(text)) {
    const m = text.match(TAG_ARGS_RE);
    return m ? m[1].trim() : '';
  }
  const m = text.match(SLASH_RE);
  return m ? m[1].trim() : null;
}

function main(hook) {
  const text = hook.prompt || hook.user_message || hook.message || '';
  if (typeof text !== 'string') return;
  const slashArgs = doRunSlashArgs(text);
  if (slashArgs === null && !MACHINE_RE.test(text)) return;
  const RC = require('../lib/run-contract');
  if (RC.disabled()) return;
  const { projectRoot } = require('../lib/project-root');
  const root = projectRoot(hook.cwd || process.cwd());
  const sessionId = hook.session_id || null;

  if (slashArgs !== null) {
    RC.markPendingArm(root, { sessionId, args: slashArgs });
    return;
  }
  const fields = RC.parseMachinePrompt(text);
  if (!fields) return;
  const active = RC.readContract(root, { sessionId });
  if (active) {
    RC.update(root, RC.machinePatch(active, text), { sessionId });
  } else {
    RC.arm(root, { ...fields, modeFrom: 'machine', sessionId });
  }
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const { parseHookInput } = require('../lib/hook-input');
      const hook = parseHookInput(inputData);
      if (hook) main(hook);
    } catch { /* silent */ }
    process.exit(0);
  });
}

module.exports = { doRunSlashArgs };
