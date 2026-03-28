#!/usr/bin/env node
/**
 * @hook ss.flow.selfcalibration
 * @version 0.2.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Register the self-calibration cron task once per session.
 *   Reads session_id from stdin to ensure the registration output is
 *   emitted exactly once, even when SessionStart fires multiple times.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { runOnce } = require('../lib/run-once');

const PLUGIN_DIR = path.resolve(__dirname, '..', '..');
const TASKS_DIR = path.join(PLUGIN_DIR, 'scheduled-tasks');

const TASK_DEFINITIONS = [
  {
    id: 'self-calibration',
    cron: '*/30 * * * *',
    recurring: true,
    description: 'Periodic self-audit and skill internalization',
  },
];

// Read stdin for session_id (async, same pattern as other hooks)
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

  // Build instructions for Claude
  const instructions = [];
  instructions.push(
    'Plugin scheduled tasks need registration for this session.',
    'Please register the following tasks using CronCreate:',
    ''
  );

  for (const task of TASK_DEFINITIONS) {
    const skillPath = path.join(TASKS_DIR, task.id, 'SKILL.md');

    try {
      fs.readFileSync(skillPath, 'utf8');
    } catch {
      instructions.push(`WARNING: Could not read ${skillPath} — skipping ${task.id}`);
      continue;
    }

    instructions.push(
      `Task: ${task.id}`,
      `Cron: ${task.cron}`,
      `Recurring: ${task.recurring}`,
      `Description: ${task.description}`,
      `Prompt: Execute the ${task.id} scheduled task as defined in the plugin.`,
      `  Read the full task definition from: scheduled-tasks/${task.id}/SKILL.md`,
      ''
    );
  }

  instructions.push(
    'Use CronCreate for each task. If a task with the same name already exists',
    '(check via CronList), skip it to avoid duplicates.',
  );

  process.stdout.write(instructions.join('\n') + '\n');
});
