/**
 * @module guide-active-state
 * @version 0.5.0
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
 *
 *   Resume support: the marker also carries `lastStep`/`lastStepTs` (the most
 *   recent Step object `payload step` rendered) so a turn resumed after a
 *   crash/compaction can recover which step the overlay was showing without
 *   re-deriving it from the transcript. `recordGuideStep` refuses to persist
 *   a step that carries a `value` field anywhere (recursively) — Step never
 *   needs one except `copy[].value`, which is deliberately never written to
 *   disk, keeping the marker free of anything that looks like user input.
 *   `markGuideActive` preserves whatever `lastStep`/`lastStepTs` is already on
 *   the marker across a plain refresh (it never writes step data itself).
 *
 *   Paused state (#619): `pauseGuide` sets `paused: true` (the 20-min pause
 *   step in recovery.md § Ends) — the marker, token and lastStep stay, but the
 *   poll loop is deliberately stopped. `markGuideActive` and `recordGuideStep`
 *   drop the flag again: any resumed activity un-pauses. stop.flow.guard reads
 *   `isGuideLoopLive` (active AND not paused) to block a premature turn end
 *   once; a paused guide ends its turn freely.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GUIDE_ACTIVE_REL = path.join('.claude', 'auto-guide-active.json');
const GUIDE_ACTIVE_TTL_MS = 30 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{32}$/;
// Keeps the marker small (per the module description) — a step this size is
// already far beyond anything protocol.md's Step shape allows.
const MAX_LAST_STEP_JSON_LEN = 4000;

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
 * Atomically write the marker's JSON content. Shared by markGuideActive and
 * recordGuideStep so both honor the same "no clobbered .tmp on a race"
 * guarantee.
 * @param {string} file
 * @param {object} data
 */
function writeMarkerFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A unique temp name — two concurrent writers (payload step and payload
  // wait racing) must not clobber each other's `.tmp` mid-write.
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* never created / already renamed */ }
    throw err;
  }
}

/**
 * Refresh the marker (guide is active as of now). Called at guide start and
 * again whenever the skill wants to extend the window (e.g. before a long
 * step) — the TTL is measured from the LAST write, not guide start.
 */
function markGuideActive(cwd, now = Date.now()) {
  const file = guideActiveFilePath(cwd);
  // AUD-C007: the marker also carries the guide's channel token (overlay
  // setStep/wait). The token lives until `guide clear`, not just the TTL: a
  // guide resumed after a long pause must still reach the overlay already in
  // the page — a fresh token there meant a tab reload, which can throw away
  // what the user had typed on the site. The TTL only governs "active" for
  // stop.flow.guard. A missing marker starts a new token.
  const prev = readMarker(cwd);
  const keep = prev && typeof prev.token === 'string' && TOKEN_RE.test(prev.token);
  const token = keep ? prev.token : crypto.randomBytes(16).toString('hex');
  const data = { ts: now, token };
  // A plain refresh (guide active / touchGuideToken) must not drop the last
  // recorded step — only recordGuideStep and guide clear ever change it.
  if (prev && prev.lastStep !== undefined) data.lastStep = prev.lastStep;
  if (prev && typeof prev.lastStepTs === 'number') data.lastStepTs = prev.lastStepTs;
  // `paused` is deliberately not carried over: a refresh means the loop runs.
  writeMarkerFile(file, data);
  return file;
}

/**
 * Mark the guide as deliberately paused (#619, the 20-min pause step): keeps
 * token/lastStep/lastStepTs, refreshes `ts` so the token stays valid for the
 * resume, and sets `paused: true` so stop.flow.guard lets the turn end. A
 * no-op returning null when there is no marker — pausing must never
 * resurrect a cleared guide.
 * @param {string} cwd
 * @param {number} [now]
 * @returns {string|null} the marker file path, or null when nothing was written
 */
function pauseGuide(cwd, now = Date.now()) {
  const prev = readMarker(cwd);
  if (!prev) return null;
  const file = guideActiveFilePath(cwd);
  const keep = typeof prev.token === 'string' && TOKEN_RE.test(prev.token);
  const token = keep ? prev.token : crypto.randomBytes(16).toString('hex');
  const data = { ts: now, token, paused: true };
  if (prev.lastStep !== undefined) data.lastStep = prev.lastStep;
  if (typeof prev.lastStepTs === 'number') data.lastStepTs = prev.lastStepTs;
  writeMarkerFile(file, data);
  return file;
}

/**
 * Recursively check whether a value carries a `value` key anywhere — Step
 * never legitimately needs one on disk (see module description).
 * @param {*} value
 * @returns {boolean}
 */
