#!/usr/bin/env node
/**
 * @hook prompt.git.sync
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin dotclaude-dev-ops
 * @description Periodic git pull/merge on user prompt — keeps the branch
 *   up-to-date with main during long sessions. Throttled to run at most
 *   every 15 minutes to avoid slowing down every prompt.
 *   Uses the same logic as ss.git.sync (SessionStart), but non-blocking.
 */

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

const cwd = process.cwd();
const MAIN = 'main';

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// Only run in a git repo
if (git('rev-parse --is-inside-work-tree') !== 'true') {
  process.exit(0);
}

const remote = git('remote');
if (!remote) process.exit(0);
const origin = remote.split('\n')[0];

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch || branch === MAIN) process.exit(0); // On main — SessionStart handles this

// Fetch main quietly
if (git(`fetch ${origin} ${MAIN} --quiet`) === null) {
  process.exit(0);
}

// Update local main ref
git(`fetch ${origin} ${MAIN}:${MAIN} --quiet`);

// Check if main has new commits not in current branch
const behind = git(`rev-list --count HEAD..${MAIN}`);
if (!behind || parseInt(behind) === 0) {
  process.exit(0); // Already up to date
}

// Merge main into current branch
const mergeResult = git(`merge ${MAIN} --no-edit --quiet`);
if (mergeResult === null) {
  git('merge --abort');
  process.stderr.write(
    `[prompt.git.sync] Merge-Konflikt beim Mergen von ${MAIN} in ${branch}. Bitte manuell lösen.\n`
  );
} else {
  process.stderr.write(
    `[prompt.git.sync] ${behind} commit(s) von ${MAIN} in ${branch} gemergt.\n`
  );
}
