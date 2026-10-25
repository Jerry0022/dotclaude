#!/usr/bin/env node
/**
 * @hook pre.ask.title
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher AskUserQuestion
 * @description Puts `👉 ➜ ❓ Question ┃ ` on the session title BEFORE a
 *   question blocks: a title still on ⏳ (and no set_session_title to the
 *   question title in the same message) refuses the question once per turn
 *   with the exact set call to send alongside the repeated question. Rules:
 *   lib/ask-title.js. Silent inside a subagent, for a batch title and when
 *   the title is unknown (no Desktop app). Fail-open.
 */

require('../lib/plugin-guard');

const ask = require('../lib/ask-title');

function main(hook) {
  if (hook.tool_name && hook.tool_name !== 'AskUserQuestion') return null;
  if (hook.agent_id) return null;
  const { readCurrentTitle } = require('../lib/session-title');
  const target = ask.questionTitle(readCurrentTitle(hook.transcript_path));
  if (!target) return null;
  const text = require('../lib/agent-card-relay').readTail(hook.transcript_path);
  if (!text.trim()) return null;
  const { titleSet, refused } = ask.turnState(text, hook.tool_use_id);
  if (titleSet || refused) return null;
  return { block: ask.refusalText(target) };
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PreToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main };
