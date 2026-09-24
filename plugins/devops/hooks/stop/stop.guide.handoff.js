#!/usr/bin/env node
/**
 * @hook stop.guide.handoff
 * @version 0.3.0
 * @event Stop
 * @plugin devops
 * @description Offer the auto-guide skill when Claude's own answer hands the user a manual click-through on an external website.
 *   auto-guide was invoked 0 times in 1 128 sessions although Claude
 *   repeatedly wrote out such click-throughs (Upstash setup, Discord bot
 *   authorization, Supabase MCP login, …). The signal is in Claude's OWN
 *   last answer, so a UserPromptSubmit hook cannot see it.
 *
 *   Detection (hooks/lib/guide-handoff.js, unit-tested): the assistant text
 *   of the WHOLE current turn — every assistant entry back to the turn's
 *   opening prompt, each with its completion-card region stripped; Claude
 *   Code writes each content block as its own entry, so the last entry may
 *   hold only the card — names an external service/URL (loopback and
 *   github.com report links excluded) AND carries a numbered list with a UI
 *   verb, or ≥2 `→` arrows plus a named service.
 *
 *   Two outcomes, once per session PER DISTINCT SERVICE:
 *     - the last message contains the completion card (✨✨✨ marker) →
 *       never block (a block would force a second card and break
 *       stop.flow.guard's "card last" contract). A pending hand-off is
 *       recorded instead; prompt.skill.enforce injects ONE non-mandatory
 *       hint on the next real user prompt and clears it.
 *     - no card in the last message → block with the guide offer
 *       (stop.flow.guard blocks the same stop for the missing card, so the
 *       continuation carries both).
 *   Never acts when: stop_hook_active (loop guard), the turn is silent /
 *   machine-driven (session flag OR the turn's opening prompt in the
 *   transcript — the flag alone races stop.flow.guard deleting it), the
 *   turn already invoked auto-guide (or web-guide), or input is malformed.
 */

require('../lib/plugin-guard');

const { readSessionFile, sessionFile, writeSessionFile } = require('../lib/session-id');
const { parseHookInput } = require('../lib/hook-input');
const { safeReadTranscript, lastAssistantCardText, TRANSCRIPT_TAIL_BYTES } = require('../lib/card-guard');
const {
  detectWebHandoff, webGuideInvokedThisTurn, containsCompletionCard, writePendingHandoff, stripCompletionCard,
} = require('../lib/guide-handoff');
const { lastUserPromptText, turnAssistantTexts } = require('../lib/skill-invocations');
const { isMachinePrompt } = require('../lib/batch-state');
const { isSilent, isMachineTurn, isScheduledTask } = require('../user-prompt-submit/prompt.flow.silent-turn');

const FLAG_PREFIX = 'dotclaude-devops-guide-handoff-services';

function readHandledServices(sessionId) {
  const result = readSessionFile(FLAG_PREFIX, sessionId, { exact: true });
  if (!result) return [];
  try {
    const parsed = JSON.parse(result.content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHandledServices(sessionId, services) {
  try {
    writeSessionFile(sessionFile(FLAG_PREFIX, sessionId), JSON.stringify(services));
  } catch {}
}

/** Turn opened by a cron / loop / scheduled task / notification — nobody to guide. */
function isMachineDrivenTurn(transcript) {
  const prompt = lastUserPromptText(transcript);
  if (!prompt) return false;
  return isSilent(prompt) || isMachinePrompt(prompt) || isMachineTurn(prompt) || isScheduledTask(prompt);
}

function buildReason(service) {
  return [
    '[stop.guide.handoff] Manual web hand-off detected — this reads like a text',
    `click-through for ${service} instead of a live-guided step.`,
    '',
    'Offer the devops `auto-guide` skill: it drives the',
    'user through the exact steps live in their browser tab, instead of a text list',
    'they have to execute by hand.',
    '',
    'If a live-guided walkthrough does not apply (the user asked for a written list,',
    'or no browser session is available), say so briefly and continue — this fires',
    'once per service per session. End with the completion card as usual.',
  ].join('\n');
}

function main(inputData) {
  const hook = parseHookInput(inputData);
  if (!hook) return;

  if (hook.stop_hook_active === true) return;

  const sessionId = hook.session_id;

  if (readSessionFile('dotclaude-devops-silent-turn', sessionId, { exact: true }) !== null) return;

  const transcript = safeReadTranscript(hook.transcript_path, TRANSCRIPT_TAIL_BYTES);
  if (!transcript) return;
  if (isMachineDrivenTurn(transcript)) return;

  const turnText = turnAssistantTexts(transcript).map(stripCompletionCard).join('\n');
  if (!turnText.trim()) return;

  const detection = detectWebHandoff(turnText);
  if (!detection) return;
  const lastText = lastAssistantCardText(transcript);

  if (webGuideInvokedThisTurn(transcript)) return;

  const handled = readHandledServices(sessionId);
  if (handled.includes(detection.service)) return;
  writeHandledServices(sessionId, [...handled, detection.service]);

  if (containsCompletionCard(lastText)) {
    writePendingHandoff(sessionId, detection.service);
    return;
  }

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: buildReason(detection.service),
  }));
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  try { main(inputData); } catch { /* never surface an internal error */ }
  // No process.exit(): stdout to a pipe may still be flushing.
  process.exitCode = 0;
});
