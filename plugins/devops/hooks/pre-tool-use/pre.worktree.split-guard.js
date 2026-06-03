#!/usr/bin/env node
/**
 * @hook pre.worktree.split-guard
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash
 * @description WARN (never block) on git-mutating work driven from the main
 *   repo root while an agent session worktree is active.
 *
 *   The split-state bug: an agent session has an isolated worktree at
 *   `.claude/worktrees/<name>`, but git-mutating commands (and later the ship
 *   pipeline) are run from the MAIN repo root instead of inside the worktree.
 *   The branch/commits land on the main repo and can ship+merge fine — but the
 *   session worktree is never inspected and is left dirty, so the harness later
 *   warns "Archive session with N uncommitted changes". This hook nudges the
 *   user toward the worktree before that limbo state is created.
 *
 *   Fires ONLY in that exact split-state:
 *     - cwd is the MAIN working tree (NOT a linked worktree)
 *     - the command is git commit / git checkout -b / git merge
 *     - at least one `.claude/worktrees/*` session worktree is active
 *
 *   Always exits 0 (warn-only). Bypass conditions (→ silent exit 0):
 *     - Not inside a git repo
 *     - cwd IS a linked worktree (the intended place to work)
 *     - Ship sentinel active (ship legitimately mutates from main)
 *     - No session worktree present
 */

require('../lib/plugin-guard');

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { isActive: sentinelActive } = require('../lib/ship-sentinel');

// Mutating commands that create the limbo state when run from the main root.
// Conservative set per spec: commit, checkout -b, merge.
const SPLIT_PATTERNS = [
  /^\s*git\s+commit(\s|$)/,
  /^\s*git\s+merge(\s|$)/,
  /^\s*git\s+checkout\s+-b(\s|$)/,
  /^\s*git\s+checkout\s+-B(\s|$)/,
  /^\s*git\s+switch\s+-c(\s|$)/,
  /^\s*git\s+switch\s+-C(\s|$)/,
];

const SESSION_WORKTREE_MARKER = '/.claude/worktrees/';

function gitOut(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(cwd) {
  return gitOut(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

// True when cwd is a LINKED worktree (git-dir != git-common-dir).
function isLinkedWorktree(cwd) {
  const gitDir = gitOut(['rev-parse', '--git-dir'], cwd);
  const commonDir = gitOut(['rev-parse', '--git-common-dir'], cwd);
  if (!gitDir || !commonDir) return false;
  return path.resolve(cwd, gitDir) !== path.resolve(cwd, commonDir);
}

// List active session worktree paths (under .claude/worktrees/), normalized.
// `git worktree list --porcelain` emits forward-slash paths on all platforms.
function activeSessionWorktrees(cwd) {
  const out = gitOut(['worktree', 'list', '--porcelain'], cwd);
  if (!out) return [];
  const paths = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      const p = line.slice('worktree '.length).trim().replace(/\\/g, '/');
      if (p.includes(SESSION_WORKTREE_MARKER)) paths.push(p);
    }
  }
  return paths;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  if ((hook.tool_name || '') !== 'Bash') process.exit(0);

  const cmd = (hook.tool_input || {}).command || '';
  if (!cmd) process.exit(0);
  if (!SPLIT_PATTERNS.some(re => re.test(cmd))) process.exit(0);

  const cwd = hook.cwd || process.cwd();

  if (!isGitRepo(cwd)) process.exit(0);
  // Ship runs git from main legitimately — its own gates cover the worktree.
  if (sentinelActive(cwd)) process.exit(0);
  // If we are inside the worktree already, this is exactly where work belongs.
  if (isLinkedWorktree(cwd)) process.exit(0);

  const worktrees = activeSessionWorktrees(cwd);
  if (worktrees.length === 0) process.exit(0);

  const list = worktrees.map(p => `  - ${p}`).join('\n');
  process.stderr.write(
    `[pre.worktree.split-guard] WARNING: git-mutating command in the MAIN repo while a session worktree is active:\n` +
    `${list}\n` +
    `[pre.worktree.split-guard] If this work belongs to the session, run it INSIDE the worktree instead — otherwise the worktree is left dirty and the session shows "uncommitted changes" even though the work shipped from main.\n` +
    `[pre.worktree.split-guard] This is a warning only; the command will proceed.\n`
  );
  process.exit(0);
});
