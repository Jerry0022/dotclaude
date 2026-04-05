#!/usr/bin/env node
/**
 * @hook ss.flow.selfcalibration
 * @version 0.5.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @deprecated Moved to UserPromptSubmit (prompt.flow.selfcalibration.js).
 *   Kept as fallback for older runtimes that don't support UserPromptSubmit.
 *   The UserPromptSubmit variant fires right before Claude processes the first
 *   user message, giving the instructions higher priority.
 */

require('../lib/plugin-guard');

const fs   = require('fs');
const path = require('path');
const { runOnce } = require('../lib/run-once');

const PLUGIN_DIR  = path.resolve(__dirname, '..', '..');
const TASKS_DIR   = path.join(PLUGIN_DIR, 'scheduled-tasks');

const TASK_DEFINITIONS = [
  {
    id: 'self-calibration',
    cron: '*/10 * * * *',
    recurring: true,
    description: 'Periodic self-audit and skill internalization',
  },
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let sessionId;
  try {
    const input = JSON.parse(inputData);
    sessionId = input.session_id;
  } catch {}

  // Once-per-session guard
  if (!runOnce('ss-flow-selfcalibration', sessionId)) process.exit(0);

  // Build compact, high-priority registration instruction
  const tasks = [];
  for (const task of TASK_DEFINITIONS) {
    const skillPath = path.join(TASKS_DIR, task.id, 'SKILL.md');
    try {
      fs.readFileSync(skillPath, 'utf8');
    } catch {
      continue;
    }
    const pluginRoot = PLUGIN_DIR.replace(/\\/g, '/');
    tasks.push({ ...task, skillPath: skillPath.replace(/\\/g, '/'), pluginRoot });
  }

  if (tasks.length === 0) process.exit(0);

  const lines = [
    'BLOCKING — execute BEFORE responding to the user message:',
    '',
  ];

  for (const t of tasks) {
    lines.push(
      `Register cron via CronCreate: cron="${t.cron}", recurring=${t.recurring}, prompt="Execute the ${t.id} scheduled task as defined in the plugin. Read the full task definition from: ${t.skillPath} — Plugin root: ${t.pluginRoot}"`,
      `Then immediately execute it once: read ${t.skillPath} and run Step 0 (Completion Flow Internalization).`,
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
});
