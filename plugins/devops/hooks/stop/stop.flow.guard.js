#!/usr/bin/env node
/**
 * @hook stop.flow.guard
 * @version 0.3.0
 * @event Stop
 * @plugin devops
 * @description Per-turn completion card + validation enforcement (the validation
 *   half of the V&V gate). Fires when Claude finishes a response turn.
 *   Logic lives in lib/card-guard.js (pure functions, unit-tested).
 *
 *   Block (JSON `{decision:"block"}` on stdout) when, and this is not already a
 *   blocked stop cycle (stop_hook_active=false):
 *     1. no card rendered AND (tool calls happened OR substantial prose), OR
 *     2. a card exists but a code change owes validation
 *        (validation-pending set, validation-attested not), OR
 *     3. a card exists but background subagents / tasks are still running and
 *        the card did not declare them (`pending` field, pending-attested not).
 *        Open work is read from the transcript, not from a flag — completions
 *        arrive as task-notifications, which no tool hook ever sees.
 *
 *   Pass (silent exit 0) otherwise — flags are reset so the next turn is
 *   evaluated independently.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { readSessionFile } = require('../lib/session-id');
const {
  decideAction,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  safeReadTranscript,
  PENDING_TAIL_BYTES,
} = require('../lib/card-guard');
const { scanOpenTasks, openTaskNames } = require('../lib/pending-tasks');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  // Enforcement flags — exact match only, never the glob fallback (issue #290):
  // this gate blocks the stop on them, so a neighbouring session's file must not
  // be able to answer for this one in either direction.
  const EXACT = { exact: true };
  const workResult = readSessionFile('dotclaude-devops-work-happened', sessionId, EXACT);
  const cardResult = readSessionFile('dotclaude-devops-card-rendered', sessionId, EXACT);
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', sessionId, EXACT);
  const valPendingResult = readSessionFile('dotclaude-devops-validation-pending', sessionId, EXACT);
  const valAttestedResult = readSessionFile('dotclaude-devops-validation-attested', sessionId, EXACT);
  const pendAttestedResult = readSessionFile('dotclaude-devops-pending-attested', sessionId, EXACT);

  const workHappened = workResult !== null;
  const flagCardRendered = cardResult !== null;
  const silent = silentResult !== null;
  const validationPending = valPendingResult !== null;
  const validationAttested = valAttestedResult !== null;
  const pendingAttested = pendAttestedResult !== null;
  const stopHookActive = hook.stop_hook_active === true;

  // Scan the transcript unless this is a silent tick. It answers two questions:
  //  - did the last assistant message already carry a card / substantial prose
  //    (backup for a failed flag write, plus the chat-only heuristic), and
  //  - is background work still running (Gate 3), which no flag can tell us —
  //    completions arrive as task-notifications, not as tool calls.
  // The wider PENDING slice is used so an agent launched early in a long turn
  // is still seen; scanOpenTasks short-circuits when no launch marker is there.
  const transcript = silent ? '' : safeReadTranscript(hook.transcript_path, PENDING_TAIL_BYTES);
  const substantial = isSubstantialAnswer(transcript);
  const openTasks = silent ? [] : openTaskNames(scanOpenTasks(transcript));
  // Backup detection: if the last assistant text already contains the card
  // marker, treat as rendered even when the flag write failed.
  const cardRendered = flagCardRendered || lastAssistantContainsCard(transcript);

  const decision = decideAction({
    workHappened,
    cardRendered,
    stopHookActive,
    substantial,
    silent,
    validationPending,
    validationAttested,
    openTaskNames: openTasks,
    pendingAttested,
    // Active install root — the block reason names the offline renderer under it
    // for the case where the MCP server never connected this session.
    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..'),
  });

  if (decision.resetFlags) {
    if (workResult) try { fs.unlinkSync(workResult.filePath); } catch {}
    if (cardResult) try { fs.unlinkSync(cardResult.filePath); } catch {}
    if (silentResult) try { fs.unlinkSync(silentResult.filePath); } catch {}
    // Validation flags are owned by this gate — clear them at a clean turn end.
    if (valPendingResult) try { fs.unlinkSync(valPendingResult.filePath); } catch {}
    if (valAttestedResult) try { fs.unlinkSync(valAttestedResult.filePath); } catch {}
    // Same for the pending attestation: it attests THIS turn's card, so the next
    // turn must re-declare any work that is still running.
    if (pendAttestedResult) try { fs.unlinkSync(pendAttestedResult.filePath); } catch {}
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
