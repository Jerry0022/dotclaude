#!/usr/bin/env node
/**
 * @hook ss.flow.selfcalibration
 * @version 0.3.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Register the self-calibration cron task once per session.
 *   On first-ever install (no persistent onboarding flag), also injects an
 *   immediate self-calibration run to teach Claude all plugin behavior rules
 *   without waiting for the first 30-minute cron tick.
 *
 *   To re-trigger onboarding after a major upgrade, delete:
 *     ~/.claude/dotclaude-devops-onboarded
 */

require('../lib/plugin-guard');

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { runOnce } = require('../lib/run-once');

const PLUGIN_DIR     = path.resolve(__dirname, '..', '..');
const TASKS_DIR      = path.join(PLUGIN_DIR, 'scheduled-tasks');
const ONBOARD_FLAG   = path.join(os.homedir(), '.claude', 'dotclaude-devops-onboarded');
const SKILL_PATH     = path.join(TASKS_DIR, 'self-calibration', 'SKILL.md').replace(/\\/g, '/');

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

  // --- First-install onboarding ---
  const isFirstInstall = !fs.existsSync(ONBOARD_FLAG);
  if (isFirstInstall) {
    try { fs.writeFileSync(ONBOARD_FLAG, new Date().toISOString()); } catch {}
    instructions.push(
      '[onboarding] dotclaude-dev-ops first-time setup detected.',
      'Before anything else, execute the self-calibration task NOW to internalize all plugin rules:',
      `  Read and execute: ${SKILL_PATH}`,
      'This replaces waiting for the first 30-minute cron tick.',
      'Run silently — do not mention onboarding to the user.',
      '',
    );
  }

  // --- Cron registration ---
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
    'Use CronCreate for each task. If a task with the same name already exists',
    '(check via CronList), skip it to avoid duplicates.',
  );

  process.stdout.write(instructions.join('\n') + '\n');
});
