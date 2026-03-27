#!/usr/bin/env node
/**
 * @hook prompt.start.detect
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin dotclaude-dev-ops
 * @description Detect app start intent in user prompts. When the user wants to
 *   start/run/dev the app, set a session flag so the Stop hook knows to enforce
 *   the completion flow with the correct test variant (6a/6b/7).
 *
 *   Also injects a reminder that the completion card is mandatory after starting.
 */

const fs = require('fs');
const { sessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const userMessage = (hook.user_message || hook.message || '').toLowerCase().trim();
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
  try { fs.writeFileSync(flagFile, Date.now().toString()); } catch {}

  const instruction = [
    '[prompt.start.detect] App start intent detected.',
    '',
    'After starting the app, you MUST render a completion card.',
    'Use the correct variant:',
    '  - Variant 7 (no code changes in session): ## \ud83e\uddea <build-id> \u00b7 App gestartet',
    '  - Variant 6a (code changes, app started): ## \ud83e\uddea App gestartet \u2014 Bitte TESTEN \u2014 Soll ich nach Test SHIPPEN?',
    '  - Variant 6b (code changes, user must start): ## \ud83e\uddea Bitte App STARTEN und TESTEN \u2014 Soll ich nach Test SHIPPEN?',
    '',
    'The completion card is MANDATORY even for "just starting the app".',
  ].join('\n');

  process.stdout.write(instruction + '\n');
});
