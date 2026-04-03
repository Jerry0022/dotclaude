#!/usr/bin/env node
/**
 * @hook prompt.issue.detect
 * @version 0.3.0
 * @event UserPromptSubmit
 * @plugin dotclaude-dev-ops
 * @description Detect issue references in user messages. If explicit (#N or
 *   "Issue N"), instruct Claude to set it to In Progress on GitHub. If implicit
 *   (branch name pattern like feat/42-*), ask the user for confirmation first.
 *   On the first prompt of a session with no explicit/implicit match, instruct
 *   Claude to call the match_issues MCP tool for heuristic matching.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const { sessionFile, writeSessionFile } = require('../lib/session-id');

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

  // No explicit or implicit issue number found — try heuristic matching
  // on the FIRST prompt of this session only.
  if (issueNumbers.length === 0) {
    const heuristicFile = sessionFile('dotclaude-devops-heuristic-done', hook.session_id);
    let heuristicDone = false;
    try { heuristicDone = fs.existsSync(heuristicFile); } catch {}

    if (!heuristicDone) {
      // Mark heuristic as done for this session
      try { writeSessionFile(heuristicFile, '1'); } catch {}

      // Instruct Claude to call the match_issues MCP tool
      process.stdout.write(
        `No explicit issue reference found in user message. ` +
        `This is the first prompt of this session — call the match_issues ` +
        `MCP tool with the user's message as query to find potentially ` +
        `related open issues. If a match with high confidence is found, ` +
        `ask the user: "Arbeitest du an Issue #N (Title)?" ` +
        `If confirmed, set to "In Progress" on the project board. ` +
        `If no match or low confidence, proceed without issue context.\n`
      );
    }

    process.exit(0);
  }

  // Load already tracked issues (avoid duplicate prompts)
  const trackedFile = sessionFile('dotclaude-devops-tracked-issues', hook.session_id);
  let tracked = [];
  try {
    tracked = JSON.parse(fs.readFileSync(trackedFile, 'utf8'));
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
  try { writeSessionFile(trackedFile, JSON.stringify(tracked)); } catch {}
});
