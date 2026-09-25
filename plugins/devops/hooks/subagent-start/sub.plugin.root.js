#!/usr/bin/env node
/**
 * @hook sub.plugin.root
 * @version 0.1.0
 * @event SubagentStart
 * @plugin devops
 * @description Give every subagent the literal devops plugin root.
 *   Agent bodies (agents/*.md) and spawn prompts name plugin docs as
 *   `{PLUGIN_ROOT}/deep-knowledge/<file>`. A skill can infer the root from its
 *   "Base directory" line, but a subagent gets nothing equivalent: the
 *   SessionStart injection (ss.knowledge.index) does not reach it and
 *   $CLAUDE_PLUGIN_ROOT is unset in the Bash tool. On 2026-09-24 devops:frontend
 *   subagents therefore ran `find / -maxdepth 6 -iname ui-defaults.md`; the
 *   Bash timeout backgrounded the crawl and find.exe ran for hours after the
 *   agent had finished. This hook injects the one line from lib/plugin-root
 *   as additionalContext. pre.crawl.guard stays the backstop.
 *   Never blocks: every failure path exits 0 silently.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');
const { pluginRootLine } = require('../lib/plugin-root');

/**
 * The hook output for a SubagentStart payload, or null.
 * @param {string} inputData raw stdin
 * @returns {object|null}
 */
function buildOutput(inputData) {
  const hook = parseHookInput(inputData);
  if (!hook) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: pluginRootLine(),
    },
  };
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const out = buildOutput(inputData);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch { /* never fail a subagent start */ }
    process.exit(0);
  });
}

module.exports = { buildOutput };
