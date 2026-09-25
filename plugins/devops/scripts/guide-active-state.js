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

const GUIDE_ACTIVE_REL = path.join('.claude', 'auto-guide-active.json');
const GUIDE_ACTIVE_TTL_MS = 30 * 60 * 1000;

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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ts: now }));
  fs.renameSync(tmp, file);
  return file;
}

/** Remove the marker (guide ended: done, aborted, or closed tab). */
function clearGuideActive(cwd) {
  const file = guideActiveFilePath(cwd);
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
  return file;
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
  isGuideActive,
};
