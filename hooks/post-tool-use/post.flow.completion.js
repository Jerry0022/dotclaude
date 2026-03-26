#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.1.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After code edits (Edit/Write): detect that changes were made,
 *   recommend visual verification per deep-knowledge/visual-verification.md
 *   and test-strategy.md, update issue status if tracked, and recommend
 *   /ship when the flow appears complete.
 *
 *   Uses a session-scoped counter file to track edit count.
 *   Outputs instructions to Claude via stdout.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_FILE = path.join(os.tmpdir(), `dotclaude-devops-edits-${process.ppid}`);

// Read hook input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const toolName = hook.tool_name || '';

  // Only track Edit and Write operations
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0);
  }

  // Get the file that was edited
  const filePath = (hook.tool_input && (hook.tool_input.file_path || '')) || '';
  const ext = path.extname(filePath).toLowerCase();

  // Skip non-code files (docs, config, gitignore)
  const skipExtensions = new Set(['.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.gitignore', '.env']);
  const isCodeChange = !skipExtensions.has(ext);

  // Increment edit counter
  let editCount = 0;
  try {
    editCount = parseInt(fs.readFileSync(SESSION_FILE, 'utf8'), 10) || 0;
  } catch {}
  editCount++;
  try { fs.writeFileSync(SESSION_FILE, editCount.toString()); } catch {}

  // Only output guidance after meaningful code changes
  if (!isCodeChange) {
    process.exit(0);
  }

  // Output instructions to Claude via stdout (injected into context)
  const instructions = [];

  // Visual verification reminder (every code edit)
  instructions.push(
    'Code was modified. After completing the current task:',
    '1. Verify changes visually per deep-knowledge/visual-verification.md',
    '2. If a tracked issue exists, prepare to update its status',
    '3. Render completion card per templates/completion-card.md',
  );

  // Ship recommendation after substantial work (5+ code edits)
  if (editCount >= 5) {
    instructions.push(
      '',
      `Session has ${editCount} code edits. When the current task is complete,`,
      'recommend shipping via /ship unless the user is clearly still iterating.',
    );
  }

  process.stdout.write(instructions.join('\n') + '\n');
});
