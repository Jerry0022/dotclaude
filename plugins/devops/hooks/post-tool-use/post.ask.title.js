#!/usr/bin/env node
/**
 * @hook post.ask.title
 * @version 0.2.0
 * @event PostToolUse
 * @plugin devops
 * @matcher AskUserQuestion|ExitPlanMode|mcp__ccd_session__start_session
 * @description The user answered (a question, a plan approval, a
 *   start_session approval), so Claude works again: hands Claude the set call
 *   that puts back the ⏳ head the title had before the question (a running ship or concept keeps its own, else `⏳ ➜ 🤖 Solo ┃ `),
 *   to ride along with the next tool call. Rules: lib/ask-title.js. Silent
 *   inside a subagent and when the title no longer says Question. Fail-open.
 */

require('../lib/plugin-guard');

const ask = require('../lib/ask-title');

function main(hook) {
  if (hook.tool_name && !ask.isBlockingCall(hook.tool_name, hook.tool_input)) return null;
  if (hook.agent_id) return null;
  const { readCurrentTitle } = require('../lib/session-title');
  const current = readCurrentTitle(hook.transcript_path);
  if (!ask.isQuestionTitle(current)) return null;
  const text = require('../lib/agent-card-relay').readTail(hook.transcript_path);
  const target = ask.restoredTitle(current, ask.previousTitle(text));
  return target ? { context: ask.restoreText(target) } : null;
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PostToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main };
