/**
 * @module guide-pending
 * @version 0.1.0
 * @description One-shot "pending web hand-off" record between
 *   stop.guide.handoff (writer) and prompt.skill.enforce (reader).
 *
 *   When the hand-off sits in a turn that already ends with the completion
 *   card, stop.guide.handoff must not block (that would force a second card,
 *   stop.flow.guard's "card last" contract). It records the service here;
 *   prompt.skill.enforce turns it into ONE non-mandatory hint on the next
 *   real user prompt and clears it. Kept separate from guide-handoff so the
 *   per-prompt hook does not load the detection regexes and card-guard.
 *
 *   Session-scoped temp file, exact session match only (never the glob
 *   fallback — a neighbouring session's hand-off is not this user's).
 */

const fs = require('fs');
const { sessionFile, readSessionFile, writeSessionFile } = require('./session-id');

const PENDING_PREFIX = 'dotclaude-devops-guide-handoff-pending';
/** A hint older than this no longer relates to what the user is doing. */
const PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function writePendingHandoff(sessionId, service, now = Date.now()) {
  try {
    writeSessionFile(sessionFile(PENDING_PREFIX, sessionId), JSON.stringify({ service, at: now }));
  } catch { /* advisory */ }
}

/**
 * Read and clear the pending hand-off for this session.
 * @returns {string|null} the service name, or null
 */
function consumePendingHandoff(sessionId, now = Date.now()) {
  const result = readSessionFile(PENDING_PREFIX, sessionId, { exact: true });
  if (!result) return null;
  try { fs.unlinkSync(result.filePath); } catch { /* already gone */ }
  try {
    const data = JSON.parse(String(result.content).replace(/^\uFEFF/, ''));
    if (!data || typeof data.service !== 'string' || !data.service) return null;
    if (typeof data.at === 'number' && now - data.at > PENDING_MAX_AGE_MS) return null;
    return data.service;
  } catch {
    return null;
  }
}

function buildPendingHint(service) {
  return [
    `[stop.guide.handoff] Your last answer handed the user manual web steps for ${service}.`,
    'If the user is doing those steps now (or asks about them), offer the devops',
    '`web-guide` skill (target name `auto-guide`) to guide them live in their browser',
    'tab. Offer only — do not invoke it unasked, and ignore this note if unrelated.',
  ].join('\n') + '\n';
}

module.exports = { PENDING_PREFIX, PENDING_MAX_AGE_MS, writePendingHandoff, consumePendingHandoff, buildPendingHint };
