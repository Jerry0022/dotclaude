#!/usr/bin/env node
/**
 * @hook prompt.run.contract
 * @version 0.3.0
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
// RT2-R2: anchored to the START of the prompt (past an optional harness
// `<command-message>…</command-message>` preamble, which always precedes
// `<command-name>` in the real transcript shape) — an UNANCHORED test
// matched a pasted transcript/JSONL excerpt containing this tag ANYWHERE in
// the prompt text, not just a genuine harness-recorded slash invocation.
const LEAD = '^\\s*(?:<command-message>[^<]*<\\/command-message>\\s*)?';
const TAG_RE = new RegExp(`${LEAD}<command-name>\\s*\\/?(?:devops:)?do-run\\s*<\\/command-name>`, 'i');
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

// AUD-002: devops skills a user TYPES as a slash command, other than do-run /
// auto-concept (armed separately above / cleared below). A typed invocation
// never reaches the Skill tool, so without this the obligation it satisfies
// never records and stays open even though the pass ran.
const RECORDED_COMMANDS = new Set(['auto-harden', 'auto-polish', 'do-ship', 'auto-agents', 'auto-issue']);
const TYPED_CMD_RE = /^\s*\/(?:devops:)?([\w-]+)\b([\s\S]*)$/;

// RT2-R2: the tag form must be anchored to the prompt start too — an
// unanchored matchAll recorded a fake skill event (and cleared a pending
// hand-off / wrote an arm marker) for a `<command-name>` tag pasted
// mid-prompt, e.g. a transcript/JSONL excerpt quoted back at Claude. Only
// the FIRST tag counts, and only a bare name or an explicit `devops:`
// prefix — `/other:do-ship` is a foreign plugin's command, not ours.
const LEADING_TAG_RE = new RegExp(`${LEAD}<command-name>`);

/** Every devops slash-command name + args in the prompt text (typed `/x args`
 *  form, and the harness `<command-name>…<command-args>` form, both only
 *  when they open the prompt). Not filtered to RECORDED_COMMANDS — callers
 *  decide what a name means. */
function commandsIn(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const typed = text.match(TYPED_CMD_RE);
  if (typed) {
    out.push({ name: typed[1].toLowerCase(), args: typed[2].trim() });
    return out; // a typed prompt is exactly one slash command
  }
  if (!LEADING_TAG_RE.test(text)) return out;
  const { COMMAND_NAME_RE, COMMAND_ARGS_AFTER_RE } = require('../lib/skill-invocations');
  COMMAND_NAME_RE.lastIndex = 0;
  const m = COMMAND_NAME_RE.exec(text);
  if (!m) return out;
  const raw = m[1].replace(/^\//, '').toLowerCase();
  if (raw.includes(':') && !raw.startsWith('devops:')) return out; // foreign plugin prefix
  const name = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2000);
  const a = COMMAND_ARGS_AFTER_RE.exec(after);
  out.push({ name, args: a ? a[1].trim() : '' });
  return out;
}

function main(hook) {
  const text = hook.prompt || hook.user_message || hook.message || '';
  if (typeof text !== 'string') return;
  const slashArgs = doRunSlashArgs(text);
  const cmds = commandsIn(text);
  const hasAutoConcept = cmds.some(c => c.name === 'auto-concept');
  const recorded = cmds.filter(c => RECORDED_COMMANDS.has(c.name));
  if (slashArgs === null && !hasAutoConcept && !recorded.length && !MACHINE_RE.test(text)) return;
  const RC = require('../lib/run-contract');
  if (RC.disabled()) return;
  const { projectRoot } = require('../lib/project-root');
  const root = projectRoot(hook.cwd || process.cwd());
  const sessionId = hook.session_id || null;
  const s = { sessionId };

  // AUD-003: a typed do-run / auto-concept takes over a pending do-batch plan
  // just like the Skill-tool path does — clear the hand-off marker.
  if ((slashArgs !== null || hasAutoConcept) && RC.batchHandoffPending(root, s)) RC.clearBatchHandoff(root);

  // AUD-002: record each typed devops command as a `skill` event on the
  // active contract of THIS session, same as a Skill-tool call would.
  for (const c of recorded) {
    if (RC.readContract(root, s)) RC.record(root, { k: 'skill', name: c.name, args: c.args }, s);
  }

  if (slashArgs !== null) {
    RC.markPendingArm(root, { sessionId, args: slashArgs });
    return;
  }
  const fields = RC.parseMachinePrompt(text);
  if (!fields) return;
  const active = RC.readContract(root, s);
  if (active) {
    RC.update(root, RC.machinePatch(active, text), s);
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

module.exports = { doRunSlashArgs, commandsIn };
