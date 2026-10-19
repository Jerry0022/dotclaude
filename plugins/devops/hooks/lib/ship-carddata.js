'use strict';
/**
 * @module ship-carddata
 * @version 1.0.0
 * @plugin devops
 * @description The card input a delegated `--card-data` ship (an /auto-concept
 *   finalize, #712) hands back, kept on disk as well as in the chat reply.
 *
 *   The subagent returns `{ status: "done", cardData, afterRender,
 *   exitWorktree }` in its last message, and the parent renders it only after
 *   its own close-out. A compaction in between can drop that reply: the
 *   mandatory-card Stop gate then forces a card the parent has to rebuild
 *   without ship state, and it downgrades to `ready`. So the subagent also
 *   writes the same object here, `stop.flow.guard` and `ss.ship.resume` point
 *   the parent back to it, and `render_completion_card` consumes it when it
 *   renders the stored variant (the parent's explicit `clear` is the backup).
 *
 *   File: `<project root>/.claude/.ship-carddata-<session>.json` — keyed by
 *   the PARENT session id the subagent got in its prompt, so a neighbouring
 *   session's ship never answers for this one. Git-excluded runtime state
 *   (runtime-ignores.js). Older than MAX_AGE_MS counts as abandoned.
 *
 *   Best effort, never throws.
 */

const fs = require('fs');
const path = require('path');
const { projectRoot } = require('./project-root');

/** A day: a usage limit can sit between the ship and the parent's render. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Same shape the completion MCP accepts (card-widget.js safeSessionId). */
function safeSid(sessionId) {
  const s = typeof sessionId === 'string' ? sessionId.trim() : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : '';
}

/** Path for this session, or '' when the id is unusable. */
function cardDataPath(cwd, sessionId) {
  const sid = safeSid(sessionId);
  if (!cwd || !sid) return '';
  return path.join(projectRoot(cwd), '.claude', `.ship-carddata-${sid}.json`);
}

/**
 * Store the subagent's `done` payload.
 * @param {string} cwd
 * @param {string} sessionId the parent session id
 * @param {{ cardData: object, afterRender?: string[], exitWorktree?: boolean }} payload
 * @returns {boolean}
 */
function writeCardData(cwd, sessionId, payload) {
  const p = cardDataPath(cwd, sessionId);
  if (!p || !payload || typeof payload.cardData !== 'object' || !payload.cardData) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const body = {
      cardData: payload.cardData,
      afterRender: Array.isArray(payload.afterRender) ? payload.afterRender.map(String) : [],
      exitWorktree: payload.exitWorktree === true,
      writtenAt: Date.now(),
    };
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The stored payload for this session, or null (absent, torn, abandoned).
 * @param {string} cwd
 * @param {string} sessionId
 * @param {{ now?: number }} [o]
 */
function readCardData(cwd, sessionId, { now = Date.now() } = {}) {
  const p = cardDataPath(cwd, sessionId);
  if (!p) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || typeof data.cardData !== 'object' || !data.cardData) return null;
    if (typeof data.writtenAt === 'number' && now - data.writtenAt > MAX_AGE_MS) return null;
    return { ...data, path: p };
  } catch {
    return null;
  }
}

function clearCardData(cwd, sessionId) {
  const p = cardDataPath(cwd, sessionId);
  if (!p) return false;
  try { fs.unlinkSync(p); return true; } catch { return false; }
}

/**
 * Called by render_completion_card: drop the file once the card it holds is
 * rendered (same variant). A different card — an analysis answer in between —
 * leaves it for the real render.
 * @returns {boolean} whether the file was consumed
 */
function consumeOnRender(cwd, sessionId, variant) {
  const data = readCardData(cwd, sessionId);
  if (!data || !variant || data.cardData.variant !== variant) return false;
  return clearCardData(cwd, sessionId);
}

/**
 * The instruction that sends the parent back to the stored payload.
 * @param {{ path: string, cardData: object, afterRender: string[], exitWorktree: boolean }} data
 * @param {{ pluginRoot: string, cwd: string, sessionId: string }} o
 * @returns {string}
 */
function renderFromFileInstruction(data, { pluginRoot, cwd, sessionId }) {
  const root = String(pluginRoot).replace(/\\/g, '/');
  const shipped = data.cardData.variant !== 'ship-blocked';
  return [
    `[ship-carddata] A delegated concept-finalize ship (--card-data) left its card input in ${data.path.replace(/\\/g, '/')}`,
    `(variant ${data.cardData.variant || '?'}) and no card has been rendered from it yet. Do NOT rebuild the card from memory —`,
    'that loses the ship state and downgrades it to ready. Read the file, then:',
    shipped
      ? '  1. finish the /auto-concept close-out if it is not done yet (part D and Step 6a: bridge, pulser, waker stopped, state file gone);'
      : '  1. ship-blocked: no close-out, the concept stays open;',
    '  2. call render_completion_card with its cardData verbatim and show the card per the render result, as the LAST card;',
    `  3. run its afterRender steps${data.afterRender.length ? ` (${data.afterRender.length})` : ' (none)'};`,
    `  4. node "${root}/scripts/ship-carddata.js" clear --cwd "${String(cwd).replace(/\\/g, '/')}" --session ${sessionId}`,
    data.exitWorktree ? '  5. then ExitWorktree({ action: "remove" }).' : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  MAX_AGE_MS, cardDataPath, writeCardData, readCardData, clearCardData, consumeOnRender,
  renderFromFileInstruction,
};
