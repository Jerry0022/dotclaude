#!/usr/bin/env node
/**
 * @hook stop.flow.selfcalibration
 * @version 1.0.0
 * @event Stop
 * @plugin devops
 * @description Run self-calibration when Claude finishes a response turn.
 *   Only fires if >10 minutes have passed since the last calibration in
 *   the current worktree. Replaces the cron-based approach (v0.7.0) to
 *   ensure calibration only runs after real user interaction, never idle.
 *
 *   Worktree-specific: timestamp is keyed to process.cwd(), so parallel
 *   worktrees have independent cooldowns.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PLUGIN_DIR = path.resolve(__dirname, '..', '..');
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function worktreeKey() {
  const cwd = process.cwd().replace(/\\/g, '/');
  return crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
}

function lastRunFile() {
  return path.join(os.tmpdir(), `dotclaude-devops-calibration-wt-${worktreeKey()}`);
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  const file = lastRunFile();

  // Check worktree-specific cooldown
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < COOLDOWN_MS) {
      process.exit(0); // Cooldown active
    }
  } catch {
    // File doesn't exist — first run in this worktree
  }

  // Find SKILL.md
  const skillPath = path.join(PLUGIN_DIR, 'scheduled-tasks', 'self-calibration', 'SKILL.md');
  try {
    fs.readFileSync(skillPath, 'utf8');
  } catch {
    process.exit(0); // No skill file
  }

  // Update timestamp before emitting (prevents double-fire)
  try {
    fs.writeFileSync(file, String(Date.now()), 'utf8');
  } catch {}

  const resolvedPath = skillPath.replace(/\\/g, '/');
  process.stdout.write(
    `Execute self-calibration: Read ${resolvedPath} and run Step 0 (Completion Flow Internalization). ` +
    `Use the file's parent of scheduled-tasks/ as the plugin root.\n`
  );
});
