#!/usr/bin/env node
/**
 * @hook prompt.issue.detect
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin dotclaude-dev-ops
 * @description Detect issue references in user messages. If explicit (#N or
 *   "Issue N"), instruct Claude to set it to In Progress on GitHub. If implicit
 *   (branch name pattern like feat/42-*), ask the user for confirmation first.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TRACKED_FILE = path.join(os.tmpdir(), `dotclaude-devops-tracked-issues-${process.ppid}`);

// Read hook input from stdin (contains user's message)
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const message = hook.user_message || hook.message || '';
  if (!message) process.exit(0);

  // Pattern 1: Explicit issue reference — #42, Issue #42, Issue 42, "mach Issue #42"
  const explicitMatch = message.match(/#(\d+)/g) || message.match(/\bIssue\s+(\d+)/gi);
  // Pattern 2: Branch name in message — feat/42-something
  const branchMatch = message.match(/\b(?:feat|fix|chore|docs)\/(\d+)[-/]/i);

  let issueNumbers = [];

  if (explicitMatch) {
    // Extract numbers from #N patterns
    issueNumbers = [...new Set(
      (message.match(/#(\d+)/g) || []).map(m => m.replace('#', ''))
    )];
  }

  if (issueNumbers.length === 0 && branchMatch) {
    issueNumbers = [branchMatch[1]];
  }

  // Also check current git branch for implicit issue reference
  if (issueNumbers.length === 0) {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const branchIssue = branch.match(/^(?:feat|fix|chore|docs)\/(\d+)[-/]/);
      if (branchIssue) {
        issueNumbers = [branchIssue[1]];
      }
    } catch {}
  }

  if (issueNumbers.length === 0) {
    process.exit(0);
  }

  // Load already tracked issues (avoid duplicate prompts)
  let tracked = [];
  try {
    tracked = JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
  } catch { tracked = []; }

  const newIssues = issueNumbers.filter(n => !tracked.includes(n));
  if (newIssues.length === 0) {
    process.exit(0);
  }

  // Determine if explicit or implicit
  const isExplicit = explicitMatch && explicitMatch.length > 0;
  const issueList = newIssues.map(n => `#${n}`).join(', ');

  if (isExplicit) {
    // Explicit mention — instruct Claude to set In Progress immediately
    process.stdout.write(
      `User explicitly referenced issue ${issueList}. ` +
      `Set ${issueList} to "In Progress" on the GitHub project board ` +
      `(use the GitHub API). Track this issue for the session — ` +
      `when work is complete, update status to "Done" in the completion flow.\n`
    );
  } else {
    // Implicit (branch name) — ask user for confirmation
    process.stdout.write(
      `Current branch references issue ${issueList}. ` +
      `Ask the user: "Arbeitest du an Issue ${issueList}?" ` +
      `If confirmed, set to "In Progress" on the project board. ` +
      `If declined, do not track.\n`
    );
  }

  // Save tracked issues
  tracked.push(...newIssues);
  try { fs.writeFileSync(TRACKED_FILE, JSON.stringify(tracked)); } catch {}
});
