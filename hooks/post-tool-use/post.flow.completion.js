#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.5.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After code edits (Edit/Write): increment the session edit
 *   counter AND inject the completion-card reminder. The reminder fires after
 *   every code edit so Claude always has the instruction in context when it
 *   finishes its last edit — solving the timing problem of the Stop hook
 *   (which fires too late to influence the current response).
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { sessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0);
  }

  const filePath = (hook.tool_input && (hook.tool_input.file_path || '')) || '';
  const ext = path.extname(filePath).toLowerCase();

  // Skip non-code files (docs, config, gitignore)
  const skipExts = new Set(['.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.gitignore', '.env']);
  if (skipExts.has(ext)) {
    process.exit(0);
  }

  // --- 1. Increment edit counter ---
  const counterFile = sessionFile('dotclaude-devops-edits', hook.session_id);
  let editCount = 0;
  try {
    editCount = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
  } catch {}
  editCount++;
  try { fs.writeFileSync(counterFile, editCount.toString()); } catch {}

  // --- 2. Emit completion-card reminder (read from template) ---
  const pluginRoot = path.resolve(__dirname, '..');
  const templatePath = path.join(pluginRoot, 'templates', 'completion-card.md');
  let templateContent = '';
  try {
    templateContent = fs.readFileSync(templatePath, 'utf8');
  } catch {
    // Template not found — emit minimal fallback
    templateContent = 'COMPLETION CARD: Render the completion card after your last edit. Template missing — use standard format.';
  }

  const lines = [];
  lines.push(
    `[completion-flow] Code edit #${editCount} recorded.`,
    'When you have finished ALL edits for this task, end your response with the completion card.',
    '',
    templateContent,
  );

  if (editCount >= 5) {
    lines.push(
      '',
      `SHIP: ${editCount} code edits this session. Recommend /ship when task is done.`,
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
});
