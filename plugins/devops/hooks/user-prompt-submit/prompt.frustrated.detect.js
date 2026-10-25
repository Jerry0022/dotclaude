#!/usr/bin/env node
/**
 * @hook prompt.frustrated.detect
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @feature frustrated-mode (alpha)
 * @description Detects the "we are going in circles" pattern from the user's
 *   prompts and, when the score flags the session (>= 3 rounds, score >= 6),
 *   tells Claude to judge for itself whether the session is really stuck and,
 *   if so, to offer ONE short read-only analysis. On an interpretable yes
 *   Claude reads skills/auto-frustrated/SKILL.md and follows it.
 *
 *   Silent unless featureAllowed('frustrated-mode') — checked before any I/O —
 *   and `frustratedMode.suggest` is not false. Machine prompts, expanded slash
 *   commands and subagent calls are skipped. One offer per episode: after an
 *   offer the same episode needs 3 more rounds and +6 score to be offered
 *   again. State: lib/frustration-state.js (2 h expiry, `do-run` reads it via
 *   isSessionFlagged). Marker log: lib/frustration-log.js.
 *
 *   Spec: docs/superpowers/specs/2026-10-25-frustrated-mode-trigger-detection-design.md
 */

const fs = require('fs');

const FEATURE = 'frustrated-mode';
const TAIL_BYTES = 200 * 1024;

const OFFER_TEXT = [
  '[frustrated-mode] This session may be stuck in a loop of failed corrections (the user has now corrected the same thing several times).',
  'Judge from the conversation yourself whether it really is: the same target iterated without converging, results the user keeps rejecting. If it is only normal iteration (design tuning, a list being worked through), say nothing about this notice and carry on.',
  'If it really is stuck: before another attempt, offer the user a read-only Frustrated-Mode analysis in ONE short sentence (analyse intent, history and causes first, implement nothing without approval). Do not lecture, offer once only.',
  'On an interpretable yes, `Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md` and follow it. On a no, carry on as before and do not offer again.',
].join('\n');

/** Tail of the transcript as text (cheap, bounded). '' on any problem. */
function readTail(file) {
  try {
    if (!file) return '';
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/** Evidence from the transcript tail: did the last assistant turn claim "done", is an iterative skill active. */
function transcriptEvidence(file) {
  const { claimsDone } = require('../lib/frustration-detect');
  const tail = readTail(file);
  if (!tail) return { claimedDone: false, iterativeSkill: false };
  let lastAssistant = '';
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (!l || !l.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(l);
      if (e.type !== 'assistant') continue;
      const c = e.message && e.message.content;
      const text = Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : String(c || '');
      if (text.trim()) { lastAssistant = text; break; }
    } catch { /* partial first line of the tail */ }
  }
  return {
    claimedDone: claimsDone(lastAssistant),
    iterativeSkill: /"skill"\s*:\s*"(?:devops:)?auto-(?:concept|polish)"/.test(tail.slice(-60 * 1024)),
  };
}

/**
 * @param {object} hook UserPromptSubmit payload
 * @param {{features?:object, home?:string, stateFile?:string, logFile?:string, nowMs?:number, evidence?:object}} [opts] test injection
 * @returns {string|null} the context to inject, or null (silent)
 */
function decide(hook, opts = {}) {
  // gate first: before any I/O beyond the stdin the caller already read
  if (!require('../lib/features').featureAllowed(FEATURE, opts.features)) return null;
  if (!hook || hook.agent_id) return null;
  const prompt = hook.prompt || hook.user_message || hook.message || '';
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  if (require('../lib/non-user-prompt').isNonUserPrompt(prompt)) return null;
  if (prompt.includes('<command-name>')) return null;

  const cwd = hook.cwd || process.cwd();
  let suggest = true;
  try { suggest = require('../lib/devops-config').load(cwd, { home: opts.home }).values.frustratedMode.suggest !== false; } catch { /* default on */ }
  if (!suggest) return null;

  const sessionId = hook.session_id || '';
  if (!sessionId && !opts.stateFile) return null;
  const { detect } = require('../lib/frustration-detect');
  const stateIo = require('../lib/frustration-state');
  const log = require('../lib/frustration-log');
  const nowMs = opts.nowMs || Date.now();
  const sOpts = { file: opts.stateFile, nowMs };

  const prev = stateIo.readState(sessionId, sOpts);
  const evidence = opts.evidence || transcriptEvidence(hook.transcript_path);
  const res = detect(prompt, prev, { ...evidence, nowMs });
  const st = res.state;

  const inBand = res.rounds >= 3 && res.score >= 3 && !res.flagged;
  if (res.flagged) st.offer = { rounds: res.rounds, score: res.score, at: nowMs };
  stateIo.writeState(sessionId, st, sOpts);
  if (res.flagged || inBand) {
    log.appendVerdict({ sessionId, verdict: res.flagged ? 'suggest' : 'band', rounds: res.rounds, score: res.score, signals: res.signals, nowMs }, { file: opts.logFile, home: opts.home });
  }
  return res.flagged ? OFFER_TEXT : null;
}

if (require.main === module) {
  try {
    if (!require('../lib/features').featureAllowed(FEATURE)) process.exit(0);
    require('../lib/hook-input').runHook(
      (hook) => decide(hook),
      { event: 'UserPromptSubmit' },
    );
  } catch { /* fail open */ }
}

module.exports = { decide, transcriptEvidence, OFFER_TEXT };
