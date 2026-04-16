#!/usr/bin/env node
/**
 * @hook stop.flow.guard
 * @version 0.2.0
 * @event Stop
 * @plugin devops
 * @description Per-turn completion card enforcement.
 *   Fires when Claude finishes a response turn.
 *   Logic lives in lib/card-guard.js (pure functions, unit-tested).
 *
 *   Block (JSON `{decision:"block"}` on stdout) when:
 *     - no card rendered AND
 *     - (tool calls happened OR last assistant text is substantial prose)
 *     - AND this is not already a blocked stop cycle (stop_hook_active=false)
 *
 *   Pass (silent exit 0) otherwise — flags are reset so the next turn is
 *   evaluated independently.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { readSessionFile } = require('../lib/session-id');
const {
  decideAction,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  safeReadTranscript,
} = require('../lib/card-guard');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  const workResult = readSessionFile('dotclaude-devops-work-happened', sessionId);
  const cardResult = readSessionFile('dotclaude-devops-card-rendered', sessionId);

  const workHappened = workResult !== null;
  const flagCardRendered = cardResult !== null;
  const stopHookActive = hook.stop_hook_active === true;

  // Scan transcript when the flag state alone cannot settle the decision:
  //  - no card flag → might still have rendered the card (marker scan = backup)
  //  - no work and no card → need substantial-answer heuristic
  const transcript = !flagCardRendered
    ? safeReadTranscript(hook.transcript_path)
    : '';
  const substantial = isSubstantialAnswer(transcript);
  // Backup detection: if the last assistant text already contains the card
  // marker, treat as rendered even when the flag write failed.
  const cardRendered = flagCardRendered || lastAssistantContainsCard(transcript);

  const decision = decideAction({
    workHappened,
    cardRendered,
    stopHookActive,
    substantial,
  });

  if (decision.resetFlags) {
    if (workResult) try { fs.unlinkSync(workResult.filePath); } catch {}
    if (cardResult) try { fs.unlinkSync(cardResult.filePath); } catch {}
  }

  if (decision.action === 'block') {
    // Claude Code interprets JSON stdout for Stop hooks:
    //   { decision: "block", reason: "..." } → blocks stop, feeds reason to Claude
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: decision.reason,
    }));
  }
  // else: pass silently

  process.exit(0);
});
