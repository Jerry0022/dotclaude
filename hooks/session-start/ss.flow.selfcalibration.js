#!/usr/bin/env node
/**
 * @hook ss.flow.selfcalibration
 * @version 0.4.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Register the self-calibration cron task once per session.
 *   If the task is not yet registered (CronList is empty for this task),
 *   also execute it immediately — no waiting for the first 30-minute tick.
 *   If the task already exists in CronList, skip everything (no duplicate
 *   registration, no immediate run).
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
    cron: '*/30 * * * *',
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

  const instructions = [];

  // --- Cron registration + conditional immediate run ---
  instructions.push(
    'Plugin scheduled tasks need registration for this session.',
    'Please register the following tasks using CronCreate:',
    '',
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
      '',
    );
  }

  instructions.push(
    'Use CronCreate for each task, following this logic:',
    '1. Call CronList first.',
    '2. If the task already exists → skip it entirely (no registration, no immediate run).',
    '3. If the task does NOT exist → register it with CronCreate, then immediately',
    '   execute it once (read and run the SKILL.md now, before waiting for the first tick).',
  );

  process.stdout.write(instructions.join('\n') + '\n');
});
