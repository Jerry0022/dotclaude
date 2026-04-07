#!/usr/bin/env node
/**
 * @hook ss.team.changelog
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Show a summary of changes made by other contributors on remote main
 *   since the user's last commit. Only triggers when the latest commit on
 *   origin/<main> is NOT by the current git user. Silent otherwise.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim();
  } catch {
    return '';
  }
}

const cwd = process.cwd();

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

// Structured git log: hash · author · email · ISO date · subject
// Uses %x1f (unit separator) to avoid conflicts with commit message content
const rawLog = run(
  `git log origin/${mainBranch} --format="%H%x1f%an%x1f%ae%x1f%ai%x1f%s" -50`,
  cwd,
);
if (!rawLog) process.exit(0);

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

/** Match commit author against local git identity. */
function isMe(commit) {
  if (userEmail && commit.email === userEmail) return true;
  if (userName && commit.name.toLowerCase() === userName) return true;
  // Cross-match GitHub noreply username against git user.name
  const commitGhUser = ghUsernameFromEmail(commit.email);
  if (commitGhUser && commitGhUser === userName) return true;
  const myGhUser = ghUsernameFromEmail(userEmail);
  if (myGhUser && myGhUser === commit.name.toLowerCase()) return true;
  if (myGhUser && commitGhUser && myGhUser === commitGhUser) return true;
  return false;
}

// If the latest commit is by the user — nothing to show
if (commits.length === 0 || isMe(commits[0])) process.exit(0);

// Collect commits by others until we hit one by the user
const otherCommits = [];
for (const commit of commits) {
  if (isMe(commit)) break;
  otherCommits.push(commit);
}
if (otherCommits.length === 0) process.exit(0);

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
