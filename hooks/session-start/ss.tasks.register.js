#!/usr/bin/env node
/**
 * @hook ss.tasks.register
 * @version 0.1.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Ensure plugin scheduled tasks are registered for this session.
 *   Outputs instructions to Claude via stdout to create missing cron jobs.
 *   Claude reads these instructions and executes CronCreate accordingly.
 *   Tasks are session-scoped — re-registered each session start.
 */

const fs = require('fs');
const path = require('path');

// Read task definitions from the plugin's scheduled-tasks directory
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

// Build instructions for Claude
const instructions = [];
instructions.push(
  'Plugin scheduled tasks need registration for this session.',
  'Please register the following tasks using CronCreate:',
  ''
);

for (const task of TASK_DEFINITIONS) {
  const skillPath = path.join(TASKS_DIR, task.id, 'SKILL.md');
  let prompt = '';

  try {
    const content = fs.readFileSync(skillPath, 'utf8');
    // Extract everything after the frontmatter closing ---
    const parts = content.split('---');
    if (parts.length >= 3) {
      prompt = parts.slice(2).join('---').trim();
    } else {
      prompt = content;
    }
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
