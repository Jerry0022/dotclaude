#!/usr/bin/env node
/**
 * @hook prompt.flow.selfcalibration
 * @version 0.7.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Register the self-calibration cron task once per session.
 *   Moved from SessionStart to UserPromptSubmit so the instruction is injected
 *   directly before Claude processes the first user message — giving it higher
 *   priority than SessionStart system-reminders, which Claude may deprioritize
 *   in favor of the user's task.
 *
 *   SINGLE REGISTRATION POINT (v0.7.0): This is now the ONLY hook that
 *   registers the cron. The SessionStart variant (ss.flow.selfcalibration.js)
 *   is disabled (no-op). This eliminates the double-registration bug where
 *   both hooks used different runOnce keys and both fired.
 *
 *   SHARED GUARD KEY (v0.7.0): Uses a single runOnce key
 *   'flow-selfcalibration' (no ss-/prompt- prefix) so even if the old
 *   SessionStart hook is somehow re-enabled, it can't run alongside this one.
 *
 *   If the task is not yet registered (CronList is empty for this task),
 *   also execute it immediately — no waiting for the first 10-minute tick.
 *   If the task already exists in CronList, skip everything (no duplicate
 *   registration, no immediate run).
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

  // Once-per-session guard — only inject on the very first user prompt.
  // Uses a shared key (no ss-/prompt- prefix) so both SessionStart and
  // UserPromptSubmit variants share the same guard — prevents double-fire.
  if (!runOnce('flow-selfcalibration', sessionId)) process.exit(0);

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
  // Subsequent flags are set by prompt.flow.useractivity.js on every user prompt.
  const flagPath = sessionFile(FLAG_PREFIX, sessionId).replace(/\\/g, '/');
  try {
    fs.writeFileSync(sessionFile(FLAG_PREFIX, sessionId), String(Date.now()), 'utf8');
  } catch {}

  const lines = [
    'BLOCKING — execute BEFORE responding to the user message:',
    '',
  ];

  // Cooldown marker: prevents multiple cron fires within the same 10-min window.
  // The cron writes this after each successful run; next fire checks age.
  const cooldownPath = sessionFile('dotclaude-devops-calibration-lastrun', sessionId).replace(/\\/g, '/');

  for (const t of tasks) {
    // Idle guard: check the session-scoped flag file before running the task.
    // If no user prompt arrived since the last cycle, skip entirely.
    // Cooldown guard: even if the flag exists, skip if last run was <8 minutes ago
    // (provides buffer below the 10-min cron interval to prevent overlapping runs).
    const idleGuard = `IDLE GUARD: Run Bash with this script: FLAG="${flagPath}"; COOL="${cooldownPath}"; if [ ! -f "$FLAG" ]; then echo "SKIP"; exit 0; fi; if [ -f "$COOL" ]; then LAST=$(cat "$COOL"); NOW=$(date +%s); DIFF=$((NOW - LAST)); if [ "$DIFF" -lt 480 ]; then echo "COOLDOWN"; exit 0; fi; fi; rm -f "$FLAG"; echo "$NOW" > "$COOL"; echo "RUN". — If output is SKIP or COOLDOWN, output nothing and stop. If output is RUN, continue with the task.`;

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