function hasValueField(value) {
  if (Array.isArray(value)) return value.some(hasValueField);
  if (value && typeof value === 'object') {
    return Object.prototype.hasOwnProperty.call(value, 'value') || Object.values(value).some(hasValueField);
  }
  return false;
}

/**
 * Record the most recently rendered Step object on the marker so a
 * resumed/compacted turn can recover it via `guide status`. A no-op (returns
 * null, writes nothing) when: there is no active marker to resume into (a
 * stray call must not resurrect a cleared guide, mirroring touchGuideToken),
 * the step carries a `value` field anywhere, or the step's JSON would make
 * the marker too large.
 * @param {string} cwd
 * @param {*} step
 * @param {number} [now]
 * @returns {string|null} the marker file path, or null when nothing was written
 */
function recordGuideStep(cwd, step, now = Date.now()) {
  const prev = readMarker(cwd);
  if (!prev) return null;
  if (hasValueField(step)) return null;
  let json;
  try {
    json = JSON.stringify(step);
  } catch {
    return null;
  }
  if (typeof json !== 'string' || json.length > MAX_LAST_STEP_JSON_LEN) return null;

  const file = guideActiveFilePath(cwd);
  const keep = typeof prev.token === 'string' && TOKEN_RE.test(prev.token);
  const token = keep ? prev.token : crypto.randomBytes(16).toString('hex');
  writeMarkerFile(file, { ts: now, token, lastStep: step, lastStepTs: now });
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
 * The guide's channel token (AUD-C007), or null when no marker with a token
 * exists. An expired marker still names its token — the overlay in the page
 * holds it until `guide clear` (see markGuideActive).
 */
function readGuideToken(cwd) {
  const data = readMarker(cwd);
  return data && typeof data.token === 'string' && TOKEN_RE.test(data.token) ? data.token : null;
}

/**
 * Finding 6: `payload step`/`payload wait`/`payload inject` call this on
 * every invocation so a guide running longer than GUIDE_ACTIVE_TTL_MS inside
 * a single turn never drops its token mid-loop — the marker is only ever
 * refreshed once per turn otherwise (at `guide active`), and the TTL is
 * measured from the LAST write. Refreshing here extends the window with the
 * SAME token (markGuideActive keeps the marker's token until `guide clear`;
 * it only mints one when there is no marker). An expired marker is revived
 * with its own token — a payload call means a guide is running. Returns null
 * (and touches nothing) when there is no marker, so a cleared guide is never
 * resurrected by a stray step/wait call.
 * @param {string} cwd
 * @param {number} [now]
 * @returns {string|null}
 */
function touchGuideToken(cwd, now = Date.now()) {
  const token = readGuideToken(cwd, now);
  if (!token) return null;
  markGuideActive(cwd, now);
  return token;
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

/**
 * The guide's poll loop is supposed to be running right now (#619): the
 * marker is fresh AND not paused. stop.flow.guard blocks a card-less turn end
 * once while this holds.
 * @param {string} cwd
 * @param {number} [now]
 * @returns {boolean}
 */
function isGuideLoopLive(cwd, now = Date.now()) {
  if (!isGuideActive(cwd, now)) return false;
  const data = readMarker(cwd);
  return !(data && data.paused === true);
}

/**
 * A resume/compaction-friendly snapshot of the marker — NEVER includes the
 * channel token (`web-guide.js guide status` prints this verbatim to
 * stdout, which can end up in a transcript).
 * @param {string} cwd
 * @param {number} [now]
 * @returns {{active: boolean, ageMinutes: number|null, lastStep: *, paused?: boolean}}
 *   `paused` is only present when a marker exists.
 */
function getGuideStatus(cwd, now = Date.now()) {
  const data = readMarker(cwd);
  if (!data || typeof data.ts !== 'number') {
    return { active: false, ageMinutes: null, lastStep: null };
  }
  const ageMinutes = Math.round(((now - data.ts) / 60000) * 100) / 100;
  return {
    active: now - data.ts <= GUIDE_ACTIVE_TTL_MS,
    ageMinutes,
    lastStep: data.lastStep !== undefined ? data.lastStep : null,
    paused: data.paused === true,
  };
}

module.exports = {
  GUIDE_ACTIVE_REL,
  GUIDE_ACTIVE_TTL_MS,
  guideActiveFilePath,
  markGuideActive,
  clearGuideActive,
  readGuideToken,
  touchGuideToken,
  isGuideActive,
  isGuideLoopLive,
  pauseGuide,
  recordGuideStep,
  hasValueField,
  getGuideStatus,
};
