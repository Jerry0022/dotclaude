#!/usr/bin/env node
/**
 * @hook post.ask.title
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher AskUserQuestion
 * @description The question is answered, so Claude works again: hands Claude
 *   the set call that puts back the ⏳ head the title had before the
 *   question (a running ship or concept keeps its own, else `⏳ ➜ 🤖 Solo ┃ `),
 *   to ride along with the next tool call. Rules: lib/ask-title.js. Silent
 *   inside a subagent and when the title no longer says Question. Fail-open.
 */

require('../lib/plugin-guard');

const ask = require('../lib/ask-title');

function main(hook) {
  if (hook.tool_name && hook.tool_name !== 'AskUserQuestion') return null;
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
