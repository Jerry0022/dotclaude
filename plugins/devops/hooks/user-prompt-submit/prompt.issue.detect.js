#!/usr/bin/env node
/**
 * @hook prompt.issue.detect
 * @version 0.5.1
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect issue references in user messages. Only a request to
 *   work on an issue is tracked and set In Progress: a work verb before the
 *   number ("fix #12", "arbeite an #12", "mach Issue #12 fertig"), a German
 *   infinitive after it ("#12 bitte umsetzen") or the number opening the
 *   prompt ("#12", "Issue #12: …"). A number only mentioned in prose, a
 *   branch named in the message and the current branch (feat/42-*) are asked
 *   about first. Numbers in quotes, code, brackets, pasted log lines or a
 *   list of 3+ are no reference at all, nor is a hex colour (`#7d84a8`,
 *   `color:#123456`, `#000080`) (lib/issue-refs.js) — a task-chip
 *   prompt that quoted "[issue-status] Tracked issues this session: #530, …"
 *   as an example put four unrelated issues on the In Progress → Done/Todo +
 *   comment track (2026-09-26).
 *   On the first prompt of a session with no reference, instruct Claude to
 *   call the match_issues MCP tool for heuristic matching.
 */

require('../lib/plugin-guard');

const { execSync } = require('child_process');
const fs = require('fs');
const { sessionFile, writeSessionFile } = require('../lib/session-id');
const { issueRefs } = require('../lib/issue-refs');

const BRANCH_ISSUE_RE = /\b(?:feat|fix|chore|docs)\/(\d+)[-/]/i;

function readList(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Read hook input from stdin (contains user's message)
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // A collected prompt produces no turn — recording a tracked issue or fixing
  // the session locale from it would stick while the payload goes nowhere.
  try { if (require('../lib/batch-state').willBeCollected(hook)) process.exit(0); }
  catch { /* fail open */ }

  const message = hook.prompt || hook.user_message || hook.message || '';
  if (!message) process.exit(0);
  // Background agent reports quote issue and PR numbers; the user referenced
  // none of them (#473). Machine turns also must not consume the first-prompt
  // heuristic.
  if (require('../lib/non-user-prompt').isNonUserPrompt(message)) process.exit(0);

  // A request to work on an issue is tracked; a number only mentioned is
  // asked about. Quoted examples, code, brackets, pasted log lines and lists
  // of 3+ are neither.
  const refs = issueRefs(message);
  const trackNumbers = refs.track;
  let askNumbers = refs.ask;
  let askSource = 'mention';

  // Branch name in message — feat/42-something
  if (trackNumbers.length === 0 && askNumbers.length === 0) {
    const branchMatch = message.match(BRANCH_ISSUE_RE);
    if (branchMatch) {
      askNumbers = [branchMatch[1]];
      askSource = 'branch';
    }
  }

  // Also check current git branch for implicit issue reference
  if (trackNumbers.length === 0 && askNumbers.length === 0) {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const branchIssue = branch.match(/^(?:feat|fix|chore|docs)\/(\d+)[-/]/);
      if (branchIssue) {
        askNumbers = [branchIssue[1]];
        askSource = 'branch';
      }
    } catch {}
  }

  // No issue reference found — try heuristic matching on the FIRST prompt of
  // this session only.
  if (trackNumbers.length === 0 && askNumbers.length === 0) {
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

    return;
  }

  // Already tracked issues are never tracked or asked about again
  const trackedFile = sessionFile('dotclaude-devops-tracked-issues', hook.session_id);
  const tracked = readList(trackedFile);

  if (trackNumbers.length > 0) {
    const newIssues = trackNumbers.filter(n => !tracked.includes(n));
    if (newIssues.length === 0) return;

    // A request to work on it — persist immediately and instruct Claude
    tracked.push(...newIssues);
    try { writeSessionFile(trackedFile, JSON.stringify(tracked)); } catch {}

    const issueList = newIssues.map(n => `#${n}`).join(', ');
    process.stdout.write(
      `User asked to work on issue ${issueList}. ` +
      `Set ${issueList} to "In Progress" on the GitHub project board ` +
      `(use the GitHub API). Track this issue for the session — ` +
      `when work is complete, update status to "Done" in the completion flow.\n`
    );
    return;
  }

  // Mentioned or implied by a branch — ask the user first, do NOT persist as
  // tracked. A separate "asked" marker prevents re-prompting.
  const askedFile = sessionFile('dotclaude-devops-asked-issues', hook.session_id);
  const asked = readList(askedFile);
  const unasked = askNumbers.filter(n => !tracked.includes(n) && !asked.includes(n));
  if (unasked.length === 0) return;

  asked.push(...unasked);
  try { writeSessionFile(askedFile, JSON.stringify(asked)); } catch { /* the question still goes out */ }

  const unaskedList = unasked.map(n => `#${n}`).join(', ');
  const lead = askSource === 'mention'
    ? `The prompt mentions issue ${unaskedList} but does not ask to work on it.`
    : `Current branch references issue ${unaskedList}.`;
  process.stdout.write(
    `${lead} ` +
    `Ask the user: "Arbeitest du an Issue ${unaskedList}?" ` +
    `If confirmed, set to "In Progress" on the project board and, when the ` +
    `work is complete, update it like a tracked issue in the completion flow. ` +
    `If declined, do not track and do not ask again.\n`
  );
});
