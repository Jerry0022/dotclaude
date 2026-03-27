#!/usr/bin/env node
/**
 * @hook ss.branches.check
 * @version 0.1.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Check for uncommitted/unpushed changes at session start.
 *   Silent when clean. Outputs a Claude prompt only when issues are found.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function checkRepo(dir) {
  const issues = [];

  const status = run('git status --porcelain', dir);
  if (status) {
    const lines = status.split('\n').filter(Boolean);
    issues.push(`${lines.length} uncommitted file(s)`);
  }

  const unpushed = run('git log --branches --not --remotes --oneline', dir);
  if (unpushed) {
    const lines = unpushed.split('\n').filter(Boolean);
    issues.push(`${lines.length} unpushed commit(s)`);
  }

  const stashes = run('git stash list', dir);
  if (stashes) {
    const lines = stashes.split('\n').filter(Boolean);
    issues.push(`${lines.length} stash entr${lines.length === 1 ? 'y' : 'ies'}`);
  }

  return issues;
}

// Determine repos to check
const cwd = process.cwd();
const repos = [{ label: 'current repo', dir: cwd }];

// Optional additional repos from reference.md
const refPath = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude', 'scheduled-tasks', 'stale-changes-check', 'reference.md'
);
if (fs.existsSync(refPath)) {
  const content = fs.readFileSync(refPath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(/^-\s+(.+)/);
    if (!m) continue;
    const raw = m[1].trim().replace(/^~/, process.env.HOME || process.env.USERPROFILE || '~');
    const resolved = path.resolve(raw);
    if (resolved !== cwd && fs.existsSync(resolved)) {
      repos.push({ label: path.basename(resolved), dir: resolved });
    }
  }
}

// Collect issues
const dirty = [];
for (const repo of repos) {
  const issues = checkRepo(repo.dir);
  if (issues.length > 0) {
    dirty.push({ label: repo.label, issues });
  }
}

if (dirty.length === 0) {
  // Silent exit — everything clean
  process.exit(0);
}

// Build a brief prompt for Claude to relay to the user
const lines = ['Stale changes found at session start. Inform the user briefly:'];
for (const r of dirty) {
  lines.push(`- ${r.label}: ${r.issues.join(', ')}`);
}
lines.push('One short paragraph, no full audit, just the warning.');

process.stdout.write(lines.join('\n') + '\n');
