/**
 * @module card-pregate
 * @version 0.1.0
 * @plugin devops
 * @description stop.flow.guard's payload gates, checked by
 *   render_completion_card BEFORE it renders.
 *
 *   The Stop gate reads the card after the turn: a title with a status word,
 *   a code-change card without `validation`, a requirement gap or an
 *   undeclared background task each cost a full second render plus its
 *   widget — ~3.5k output tokens per block, 102 blocks in two days
 *   (benchmark 2026-09-27). Every one of these is decidable from the tool's
 *   own input plus the session flags and the transcript, so the tool refuses
 *   the call instead and names what to fix; nothing is rendered or shown.
 *
 *   The Stop gate stays exactly as it is — this is an earlier copy of the
 *   same rules (same regex, same classify(), same transcript scan, same
 *   reason texts), never a replacement. The gates it checks:
 *     3  title status word        (card-guard TITLE_STATUS_WORD_RE on `summary`)
 *     4  validation owed          (validation-pending flag, no `validation`)
 *     4b requirement gaps         (validation-gaps.classify with the open-task count)
 *     5  undeclared background work (pending-tasks scan, no `pending`)
 *
 *   One refusal per identical finding: the same findings on the next call
 *   render anyway, so a false positive can never lock the card out — the
 *   Stop gate then decides, as before.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  titleStatusWordViolation, buildTitleStatusWordReason, buildValidationReason,
  buildValidationGapsReason, buildPendingReason, safeReadTranscript, PENDING_TAIL_BYTES,
} = require('./card-guard');
const validationGaps = require('./validation-gaps');
const { scanOpenTasks, openTaskNames } = require('./pending-tasks');
const { readSessionFile, sessionFile, writeSessionFile } = require('./session-id');

const EXACT = { exact: true };
const REFUSED_PREFIX = 'dotclaude-devops-card-pregate';

/** The session transcript: ~/.claude/projects/<any>/<sessionId>.jsonl, or null. */
function findTranscript(sessionId, home = os.homedir()) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return null;
  const root = path.join(home, '.claude', 'projects');
  let dirs;
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(root, d, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The gate findings for a card payload. Pure apart from what it is handed.
 *
 * @param {object} input            — the render_completion_card params
 * @param {object} ctx
 * @param {boolean} ctx.validationPending — the session owes a validation (flag)
 * @param {string[]|null} ctx.openTasks   — running background work by name; null = unknown
 * @returns {string[]} one reason per failed gate (card-guard wording)
 */
function findings(input, { validationPending = false, openTasks = null } = {}) {
  const out = [];
  const word = titleStatusWordViolation(String(input.summary || ''));
  if (word) out.push(buildTitleStatusWordReason(word));

  const validation = Array.isArray(input.validation) ? input.validation : [];
  if (validationPending && validation.length === 0) out.push(buildValidationReason());

  if (!validationGaps.GAP_EXEMPT_VARIANTS.has(input.variant)) {
    const open = validationGaps.openItems(validation);
    if (open.length) {
      const { gaps } = validationGaps.classify(open, { openTasks: openTasks === null ? null : openTasks.length });
      if (gaps.length) out.push(buildValidationGapsReason(gaps, openTasks || []));
    }
  }

  const pending = Array.isArray(input.pending) ? input.pending.filter(Boolean) : [];
  if (openTasks && openTasks.length > 0 && pending.length === 0) out.push(buildPendingReason(openTasks));
  return out;
}

/**
 * Decide whether render_completion_card refuses this call.
 * @returns {{ refuse: false } | { refuse: true, text: string }}
 */
function check(input, { home, tmp } = {}) {
  const sessionId = input && input.session_id;
  if (!sessionId || sessionId === 'unknown') return { refuse: false };
  // Render tests draw cards with gaps on purpose; the Stop gate is unaffected.
  if (process.env.DEVOPS_CARD_PREGATE === '0') return { refuse: false };
  try {
    const validationPending = readSessionFile('dotclaude-devops-validation-pending', sessionId, EXACT) !== null;
    const transcriptPath = findTranscript(sessionId, home);
    const transcript = transcriptPath ? safeReadTranscript(transcriptPath, PENDING_TAIL_BYTES) : '';
    const openTasks = transcript ? openTaskNames(scanOpenTasks(transcript)) : null;
    const reasons = findings(input, { validationPending, openTasks });

    const file = tmp ? path.join(tmp, `${REFUSED_PREFIX}-${sessionId}`) : sessionFile(REFUSED_PREFIX, sessionId);
    if (reasons.length === 0) {
      try { fs.unlinkSync(file); } catch { /* none */ }
      return { refuse: false };
    }
    const sig = crypto.createHash('sha1').update(reasons.join('\n')).digest('hex');
    let prev = null;
    try { prev = fs.readFileSync(file, 'utf8').trim(); } catch { /* first time */ }
    if (prev === sig) {
      try { fs.unlinkSync(file); } catch { /* gone */ }
      return { refuse: false }; // same findings twice: render; the Stop gate decides
    }
    writeSessionFile(file, sig);
    return { refuse: true, text: refusalText(reasons) };
  } catch {
    return { refuse: false }; // never lose a card to the pre-check
  }
}

function refusalText(reasons) {
  const head = [
    '[card-pregate] Not rendered — this card would be blocked by stop.flow.guard after the turn.',
    'Fix the call and render again (nothing was shown, no widget is owed):',
  ];
  const body = reasons.length === 1
    ? [reasons[0]]
    : reasons.map((r, i) => `(${i + 1}/${reasons.length}) ${r}`);
  return [...head, '', ...body].join('\n').replace(/\[stop\.flow\.guard\] /g, '');
}

module.exports = { check, findings, findTranscript, refusalText, REFUSED_PREFIX };
