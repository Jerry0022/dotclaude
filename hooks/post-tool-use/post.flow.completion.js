#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.8.0
 * @event PostToolUse
 * @plugin dotclaude-dev-ops
 * @description After EVERY tool call: inject the completion-card reminder so
 *   Claude always has the instruction in context when it finishes — regardless
 *   of whether the last tool was Edit, Read, Bash, Grep, or anything else.
 *   Edit/Write calls additionally increment the session edit counter.
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

  // --- 2. Emit completion-card instruction (deterministic script) ---
  const pluginRoot = path.resolve(__dirname, '..');
  const scriptPath = path.join(pluginRoot, 'scripts', 'render-card.js').replace(/\\/g, '/');

  const lines = [];

  if (isCodeEdit) {
    lines.push(`[completion-flow] Code edit #${editCount} recorded (${toolName}).`);
  } else {
    lines.push(`[completion-flow] Tool call recorded (${toolName}).`);
  }

  lines.push(
    '',
    'When you have finished ALL work for this task, render the completion card by piping JSON to the render script.',
    'Do NOT render the card yourself — the script produces it deterministically.',
    '',
    'STEP 1: Choose variant:',
    '  if   ship succeeded                 → "shipped"',
    '  elif build/gate/merge failed        → "blocked"',
    '  elif task aborted or not feasible   → "aborted"',
    '  elif code edits + app relevant      → "test"',
    '  elif app started, no code edits     → "minimal-start"',
    '  elif code/doc changes, no app       → "ready"',
    '  elif research/review/explanation    → "research"',
    '  else                                → "fallback"',
    '',
    'STEP 2: Run via Bash tool:',
    `  echo '<JSON>' | node ${scriptPath}`,
    '',
    'JSON schema:',
    '  {',
    '    "variant": "ready|shipped|blocked|test|minimal-start|research|aborted|fallback",',
    '    "summary": "max ~10 words, user language",',
    '    "lang": "de",',
    '    "changes": [{"area":"x","description":"y"}],     // max 3, omit if none',
    '    "tests": [{"method":"x","result":"y"}],           // max 3, omit if none',
    '    "state": {                                         // omit for minimal-start',
    '      "branch": "feat/xyz", "worktree": false,',
    '      "commit": "abc1234", "pushed": true,',
    '      "pr": {"number":42,"title":"Title"}, "merged": "remote/main",',
    '      "appStatus": "running|not-started|null"',
    '    },',
    '    "cta": {"info":"PR #42 ready","reason":"lint fails","vOld":"1.2.0","vNew":"1.3.0","bump":"minor","version":"1.3.0","description":"Website opens"},',
    '    "userTest": ["Step 1","Step 2"]                   // only for test variant',
    '  }',
    '',
    'STEP 3: Output the script result VERBATIM. Nothing before, nothing after.',
    'The card is always the LAST thing in your response. No text after closing ---.',
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
