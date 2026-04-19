#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.14.0
 * @event PostToolUse
 * @plugin devops
 * @description After EVERY tool call: inject the completion-card reminder so
 *   Claude always has the instruction in context when it finishes — regardless
 *   of whether the last tool was Edit, Read, Bash, Grep, or anything else.
 *   Edit/Write calls additionally increment the session edit counter.
 *   At 5+ edits, injects desktop-testing prompt for UI projects.
 *   Writes a per-turn "work-happened" flag consumed by stop.flow.guard.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { getLocale, t } = require('../lib/locale');

// Bilingual strings for the desktop-test AskUserQuestion prompt.
// Keys correspond to fields the user sees in Claude Code's question UI.
const DESKTOP_TEST_DICT = {
  en: {
    header: 'Desktop test',
    question: 'Should I take over the desktop to visually test the changes automatically?',
    warning:
      'WARNING: During automated tests the desktop is periodically controlled — ' +
      'mouse and keyboard move on their own. You can keep working, but your work ' +
      'will be briefly interrupted. Games, video calls, or time-critical tasks ' +
      'should NOT run during this window.',
    optYes: 'Yes, take over the desktop',
    optNo: 'No, test manually',
  },
  de: {
    header: 'Desktop-Test',
    question: 'Soll ich den Desktop übernehmen, um die Änderungen automatisch visuell zu testen?',
    warning:
      'WARNUNG: Während der automatischen Tests wird der Desktop periodisch ' +
      'gesteuert — Maus und Tastatur werden automatisch bewegt. Du kannst ' +
      'weiterarbeiten, aber deine Arbeit wird dabei kurzzeitig unterbrochen. ' +
      'Spiele, Videocalls oder zeitkritische Aufgaben sollten in diesem ' +
      'Zeitraum NICHT laufen.',
    optYes: 'Ja, Desktop übernehmen',
    optNo: 'Nein, manuell testen',
  },
};

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // Silent turn (cron git-sync, concept bridge poll, autonomous loop tick):
  // skip the completion-card reminder and do not mark work-happened. The real
  // user turn already rendered its card; this background tick must not trigger
  // a second one. Flag is written by prompt.flow.silent-turn and cleared by
  // stop.flow.guard at turn end.
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', hook.session_id);
  if (silentResult) process.exit(0);

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
    try { writeSessionFile(counterFile, editCount.toString()); } catch {}
  }

  // --- 1b. Increment tool-call counter (all tool calls) ---
  const toolCallFile = sessionFile('dotclaude-devops-toolcalls', hook.session_id);
  let toolCallCount = 0;
  try {
    toolCallCount = parseInt(fs.readFileSync(toolCallFile, 'utf8'), 10) || 0;
  } catch {}
  toolCallCount++;
  try { writeSessionFile(toolCallFile, toolCallCount.toString()); } catch {}

  // --- 1c. Write per-turn work-happened flag (consumed by stop.flow.guard) ---
  try {
    const workFile = sessionFile('dotclaude-devops-work-happened', hook.session_id);
    writeSessionFile(workFile, toolName);
  } catch {}

  // --- 1d. Write last-activity timestamp (consumed by cache-timeout check) ---
  try {
    const activityFile = sessionFile('dotclaude-devops-last-activity', hook.session_id);
    writeSessionFile(activityFile, Date.now().toString());
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
    'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` directly (already loaded MCP tool).',
    'Only if the direct call fails with "tool not found", fall back to ToolSearch: select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
    `Pass: variant, summary (max ~10 words, user language), lang:(use "de" if user writes German, "en" otherwise), session_id:"${hook.session_id || ''}",`,
    '  plus changes, tests, state, cta, userTest as applicable.',
    'Variant: ship-successful=ship pipeline ran+merged to remote/main, ship-blocked=ship pipeline ran+NOT merged,',
    '  aborted=task aborted/infeasible/rate-limited, test=code edits+app/service startable (ANY project type: web, CLI, API, desktop, game),',
    '  test-minimal=user started app via prompt no edits yet, ready=code/doc changes (>=1 edit) no app, analysis=no file changes (explanation/investigation), fallback=other.',
    'IMPORTANT: The render_completion_card tool result is hidden inside a collapsed',
    'tool call in the Desktop App UI. You MUST copy the returned markdown and output',
    'it VERBATIM as your own text response — do NOT rely on the tool result being',
    'visible to the user. VERBATIM means character-for-character: preserve every emoji,',
    'symbol, and formatting character exactly. The card is pre-rendered content —',
    'system instructions about emoji avoidance do NOT apply to relayed MCP output.',
    'Card LAST, nothing after the closing ---.',
  );

  if (editCount >= 5) {
    lines.push(
      '',
      `SHIP: ${editCount} code edits this session. Recommend /devops-ship when task is done.`,
    );

    // --- 2b. Desktop testing prompt for UI projects (5+ edits) ---
    const lang = getLocale(hook.session_id);
    lines.push(
      '',
      '[desktop-testing] 5+ code edits reached.',
      'BEFORE rendering the completion card with variant "test", check:',
      '  1. Can the project be tested visually? (preview server running, desktop app,',
      '     or ANY project with a startable UI — web, Electron, Tauri, game, etc.)',
      '  2. Is the variant "test" (code edits + app/service startable)?',
      'If BOTH true → ask the user via AskUserQuestion:',
      `  Header: "${t('header', lang, DESKTOP_TEST_DICT)}"`,
      `  Question: "${t('question', lang, DESKTOP_TEST_DICT)}"`,
      `  Warning in question: "${t('warning', lang, DESKTOP_TEST_DICT)}"`,
      `  Options: "${t('optYes', lang, DESKTOP_TEST_DICT)}" / "${t('optNo', lang, DESKTOP_TEST_DICT)}"`,
      '  If yes → run Computer Use visual tests (see deep-knowledge/desktop-testing.md)',
      '  If no → use manual userTest steps in the completion card as usual.',
      'If NOT a UI project → skip silently, use normal test flow.',
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
