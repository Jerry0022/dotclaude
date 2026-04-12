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

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const THROTTLE_FILE = path.join(os.tmpdir(), `dotclaude-devops-git-sync-${process.ppid}`);
const THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

// Throttle — skip if last sync was recent
try {
  if (fs.existsSync(THROTTLE_FILE)) {
    const lastSync = parseInt(fs.readFileSync(THROTTLE_FILE, 'utf8'), 10);
    if (Date.now() - lastSync < THROTTLE_MS) {
      process.exit(0);
    }
  }
} catch {}

// Update throttle timestamp immediately
try { fs.writeFileSync(THROTTLE_FILE, Date.now().toString()); } catch {}

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
