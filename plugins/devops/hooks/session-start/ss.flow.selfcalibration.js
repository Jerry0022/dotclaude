#!/usr/bin/env node
/**
 * @hook ss.flow.selfcalibration
 * @version 0.6.0
 * @event SessionStart
 * @plugin devops
 * @deprecated Moved to UserPromptSubmit (prompt.flow.selfcalibration.js).
 *   Kept as fallback for older runtimes that don't support UserPromptSubmit.
 *   The UserPromptSubmit variant fires right before Claude processes the first
 *   user message, giving the instructions higher priority.
 */

require('../lib/plugin-guard');

const fs   = require('fs');
const path = require('path');
const { runOnce } = require('../lib/run-once');
const { sessionFile } = require('../lib/session-id');

const PLUGIN_DIR  = path.resolve(__dirname, '..', '..');
const TASKS_DIR   = path.join(PLUGIN_DIR, 'scheduled-tasks');

// Stable base path for version-agnostic discovery.
// The cache may be rebuilt mid-session by ss.plugin.update, which deletes the
// old versioned dir. Baking __dirname into the cron prompt would point to a
// deleted path. Instead, we emit a glob pattern so Claude can resolve the
// latest cache at cron fire time.
const home = process.env.HOME || process.env.USERPROFILE || '';
const PLUGIN_GLOB_BASE = path.join(home, '.claude', 'plugins', 'cache').replace(/\\/g, '/');

const FLAG_PREFIX = 'dotclaude-devops-user-active';

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

    // Resolved path for immediate execution (known to exist right now).
    const resolvedSkillPath = skillPath.replace(/\\/g, '/');

    // For cron: version may change mid-session, so emit the parent dir
    // and let Claude list + pick the version (more reliable than glob on Windows).
    let cronDiscoveryDir;
    if (inCache) {
      const rel = normalizedPluginDir.slice(normalizedCacheBase.length + 1);
      const parts = rel.split('/'); // ["dotclaude", "devops", "0.35.2"]
      cronDiscoveryDir = `${normalizedCacheBase}/${parts[0]}/${parts[1]}`;
    } else {
      cronDiscoveryDir = null; // dev path is stable
    }
    tasks.push({ ...task, resolvedSkillPath, cronDiscoveryDir });
  }

  if (tasks.length === 0) process.exit(0);

  // Set the initial user-active flag so the first immediate execution runs.
  const flagPath = sessionFile(FLAG_PREFIX, sessionId).replace(/\\/g, '/');
  try {
    fs.writeFileSync(sessionFile(FLAG_PREFIX, sessionId), String(Date.now()), 'utf8');
  } catch {}

  const lines = [
    'BLOCKING — execute BEFORE responding to the user message:',
    '',
  ];

  for (const t of tasks) {
    const idleGuard = `IDLE GUARD: First, run Bash to check if the file "${flagPath}" exists (test -f "${flagPath}"). If it does NOT exist, output nothing and stop — do NOT proceed with the task. If it DOES exist, delete it (rm "${flagPath}") and continue.`;

    const cronPrompt = t.cronDiscoveryDir
      ? `${idleGuard} Execute the ${t.id} scheduled task as defined in the plugin. List the directory ${t.cronDiscoveryDir} to find the current version, then Read {version}/scheduled-tasks/${t.id}/SKILL.md — use the match to derive the plugin root (parent of scheduled-tasks/).`
      : `${idleGuard} Execute the ${t.id} scheduled task as defined in the plugin. Read ${t.resolvedSkillPath} — use the file's parent of scheduled-tasks/ as the plugin root.`;
    lines.push(
      `Register cron via CronCreate: cron="${t.cron}", recurring=${t.recurring}, prompt="${cronPrompt}"`,
      `Then immediately execute it once: Read ${t.resolvedSkillPath} and run Step 0 (Completion Flow Internalization).`,
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
});
