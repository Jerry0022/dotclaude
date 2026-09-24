#!/usr/bin/env node
/**
 * @hook prompt.flow.appstart
 * @version 0.3.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect app start intent in user prompts. When the user wants to
 *   start/run/dev the app, set a session flag so the Stop hook knows to enforce
 *   the completion flow with the correct card variant (`test-minimal` when no
 *   code changed this session, `test` when it did).
 *
 *   Also injects a reminder that the completion card is mandatory after starting.
 */

require('../lib/plugin-guard');

const { sessionFile, writeSessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // A collected prompt produces no turn — recording a start intent from it
  // would leave the flag set for a prompt that was erased.
  try { if (require('../lib/batch-state').willBeCollected(hook)) process.exit(0); }
  catch { /* fail open */ }

  const raw = hook.prompt || hook.user_message || hook.message || '';
  // A task notification or cron tick is no start request: its text can say
  // "start" or "preview" and still come from nobody (#474).
  if (require('../lib/non-user-prompt').isNonUserPrompt(raw)) process.exit(0);
  const userMessage = raw.toLowerCase().trim();
  if (!userMessage) process.exit(0);

  const startKeywords = [
    /\bstart(?:e|en)?\b/,
    /\bdev\s+start\b/,
    /\bnpm\s+(?:run\s+)?(?:dev|start|serve)\b/,
    /\bapp\s+starten\b/,
    /\bserver\s+starten\b/,
    /\bstarte?\s+(?:die\s+)?app\b/,
    /\brun\s+(?:the\s+)?(?:app|server|dev)\b/,
    /\bpreview\b/,
    /\blocal(?:host)?\s+starten\b/,
  ];

  if (!startKeywords.some(re => re.test(userMessage))) {
    process.exit(0);
  }

  // Set a session flag so the Stop hook knows this was a start-intent response
  const flagFile = sessionFile('dotclaude-devops-start-intent', hook.session_id);
  try { writeSessionFile(flagFile, Date.now().toString()); } catch {}

  const instruction = [
    '[prompt.flow.appstart] App start intent detected.',
    '',
    'After starting the app, you MUST render a completion card.',
    'Use the correct variant:',
    '  - test-minimal (no code changes in session): title + one line + `\u25b6\ufe0f L\u00e4uft \u2014 viel Spa\u00df` \u2014 no evidence, budget, pipeline or widget',
    '  - test (code changes this session, app running): `\ud83e\uddea Erst testen, dann shippen?` with the test steps as points',
    '',
    'The completion card is MANDATORY even for "just starting the app".',
  ].join('\n');

  process.stdout.write(instruction + '\n');
});
