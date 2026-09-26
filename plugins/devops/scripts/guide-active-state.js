/**
 * @module guide-active-state
 * @version 0.1.0
 * @description Small on-disk marker recording "an /auto-guide run is
 *   currently active", shared between `web-guide.js` (writer, called from
 *   SKILL.md Step 3 / Step 6 / Step 7) and `stop.flow.guard` (reader, #526):
 *   while the marker is fresh, the completion-card gate does not force the
 *   turn to end — a forced card was what killed the guide's wait() loop
 *   (Weiter looked dead once Claude's turn ended).
 *
 *   Lives at `<project>/.claude/auto-guide-active.json` — a per-project file,
 *   not a session-temp one, because the guide loop spans many turns and the
 *   hook only ever sees `hook.cwd`, never a session id it could trust across
 *   a crashed/restarted session.
 *
 *   Expires after GUIDE_ACTIVE_TTL_MS so a guide that crashed mid-loop (tab
 *   closed, process killed) without ever reaching Step 6/7 does not disable
 *   the card gate forever.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GUIDE_ACTIVE_REL = path.join('.claude', 'auto-guide-active.json');
const GUIDE_ACTIVE_TTL_MS = 30 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{32}$/;

function readMarker(cwd) {
  try {
    const data = JSON.parse(fs.readFileSync(guideActiveFilePath(cwd), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function guideActiveFilePath(cwd) {
  return path.join(cwd || process.cwd(), GUIDE_ACTIVE_REL);
}

/**
 * Refresh the marker (guide is active as of now). Called at guide start and
 * again whenever the skill wants to extend the window (e.g. before a long
 * step) — the TTL is measured from the LAST write, not guide start.
 */
function markGuideActive(cwd, now = Date.now()) {
  const file = guideActiveFilePath(cwd);
  // AUD-C007: the marker also carries the guide's channel token (overlay
  // setStep/wait). A live guide keeps its token; an expired or missing marker
  // starts a new one.
  const prev = readMarker(cwd);
  const keep = prev && typeof prev.ts === 'number' && now - prev.ts <= GUIDE_ACTIVE_TTL_MS
    && typeof prev.token === 'string' && TOKEN_RE.test(prev.token);
  const token = keep ? prev.token : crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ts: now, token }));
  fs.renameSync(tmp, file);
  return file;
}

/**
 * Remove the marker (guide ended: done, aborted, or closed tab). An absent
 * marker is success; any other unlink failure throws (AUD-C061) so the CLI
 * can report it instead of claiming the guide was cleared.
 */
function clearGuideActive(cwd) {
  const file = guideActiveFilePath(cwd);
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  return file;
}

/**
 * The live guide's channel token (AUD-C007), or null when no fresh marker
 * with a token exists.
 */
function readGuideToken(cwd, now = Date.now()) {
  const data = readMarker(cwd);
  if (!data || typeof data.ts !== 'number' || now - data.ts > GUIDE_ACTIVE_TTL_MS) return null;
  return typeof data.token === 'string' && TOKEN_RE.test(data.token) ? data.token : null;
}

/**
 * @param {string} cwd
 * @param {number} [now]
 * @returns {boolean} true when the marker exists and is younger than the TTL
 */
function isGuideActive(cwd, now = Date.now()) {
  try {
    const raw = fs.readFileSync(guideActiveFilePath(cwd), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.ts !== 'number') return false;
    return now - data.ts <= GUIDE_ACTIVE_TTL_MS;
  } catch {
    return false;
  }
}

module.exports = {
  GUIDE_ACTIVE_REL,
  GUIDE_ACTIVE_TTL_MS,
  guideActiveFilePath,
  markGuideActive,
  clearGuideActive,
  readGuideToken,
  isGuideActive,
};
