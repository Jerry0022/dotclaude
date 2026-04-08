#!/usr/bin/env node
/**
 * @hook prompt.flow.selfcalibration
 * @version 0.6.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Register the self-calibration cron task once per session.
 *   Moved from SessionStart to UserPromptSubmit so the instruction is injected
 *   directly before Claude processes the first user message — giving it higher
 *   priority than SessionStart system-reminders, which Claude may deprioritize
 *   in favor of the user's task.
 *
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

// Stable base path for glob-based discovery (version-agnostic).
// The cache may be rebuilt mid-session by ss.plugin.update, which deletes the
// old versioned dir. Baking __dirname into the cron prompt would point to a
// deleted path. Instead, we emit a glob pattern so Claude can resolve the
// latest cache at cron fire time.
const home = process.env.HOME || process.env.USERPROFILE || '';
const PLUGIN_GLOB_BASE = path.join(home, '.claude', 'plugins', 'cache').replace(/\\/g, '/');

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

  // Once-per-session guard — only inject on the very first user prompt
  if (!runOnce('prompt-flow-selfcalibration', sessionId)) process.exit(0);

  // Build compact, high-priority registration instruction.
  // Paths must survive mid-session cache rebuilds (ss.plugin.update deletes
  // the old versioned dir). When running from cache, emit a glob with a
  // wildcard version. When running from repo (dev), use the direct path.
  const normalizedPluginDir = PLUGIN_DIR.replace(/\\/g, '/');
  const normalizedCacheBase = PLUGIN_GLOB_BASE;
  const inCache = normalizedPluginDir.startsWith(normalizedCacheBase + '/');

  const tasks = [];
  for (const task of TASK_DEFINITIONS) {
    const skillPath = path.join(TASKS_DIR, task.id, 'SKILL.md');
    try {
      fs.readFileSync(skillPath, 'utf8');
    } catch {
      continue;
    }

    let skillGlob;
    if (inCache) {
      // Cache path: ~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/...
      const rel = normalizedPluginDir.slice(normalizedCacheBase.length + 1);
      const parts = rel.split('/'); // ["dotclaude", "devops", "0.35.2"]
      skillGlob = `${normalizedCacheBase}/${parts[0]}/${parts[1]}/*/scheduled-tasks/${task.id}/SKILL.md`;
    } else {
      // Repo / dev path — no cache rebuild risk, use direct path
      skillGlob = `${normalizedPluginDir}/scheduled-tasks/${task.id}/SKILL.md`;
    }
    tasks.push({ ...task, skillGlob });
  }

  if (tasks.length === 0) process.exit(0);

  const lines = [
    'BLOCKING — execute BEFORE responding to the user message:',
    '',
  ];

  for (const t of tasks) {
    lines.push(
      `Register cron via CronCreate: cron="${t.cron}", recurring=${t.recurring}, prompt="Execute the ${t.id} scheduled task as defined in the plugin. Glob for the SKILL.md: ${t.skillGlob} — use the match to derive the plugin root (parent of scheduled-tasks/)."`,
      `Then immediately execute it once: glob for ${t.skillGlob}, read the result, and run Step 0 (Completion Flow Internalization).`,
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
});
