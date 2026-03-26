#!/usr/bin/env node
/**
 * @hook ss.git.sync
 * @version 0.1.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Pull main and merge into current branch/worktree. Combines
 *   the old sync-dotclaude.js (plugin sync) and session-pull-merge.sh
 *   (project sync) into one JS hook.
 */

const { execSync } = require('child_process');

const cwd = process.cwd();
const MAIN = 'main';

function git(cmd, opts = {}) {
  try {
    return execSync(`git ${cmd}`, {
      cwd: opts.cwd || cwd,
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// Only run inside a git repo
if (git('rev-parse --is-inside-work-tree') !== 'true') {
  process.exit(0);
}

// Detect remote
const remote = git('remote');
if (!remote) process.exit(0);
const origin = remote.split('\n')[0];

const branch = git('rev-parse --abbrev-ref HEAD');
if (!branch) process.exit(0);

// Fetch main from remote
if (git(`fetch ${origin} ${MAIN} --quiet`) === null) {
  process.stderr.write(`[ss.git.sync] Could not fetch ${origin}/${MAIN}\n`);
  process.exit(0);
}

if (branch === MAIN) {
  // On main — fast-forward pull
  const result = git(`merge ${origin}/${MAIN} --ff-only --quiet`);
  if (result !== null) {
    const behind = git(`rev-list --count HEAD..${origin}/${MAIN}`);
    if (behind && parseInt(behind) > 0) {
      process.stderr.write(`[ss.git.sync] Main updated — ${behind} new commit(s).\n`);
    }
  }
} else {
  // On a feature branch / worktree — update local main ref, then merge
  git(`fetch ${origin} ${MAIN}:${MAIN} --quiet`);

  // Check if main has commits not in current branch
  const behind = git(`rev-list --count HEAD..${MAIN}`);
  if (behind && parseInt(behind) > 0) {
    const mergeResult = git(`merge ${MAIN} --no-edit --quiet`);
    if (mergeResult === null) {
      // Merge conflict — abort and warn
      git('merge --abort');
      process.stderr.write(
        `[ss.git.sync] Merge-Konflikt beim Mergen von ${MAIN} in ${branch}. Bitte manuell lösen.\n`
      );
    } else {
      process.stderr.write(
        `[ss.git.sync] ${behind} commit(s) von ${MAIN} in ${branch} gemergt.\n`
      );
    }
  }
}
