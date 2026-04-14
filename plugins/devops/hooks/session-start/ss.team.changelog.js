#!/usr/bin/env node
/**
 * @hook ss.team.changelog
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description Show a summary of changes made by other contributors on remote main
 *   since the last time this hook displayed output. Persists the "last shown"
 *   timestamp to a worktree-independent file in OS temp (keyed by repo remote URL).
 *   Only triggers when the latest commit on origin/<main> is NOT by the current
 *   git user. Silent otherwise.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');

function run(cmd, cwd, timeout = 15000) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout }).trim();
  } catch {
    return '';
  }
}

const cwd = process.cwd();

// --- Persistent "last shown" timestamp (worktree-independent) ---
const remoteUrl = run('git remote get-url origin', cwd);
const repoRoot = run('git rev-parse --show-toplevel', cwd);
const repoKey = crypto.createHash('md5').update(remoteUrl || repoRoot || cwd).digest('hex').slice(0, 12);
const tsFile = path.join(os.tmpdir(), `dotclaude-team-changelog-${repoKey}`);

function readLastShown() {
  try {
    const iso = fs.readFileSync(tsFile, 'utf8').trim();
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function writeLastShown() {
  try {
    const tmp = tsFile + '.tmp';
    fs.writeFileSync(tmp, new Date().toISOString(), 'utf8');
    fs.renameSync(tmp, tsFile);
  } catch { /* best effort */ }
}

const lastShown = readLastShown();

// Detect main branch from remote HEAD
const mainBranch = (
  run('git symbolic-ref refs/remotes/origin/HEAD', cwd)
    .replace('refs/remotes/origin/', '') || 'main'
);

// Fetch latest remote state (only the main branch, quiet)
if (!run(`git fetch origin ${mainBranch} --quiet`, cwd) && run(`git fetch origin ${mainBranch}`, cwd) === '') {
  // fetch may return empty on success — continue regardless
}

// Get local user identity
const userName = run('git config user.name', cwd).toLowerCase();
const userEmail = run('git config user.email', cwd).toLowerCase();

if (!userName && !userEmail) process.exit(0);

// Resolve authenticated GitHub login (authoritative identity source).
// gh api is network-bound — keep timeout short; falls back gracefully.
const ghLogin = (
  run('gh api user --jq .login', cwd, 5000) ||
  run('git config github.user', cwd)
).toLowerCase();

// Structured git log: hash · author · email · ISO date · subject
// Uses %x1f (unit separator) to avoid conflicts with commit message content
// When we have a prior "last shown" timestamp, restrict to commits since then
// and drop the -50 cap (the time window is the natural limit).
// Without a timestamp, keep -50 as safety cap for the first run.
const sinceArg = lastShown ? ` --since="${lastShown.toISOString()}"` : ' -50';
const rawLog = run(
  `git log origin/${mainBranch} --format="%H%x1f%an%x1f%ae%x1f%ai%x1f%s"${sinceArg}`,
  cwd,
);
if (!rawLog) {
  writeLastShown();
  process.exit(0);
}

const commits = rawLog.split('\n').filter(Boolean).map(line => {
  const parts = line.split('\x1f');
  return {
    hash: parts[0],
    name: parts[1] || '',
    email: (parts[2] || '').toLowerCase(),
    date: parts[3] || '',
    subject: parts.slice(4).join('\x1f'),
  };
});

/**
 * Extract GitHub username from a noreply email address.
 * Handles both old (<user>@users.noreply.github.com) and
 * new (<id>+<user>@users.noreply.github.com) formats.
 */
function ghUsernameFromEmail(email) {
  const m = email.match(/^(?:\d+\+)?(.+)@users\.noreply\.github\.com$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Match commit author against local git identity + authenticated GitHub login. */
function isMe(commit) {
  const commitName = commit.name.toLowerCase();
  const commitGhUser = ghUsernameFromEmail(commit.email);
  const myGhUser = ghUsernameFromEmail(userEmail);

  // 1. Direct email match
  if (userEmail && commit.email === userEmail) return true;
  // 2. Direct name match
  if (userName && commitName === userName) return true;
  // 3. Authenticated GitHub login (authoritative — covers noreply emails,
  //    web UI commits, and any name/email mismatch)
  if (ghLogin) {
    if (commitName === ghLogin) return true;
    if (commitGhUser && commitGhUser === ghLogin) return true;
  }
  // 4. Cross-match noreply username ↔ git user.name/email
  if (commitGhUser && commitGhUser === userName) return true;
  if (myGhUser && myGhUser === commitName) return true;
  if (myGhUser && commitGhUser && myGhUser === commitGhUser) return true;
  return false;
}

// If the latest commit is by the user — nothing to show
if (commits.length === 0 || isMe(commits[0])) {
  writeLastShown();
  process.exit(0);
}

// Collect commits by others until we hit one by the user
const otherCommits = [];
for (const commit of commits) {
  if (isMe(commit)) break;
  otherCommits.push(commit);
}
if (otherCommits.length === 0) {
  writeLastShown();
  process.exit(0);
}

// Group by author (preserve insertion order)
const byAuthor = new Map();
for (const c of otherCommits) {
  if (!byAuthor.has(c.name)) byAuthor.set(c.name, []);
  byAuthor.get(c.name).push(c);
}

// Date formatting helpers
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateRange(list) {
  const dates = list.map(c => new Date(c.date).getTime());
  const min = fmtDate(new Date(Math.min(...dates)).toISOString());
  const max = fmtDate(new Date(Math.max(...dates)).toISOString());
  return min === max ? min : `${min} – ${max}`;
}

// Build output
const overall = dateRange(otherCommits);
const out = [
  `Team changes landed on \`${mainBranch}\` while you were away. Show the user this summary as-is:`,
  '',
  '---',
  `**Team changes on \`${mainBranch}\`** · ${overall}`,
  '---',
  '',
];

for (const [author, authorCommits] of byAuthor) {
  out.push(`**${author}** · ${dateRange(authorCommits)}`);
  for (const c of authorCommits) {
    out.push(`- ${c.subject}`);
  }
  out.push('');
}

out.push('---');

process.stdout.write(out.join('\n'));

// Persist "last shown" so the next session only shows newer commits
writeLastShown();
