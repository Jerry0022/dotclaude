/**
 * @module burn-state
 * @version 0.1.0
 * @plugin devops
 * @description Read-side helpers for a `/do-run burn` run, shared by
 *   `scripts/burn-plan.js` and the `prompt.burn.resume` hook:
 *
 *   - where BURN-STATE.json lives (the project root of the run's worktree);
 *   - whether a state describes a run that is still open (queue or lanes
 *     left, not finished);
 *   - whether the session behind a transcript was stopped by a usage limit.
 *
 *   The limit signal is the transcript's own record of the stop: when the
 *   5-hour or weekly limit hits, Claude Code writes a synthetic assistant
 *   line `{"type":"assistant","error":"rate_limit","isApiErrorMessage":true,
 *   "message":{"model":"<synthetic>","content":[{"type":"text","text":
 *   "You've hit your session limit · resets 10:50pm (Europe/Berlin)"}]}}`.
 *   Only the NEWEST main-chain assistant line counts: once the session has
 *   answered normally again, the stop is history.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = 'BURN-STATE.json';
const PREV_STATE_FILE = 'BURN-STATE.prev.json';

/** Tail bytes scanned for the newest assistant line — same budget as context-size.js. */
const TAIL_BYTES = 512 * 1024;

/** Phrases Claude Code uses when a plan limit stops a turn. */
const LIMIT_TEXT_RX = /hit your (?:session|weekly|usage|opus|sonnet)?\s*limit|usage limit reached|(?:5-hour|weekly|session|opus) limit reached|limit reached\s*[∙·•|]/i;

function statePath(root) {
  return path.join(root, STATE_FILE);
}

/**
 * @param {string} file absolute path of BURN-STATE.json
 * @returns {object|null} parsed state, or null when missing / unreadable
 */
function readStateFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A run is open while it is not finished and still has work queued or in
 * flight. A v1 state (no `status`) counts as open under the same rule — the
 * pre-v2 resume contract.
 */
function isOpenRun(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.status === 'finished') return false;
  const queue = Array.isArray(state.queue) ? state.queue.length : 0;
  const inFlight = Array.isArray(state.inFlight) ? state.inFlight.length : 0;
  return queue + inFlight > 0;
}

/** Short tally for questions and notices: `3 gelandet · 4 offen · 1 unklar`. */
function tally(state) {
  const n = (k) => (Array.isArray(state && state[k]) ? state[k].length : 0);
  return { done: n('done'), queue: n('queue'), inFlight: n('inFlight') };
}

function readTail(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function textOf(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join(' ');
}

/** Which limit stopped the turn, from its text. */
function limitKind(text) {
  if (/weekly/i.test(text)) return 'weekly';
  if (/session|5-hour/i.test(text)) return 'session';
  return 'unknown';
}

/**
 * Newest main-chain assistant line of a transcript slice, classified.
 * @param {string} text JSONL (may start mid-line)
 * @returns {{ limited: boolean, kind?: string, at?: string, text?: string }}
 */
function limitEvidenceFromText(text) {
  if (!text) return { limited: false };
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"assistant"')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant' || obj.isSidechain) continue;
    const body = textOf(obj.message);
    const limited = obj.error === 'rate_limit'
      || (obj.isApiErrorMessage === true && LIMIT_TEXT_RX.test(body));
    if (!limited) return { limited: false };
    return { limited: true, kind: limitKind(body), at: obj.timestamp || null, text: body.slice(0, 200) };
  }
  return { limited: false };
}

/**
 * Was the session behind `transcriptPath` stopped by a usage limit, with
 * nothing answered since?
 */
function limitEvidence(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return { limited: false };
  return limitEvidenceFromText(readTail(transcriptPath));
}

module.exports = {
  STATE_FILE,
  PREV_STATE_FILE,
  LIMIT_TEXT_RX,
  statePath,
  readStateFile,
  isOpenRun,
  tally,
  limitEvidence,
  limitEvidenceFromText,
};
