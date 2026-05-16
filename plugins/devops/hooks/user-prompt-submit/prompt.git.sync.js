#!/usr/bin/env node
/**
 * @hook prompt.git.sync
 * @version 0.3.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Throttled git sync on user prompt — delegates to scripts/git-sync.js.
 *   Complements the session-start cron (ss.git.sync) with immediate sync
 *   on user interaction. Throttled to 15 minutes to avoid overlap with cron.
 */

require('../lib/plugin-guard');

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Returns true if cwd is inside a git work tree.
 * @param {string} cwd
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

const THROTTLE_FILE = path.join(os.tmpdir(), `dotclaude-devops-git-sync-${process.ppid}`);
const THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

// Throttle — skip if last sync was recent
try {
  if (fs.existsSync(THROTTLE_FILE)) {
    const lastSync = parseInt(fs.readFileSync(THROTTLE_FILE, 'utf8'), 10);
    const ageMs = Date.now() - lastSync;
    if (ageMs < THROTTLE_MS) {
      const ageMin = Math.round(ageMs / 60000);
      const remainMin = Math.ceil((THROTTLE_MS - ageMs) / 60000);
      process.stderr.write(`[prompt.git.sync] ✓ skipped (throttled, last sync ${ageMin}m ago, retry in ${remainMin}m)\n`);
      process.exit(0);
    }
  }
} catch {}

// Update throttle timestamp immediately
try { fs.writeFileSync(THROTTLE_FILE, Date.now().toString()); } catch {}

// Guard: skip in non-git directories
if (!isGitRepo(process.cwd())) {
  process.exit(0);
}

// Delegate to shared sync script
const scriptPath = path.resolve(__dirname, '../../scripts/git-sync.js');
try {
  const output = execSync(`node "${scriptPath}"`, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (output.trim()) {
    process.stderr.write(output);
  }
} catch (err) {
  if (err.stdout && err.stdout.trim()) {
    process.stderr.write(err.stdout);
  }
}
