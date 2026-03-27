#!/usr/bin/env node
/**
 * @hook post.flow.edit-counter
 * @version 0.2.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After code edits (Edit/Write): increment the session-scoped
 *   edit counter. The completion card reminder has moved to the Stop hook
 *   (stop.flow.completion.js) so it fires on every completed response.
 *
 *   This hook only maintains the counter used by the Stop hook to decide
 *   whether to recommend /ship.
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
  if (skipExtensions.has(ext)) {
    process.exit(0);
  }

  // Increment edit counter
  let editCount = 0;
  try {
    editCount = parseInt(fs.readFileSync(SESSION_FILE, 'utf8'), 10) || 0;
  } catch {}
  editCount++;
  try { fs.writeFileSync(SESSION_FILE, editCount.toString()); } catch {}
});
