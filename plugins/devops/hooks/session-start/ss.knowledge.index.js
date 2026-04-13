#!/usr/bin/env node
/**
 * @hook ss.knowledge.index
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Inject deep-knowledge INDEX.md into context at session start.
 *   Gives Claude awareness of all available reference docs before message #1.
 *   Fires on startup/clear/compact (context reset events), skips resume.
 *   Uses run-once to prevent duplicate injection within a session.
 */

require('../lib/plugin-guard');

const { runOnce } = require('../lib/run-once');
const fs = require('fs');
const path = require('path');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // Skip on resume — index is still in context from startup
  const source = hook.source || hook.trigger || '';
  if (source === 'resume') process.exit(0);

  // Run-once guard per session (reset on clear/compact via new session_id)
  if (!runOnce('ss-knowledge-index', hook.session_id)) process.exit(0);

  // Locate INDEX.md relative to plugin root
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(__dirname, '..', '..');
  const indexPath = path.join(pluginRoot, 'deep-knowledge', 'INDEX.md');

  if (!fs.existsSync(indexPath)) process.exit(0);

  const content = fs.readFileSync(indexPath, 'utf8').trim();

  // Output as additionalContext (discrete injection, not visible in transcript)
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        '[deep-knowledge] The following reference docs are available.',
        'Read individual files from deep-knowledge/ when a topic is relevant to the task.',
        '',
        content,
      ].join('\n'),
    },
  };

  process.stdout.write(JSON.stringify(output));
});
