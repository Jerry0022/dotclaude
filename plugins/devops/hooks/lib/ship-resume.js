'use strict';
/**
 * @module ship-resume
 * @version 1.0.1
 * @plugin devops
 * @description Is this prompt the user picking up an interrupted ship?
 *   Shared by prompt.ship.detect (which then emits the resume mandate) and
 *   prompt.flow.title-work (which then marks `⏳ ➜ 🚀 Shipping ┃ `, never the
 *   hourglass): after a usage limit or a crash the user types "weiter", not
 *   "ship", and the session must still read as shipping in the title and
 *   end with a ship card.
 *
 *   A prompt resumes a ship when an open checkpoint (lib/ship-checkpoint.js)
 *   belongs to this work tree AND the prompt is a continuation ("weiter",
 *   "continue", the app's "Continue from where you left off."), a short
 *   affirmation or a ship prompt itself. Anything else is new work: the
 *   checkpoint stays and ss.ship.resume / the next ship prompt pick it up.
 */

const { openCheckpoint, isShipDone, branchOf, nextStep, describeCheckpoint } = require('./ship-checkpoint');
const { isShipIntent } = require('./ship-intent');

const CONTINUE = [
  /^(bitte\s+)?(mach(e)?\s+)?weiter(machen)?(\s+(bitte|mit\s+dem\s+ship|shippen))?[.!]*$/i,
  /^(ship\s+)?fortsetzen[.!]*$/i,
  /^(please\s+)?(continue|resume|go\s+on|carry\s+on|keep\s+going)([\s\S]{0,60})?$/i,
  /^continue from where you left off\.?$/i,
  /^(ja|yes|yep|jap|ok|okay|go|mach|klar|bitte)[.,!]*$/i,
];

/** True when the prompt continues whatever was interrupted. */
function isContinuation(prompt) {
  const p = String(prompt || '').trim();
  if (!p || p.length > 120) return false;
  return CONTINUE.some((re) => re.test(p));
}

/**
 * The open checkpoint this prompt resumes, or null.
 * @param {string} prompt
 * @param {string} cwd
 * @returns {{ checkpoint: object, next: string, summary: string }|null}
 */
function shipResumeFor(prompt, cwd) {
  if (!cwd) return null;
  if (!isContinuation(prompt) && !isShipIntent(prompt)) return null;
  const cp = openCheckpoint(cwd);
  if (!cp || isShipDone(cp)) return null; // a merged ship is live: nothing to resume (#806)
  return { checkpoint: cp, next: nextStep(cp), summary: describeCheckpoint(cp) };
}

/**
 * The checkpoint of a ship that already merged (tag verified) but whose
 * cleanup never finished, or null. Reported as a leftover to clear, never
 * resumed.
 * @param {string} cwd
 * @returns {{ checkpoint: object, summary: string }|null}
 */
function cleanupLeftoverFor(cwd) {
  if (!cwd) return null;
  const cp = openCheckpoint(cwd);
  if (!cp || !isShipDone(cp)) return null;
  return { checkpoint: cp, summary: describeCheckpoint(cp), cwd };
}

/** The note for a merged ship whose cleanup is still pending. */
function cleanupLeftoverInstruction({ checkpoint: cp, summary, cwd }) {
  const branch = branchOf(cp, cwd);
  const tag = cp.steps.release.tag ? ` (${cp.steps.release.tag})` : '';
  return [
    `[ship-cleanup-leftover] The ship of branch ${cp.branch || '?'} is already DONE: release merged and the tag${tag} is verified. Only the cleanup did not finish.`,
    `State: ${summary}`,
    'This is NOT an interrupted ship: do NOT resume it, do NOT start a resume subagent, do NOT set the "Shipping" title, and never repeat bump, PR or tag.',
    `To clear the leftover (sentinel + checkpoint) call ship_cleanup({ ${branch ? `branch: "${branch}", ` : ''}cwd, keep: true }) once; if it is denied, say so in one line and carry on with the user's request.`,
  ].join('\n');
}

module.exports = { isContinuation, shipResumeFor, cleanupLeftoverFor, cleanupLeftoverInstruction };
