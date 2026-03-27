#!/usr/bin/env node
/**
 * @hook stop.flow.completion
 * @version 0.3.0
 * @event Stop
 * @plugin dotclaude-dev-ops
 * @description When Claude finishes a response: remind to render the completion
 *   card per templates/completion-card.md and recommend visual verification
 *   per deep-knowledge/visual-verification.md. Also recommend /ship after
 *   substantial code edits (5+).
 *
 *   Uses a session-scoped counter file to track edit count
 *   (written by the PostToolUse edit-counter).
 */

const fs = require('fs');
const { sessionFile } = require('../lib/session-id');

// Read hook input from stdin (Stop hooks also receive session_id)
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { hook = {}; }

  const counterFile = sessionFile('dotclaude-devops-edits', hook.session_id);

  // Read edit counter (may have been incremented by PostToolUse hooks)
  let editCount = 0;
  try {
    editCount = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
  } catch {}

  const instructions = [];

  instructions.push(
    'Response complete. Before finishing:',
    '1. If changes affect visible output, verify per deep-knowledge/visual-verification.md',
    '2. If a tracked issue exists, prepare to update its status',
    '3. Render completion card per templates/completion-card.md (MANDATORY — always the last thing in the response)',
  );

  if (editCount >= 5) {
    instructions.push(
      '',
      `Session has ${editCount} code edits.`,
      'Recommend shipping via /ship unless the user is clearly still iterating.',
    );
  }

  process.stdout.write(instructions.join('\n') + '\n');
});
