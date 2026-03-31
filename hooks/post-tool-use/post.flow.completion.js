#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.13.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After EVERY tool call: inject the completion-card reminder so
 *   Claude always has the instruction in context when it finishes — regardless
 *   of whether the last tool was Edit, Read, Bash, Grep, or anything else.
 *   Edit/Write calls additionally increment the session edit counter.
 *   Writes a per-turn "work-happened" flag consumed by stop.flow.guard.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { sessionFile, readSessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  const isCodeEdit = (toolName === 'Edit' || toolName === 'Write');

  // --- 1. Increment edit counter (only for Edit/Write) ---
  let editCount = 0;
  const counterFile = sessionFile('dotclaude-devops-edits', hook.session_id);
  try {
    editCount = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
  } catch {}

  if (isCodeEdit) {
    editCount++;
    try { fs.writeFileSync(counterFile, editCount.toString()); } catch {}
  }

  // --- 1b. Write per-turn work-happened flag (consumed by stop.flow.guard) ---
  try {
    const workFile = sessionFile('dotclaude-devops-work-happened', hook.session_id);
    fs.writeFileSync(workFile, toolName);
  } catch {}

  // --- 2. Emit completion-card instruction (MCP tool call) ---

  const lines = [];

  if (isCodeEdit) {
    lines.push(`[completion-flow] Code edit #${editCount} recorded (${toolName}).`);
  } else {
    lines.push(`[completion-flow] Tool call recorded (${toolName}).`);
  }

  lines.push(
    '',
    'COMPLETION CARD — when ALL work is done:',
    'Call `render_completion_card` MCP tool (dotclaude-completion server).',
    `Pass: variant, summary (max ~10 words, user language), lang:"de", session_id:"${hook.session_id || ''}",`,
    '  plus changes, tests, state, cta, userTest as applicable.',
    'Variant: shipped=ship succeeded, blocked=build/gate/merge failed,',
    '  aborted=task aborted, test=code edits+app, minimal-start=app started no edits,',
    '  ready=code/doc changes no app, research=review/explanation, fallback=other.',
    'Output returned markdown VERBATIM — card LAST, nothing after closing ---.',
  );

  if (editCount >= 5) {
    lines.push(
      '',
      `SHIP: ${editCount} code edits this session. Recommend /ship when task is done.`,
    );
  }

  // --- 3. Issue status check — inject instructions if issues are tracked ---
  let trackedIssues = [];
  try {
    const result = readSessionFile('dotclaude-devops-tracked-issues', hook.session_id);
    if (result) {
      trackedIssues = JSON.parse(result.content);
    }
  } catch {}

  if (trackedIssues.length > 0) {
    const issueList = trackedIssues.map(n => `#${n}`).join(', ');
    lines.push(
      '',
      `[issue-status] Tracked issues this session: ${issueList}`,
      'BEFORE rendering the completion card, evaluate each tracked issue:',
      '1. Read the issue body and acceptance criteria from GitHub (gh issue view N)',
      '2. Compare against the changes made in this session',
      '3. For each issue:',
      '   - If ALL acceptance criteria are met → set status to "Done" on the GitHub project board',
      '   - If NOT fully done → set status to "Todo" on the GitHub project board',
      '     AND post a comment on the issue summarizing:',
      '     • What was completed in this session',
      '     • What remains open',
      'Do this silently — no extra output to the user, just the API calls.',
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
});
