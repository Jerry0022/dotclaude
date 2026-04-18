#!/usr/bin/env node
/**
 * @hook pre.edit.branch
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Edit|Write|NotebookEdit
 * @description Prevent Edit/Write tool calls while HEAD is on local main/master.
 *
 *   Policy: new work always happens on a branch derived from origin/main.
 *   Editing files directly on main is almost always an accident.
 *
 *   Bypass conditions (any one of them → exit 0):
 *     - Not inside a git repo
 *     - HEAD is NOT main/master
 *     - Sentinel file .claude/.ship-in-progress exists (ship pipeline active)
 *     - DEVOPS_ALLOW_MAIN=1 in environment
 *     - Target path is outside the repo working tree (e.g. ~/.claude/**)
 */

require('../lib/plugin-guard');

const path = require('path');
const { execFileSync } = require('node:child_process');
const { isActive: sentinelActive } = require('../lib/ship-sentinel');

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function extractTargetPath(toolName, input) {
  if (!input) return null;
  if (toolName === 'Edit' || toolName === 'Write') return input.file_path || null;
  if (toolName === 'NotebookEdit') return input.notebook_path || null;
  return null;
}

function isInside(repoRoot, target) {
  if (!repoRoot || !target) return false;
  try {
    const rel = path.relative(repoRoot, path.resolve(target));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (!['Edit', 'Write', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const target = extractTargetPath(toolName, hook.tool_input || {});
  if (!target) process.exit(0);

  const cwd = hook.cwd || process.cwd();

  if (process.env.DEVOPS_ALLOW_MAIN === '1') process.exit(0);

  const repoRoot = gitTopLevel(cwd);
  if (!repoRoot) process.exit(0);

  if (!isInside(repoRoot, target)) process.exit(0);

  if (sentinelActive(repoRoot)) process.exit(0);

  const branch = currentBranch(repoRoot);
  if (!branch) process.exit(0);
  if (branch !== 'main' && branch !== 'master') process.exit(0);

  process.stderr.write(
    `BLOCKED: Editing files on local '${branch}' is not allowed.\n` +
    `Rule: New work always happens on a branch derived from origin/${branch}.\n` +
    `Fix: git fetch origin && git switch -c <feat/topic> origin/${branch}  — then retry the edit.\n` +
    `Bypass (only if the user explicitly asked to edit ${branch}): set env DEVOPS_ALLOW_MAIN=1 for this single action.\n`
  );
  process.exit(2);
});
