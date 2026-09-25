'use strict';
/**
 * @module run-contract-store
 * @version 0.1.0
 * @plugin devops
 * @description Run-contract persistence: paths, atomic JSON / JSONL io,
 *   lifecycle (arm / update / claim / record / close), expiry + archive and
 *   the pending-arm / batch-handoff markers. Split out of run-contract.js
 *   (AUD-016) — run-contract.js stays the facade every caller requires.
 *
 *   State lives in the WORK-TREE root (`project-root.js`), next to
 *   `strict-mode.json`:
 *     .claude/run-contract.json          header (atomic temp + rename writes)
 *     .claude/run-contract.events.jsonl  append-only events, one JSON per line
 *     .claude/run-contract.prev.json     archive of the replaced / expired one
 *     .claude/run-contract.pending       arm marker (do-run Skill ran, no answers yet)
 *     .claude/batch-handoff.json         do-batch fired, hand-off pending
 *   Every fs error is swallowed and behaves as "no contract".
 *   Kill switch: DOTCLAUDE_RUN_CONTRACT=off → no contract, no marker, no gate.
 */

const fs = require('fs');
const path = require('path');
const { projectClaudeDir } = require('./project-root');

const FILES = Object.freeze({
  header: 'run-contract.json',
  events: 'run-contract.events.jsonl',
  prev: 'run-contract.prev.json',
  pending: 'run-contract.pending',
  batch: 'batch-handoff.json',
});

// H-A4: the one path block messages name, and the one re-arm hint. LIB_PATH
// names run-contract.js (the facade / CLI entry) even though it is defined
// here, so every module can build the same hint without a circular require.
const LIB_PATH = path.join(__dirname, 'run-contract.js');
function rearmHint() {
  return `node "${LIB_PATH}" arm --mode <prompt|backlog|audit> --flow <interactive|autonomous> --ship <auto|manual> --passes <harden,polish|none>`;
}

const HOUR = 3600_000;
const EXPIRY_INTERACTIVE_H = 12;
const EXPIRY_AUTONOMOUS_H = 30;
const CARD_GRACE_MS = 15 * 60_000;
const PENDING_MAX_MS = 2 * HOUR;
const BATCH_MAX_MS = 6 * HOUR;
const ARCHIVE_EVENTS = 200;
const ARGS_MAX = 400;
const FOREIGN_GRACE_MS = 10 * 60_000;

const DEFAULT_HEADER = Object.freeze({
  v: 1,
  source: 'router',
  sessionId: null,
  mode: 'prompt',
  flow: 'interactive',
  ship: 'manual',
  strict: false,
  passes: ['harden', 'polish'],
  rethink: false,
  burn: false,
  presence: true,
  alsoAudit: false,
  items: [],
  milestones: [],
  auditResult: null,
  closedAt: null,
  closeReason: null,
  aborted: false,
});

// ── paths / io ─────────────────────────────────────────────────────────────

function disabled() {
  return String(process.env.DOTCLAUDE_RUN_CONTRACT || '').trim().toLowerCase() === 'off';
}

function fileIn(cwd, name) { return path.join(projectClaudeDir(cwd), name); }
function contractPath(cwd) { return fileIn(cwd, FILES.header); }
function eventsPath(cwd) { return fileIn(cwd, FILES.events); }
function prevPath(cwd) { return fileIn(cwd, FILES.prev); }
function pendingPath(cwd) { return fileIn(cwd, FILES.pending); }
function batchHandoffPath(cwd) { return fileIn(cwd, FILES.batch); }

function nowOf(opts) { return opts && typeof opts.now === 'number' ? opts.now : Date.now(); }

/**
 * Does a stored object (header or marker) belong to the session asking?
 * Unknown asking session → yes (CLI, tests). Stored id → must match. No
 * stored id → only while `at` is < 10 min old (Desktop copies the main
 * checkout's untracked `.claude/` into every new worktree — R3).
 */
function ownedBy(obj, sessionId, at, now) {
  if (!obj) return false;
  if (!sessionId) return true;
  if (obj.sessionId) return obj.sessionId === sessionId;
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t < FOREIGN_GRACE_MS;
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function writeJsonAtomic(file, obj) {
  // H-B12: `tmp` lives outside the try so a write that created the temp file
  // and then threw (ENOSPC / EPERM mid-write) does not leave it behind.
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    unlinkQuiet(tmp);
    return false;
  }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait */ }
}

/** writeJsonAtomic with one retry after 50 ms (Windows EPERM from AV / indexer). */
function writeJsonRetry(file, obj) {
  if (writeJsonAtomic(file, obj)) return true;
  sleepSync(50);
  return writeJsonAtomic(file, obj);
}

function appendLine(file, line) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, 'utf8');
    return true;
  } catch { return false; }
}

/** H-A7: append with one retry after 50 ms (AUD-009: Windows EPERM / EBUSY must not drop an event). */
function appendRetry(file, line) {
  if (appendLine(file, line)) return true;
  sleepSync(50);
  return appendLine(file, line);
}

function unlinkQuiet(file) { try { fs.unlinkSync(file); } catch { /* already gone */ } }

function strList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => String(x).trim()).filter(Boolean))];
}

function sanitize(h) {
  const out = { ...h };
  out.passes = strList(out.passes).filter(p => p === 'harden' || p === 'polish');
  out.items = strList(out.items).map(s => s.replace(/^#/, ''));
  out.milestones = strList(out.milestones);
  out.strict = !!out.strict;
  out.rethink = !!out.rethink;
  out.burn = !!out.burn;
  out.presence = out.presence !== false;
  out.alsoAudit = !!out.alsoAudit;
  if (out.unresolved) out.unresolved = true; else delete out.unresolved;
  if (!['prompt', 'backlog', 'audit'].includes(out.mode)) out.mode = 'prompt';
  if (!['interactive', 'autonomous'].includes(out.flow)) out.flow = 'interactive';
  if (!['auto', 'manual'].includes(out.ship)) out.ship = 'manual';
  return out;
}

function readRawContract(cwd) {
  const h = readJson(contractPath(cwd));
  // H-B6: normalised on read — a hand-edited / older header without the
  // `passes` / `items` arrays must not throw in the gates (pre's catch-all
  // would turn that into "allow every call").
  return h && h.v === 1 && typeof h.id === 'string' ? sanitize(h) : null;
}

function readEventLines(cwd) {
  let raw;
  try { raw = fs.readFileSync(eventsPath(cwd), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === 'object' && typeof ev.k === 'string') out.push(ev);
    } catch { /* torn line */ }
  }
  return out;
}

function eventsOf(cwd, header) {
  if (!header) return [];
  return readEventLines(cwd).filter(ev => !ev.c || ev.c === header.id);
}

/** Events of the contract currently on disk (active or closed). */
function events(cwd) {
  return eventsOf(cwd, readRawContract(cwd));
}

// ── lifecycle ──────────────────────────────────────────────────────────────

function expiryMs(header) {
  const long = header.flow === 'autonomous' || header.mode === 'backlog';
  return (long ? EXPIRY_AUTONOMOUS_H : EXPIRY_INTERACTIVE_H) * HOUR;
}

// RT2-R3: `block` (a gate refusal) and `measure` are neither work nor a
// boundary — they are written by hooks reacting to a call the contract
// still refuses, so a leftover contract that keeps getting probed (and kept
// refusing) would never reach its 12h/30h idle expiry if they counted.
// H-B10: `card` likewise — every rendered card (Q&A-only turns too) would
// otherwise reset the idle clock of a contract left open.
const NON_ACTIVITY_KINDS = new Set(['block', 'measure', 'card']);

function lastActivity(header, evs) {
  let last = Date.parse(header.armedAt) || 0;
  for (const ev of evs) {
    if (NON_ACTIVITY_KINDS.has(ev.k)) continue;
    const t = Date.parse(ev.t);
    if (t > last) last = t;
  }
  return last;
}

function isExpired(header, evs, now) {
  return now - lastActivity(header, evs) >= expiryMs(header);
}

/**
 * The active contract, or null (none, closed, expired, corrupt, kill switch).
 * @param {string} cwd
 * @param {{now?:number}} [opts]
 */
function readContract(cwd, opts = {}) {
  if (disabled()) return null;
  const h = readRawContract(cwd);
  if (!h || h.closedAt) return null;
  const now = nowOf(opts);
  if (!ownedBy(h, opts.sessionId, h.armedAt, now)) return null;
  if (isExpired(h, eventsOf(cwd, h), now)) return null;
  return h;
}

/** Active contract, or one closed / aborted within the last 15 minutes. */
function readContractForCard(cwd, opts = {}) {
  if (disabled()) return null;
  const h = readRawContract(cwd);
  if (!h) return null;
  const now = nowOf(opts);
  if (!ownedBy(h, opts.sessionId, h.armedAt, now)) return null;
  if (h.closedAt) {
    const t = Date.parse(h.closedAt);
    return Number.isFinite(t) && now - t <= CARD_GRACE_MS ? h : null;
  }
  return isExpired(h, eventsOf(cwd, h), now) ? null : h;
}

/** Move header + events to the archive and delete both. */
function archive(cwd, header, now) {
  try {
    const evs = eventsOf(cwd, header).slice(-ARCHIVE_EVENTS);
    writeJsonRetry(prevPath(cwd), { ...header, archivedAt: new Date(now).toISOString(), events: evs });
  } catch { /* best effort */ }
  unlinkQuiet(contractPath(cwd));
  unlinkQuiet(eventsPath(cwd));
}

/**
 * RT3-X2: a one-time notice that this session's contract expired unclosed
 * (a Q&A-only run: cards are no activity). Marks the header so it shows once;
 * the next write archives it anyway. → string | null
 */
function expiryNotice(cwd, opts = {}) {
  if (disabled() || !opts.sessionId) return null;
  const now = nowOf(opts);
  const h = readRawContract(cwd);
  if (!h || h.closedAt || h.expiryAnnounced || h.sessionId !== opts.sessionId) return null;
  if (!isExpired(h, eventsOf(cwd, h), now)) return null;
  if (!writeJsonRetry(contractPath(cwd), { ...h, expiryAnnounced: true })) return null;
  return `[run-contract] The run contract expired after ${expiryMs(h) / HOUR} h without work — its gates are off. Still in a do-run? Re-arm: ${rearmHint()}`;
}

/** Archive an expired header sitting on disk (the "next write" of spec A). */
function archiveIfExpired(cwd, now) {
  const h = readRawContract(cwd);
  if (h && !h.closedAt && isExpired(h, eventsOf(cwd, h), now)) {
    archive(cwd, h, now);
    return true;
  }
  return false;
}

function newId(now) {
  return `rc-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Arm a new contract. An existing header (active, closed or expired) is
 * archived first. Returns the written header, or null (kill switch / fs error).
 * @param {string} cwd
 * @param {object} header fields per spec A; missing ones take DEFAULT_HEADER
 * @param {{now?:number}} [opts]
 */
function arm(cwd, header = {}, opts = {}) {
  if (disabled()) return null;
  const now = nowOf(opts);
  const existing = readRawContract(cwd);
  const oldEvents = existing ? eventsOf(cwd, existing).slice(-ARCHIVE_EVENTS) : [];
  const h = sanitize({
    ...DEFAULT_HEADER,
    ...(header || {}),
    v: 1,
    id: newId(now),
    armedAt: new Date(now).toISOString(),
    closedAt: null,
    closeReason: null,
    aborted: false,
  });
  // The new header is written FIRST (temp + rename, one retry): a failed
  // rename leaves the old contract in place instead of no contract at all.
  if (!writeJsonRetry(contractPath(cwd), h)) return null;
  if (existing) {
    writeJsonRetry(prevPath(cwd), { ...existing, archivedAt: new Date(now).toISOString(), events: oldEvents });
  }
  unlinkQuiet(eventsPath(cwd));
  return h;
}

/** Merge `patch` into the active contract. Returns the new header or null. */
function update(cwd, patch = {}, opts = {}) {
  const now = nowOf(opts);
  archiveIfExpired(cwd, now);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  const rest = { ...(patch || {}) };
  delete rest.id; delete rest.armedAt; delete rest.v;
  delete rest.closedAt; delete rest.closeReason; delete rest.aborted;
  // Re-read right before the write: a parallel post hook may have closed it.
  const fresh = readRawContract(cwd);
  if (!fresh || fresh.id !== h.id) return null;
  const next = sanitize({ ...fresh, ...rest });
  return writeJsonRetry(contractPath(cwd), next) ? next : null;
}

/**
 * Adopt a fresh contract armed without a session id (CLI `arm`) for the
 * session asking, so it keeps gating that session after the 10-min grace.
 */
function claim(cwd, sessionId, opts = {}) {
  if (!sessionId || disabled()) return null;
  const h = readRawContract(cwd);
  if (!h || h.sessionId || h.closedAt) return null;
  if (!ownedBy(h, sessionId, h.armedAt, nowOf(opts))) return null;
  return update(cwd, { sessionId }, opts);
}

/**
 * Append one event to the active contract. `t` and `c` (contract id) are
 * added; skill names are normalized; args are capped at 400 chars; an `edit`
 * right after an `edit` is not written again.
 * @returns {object|null} the written event, or null (no contract / deduped / fs error)
 */
function record(cwd, event, opts = {}) {
  if (!event || typeof event.k !== 'string') return null;
  const now = nowOf(opts);
  archiveIfExpired(cwd, now);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  // Lazy require: breaks the store ↔ obligations circular dependency (both
  // modules are fully loaded by the time any contract call happens).
  const { skillName, currentSegment } = require('./run-contract-obligations');
  const ev = { ...event };
  if (ev.k === 'skill') {
    ev.name = skillName(ev.name);
    if (typeof ev.args === 'string' && ev.args.length > ARGS_MAX) ev.args = ev.args.slice(0, ARGS_MAX);
  }
  if (ev.k === 'edit') {
    const evs = eventsOf(cwd, h);
    const last = evs[evs.length - 1];
    if (last && last.k === 'edit') return null;
  }
  // RT2-R4: dedup `measure` against the last `measure`, not the last event
  // overall — a `measure` is now immediately followed by a `block` when the
  // gate still refuses, so "last event overall" was always that `block`
  // and never matched, and every retried release/card/branch call wrote two
  // lines (archive's last-200 slice then fills with retry noise). Likewise
  // dedup an identical consecutive `block {gate, open}` against the last
  // `block`.
  // H-B5: both dedups look only at the CURRENT segment — a new item whose
  // count equals the previous item's must still get its own `measure` (the
  // card reads the per-segment measure for `QA ✗` / `QA ?`).
  if (ev.k === 'measure') {
    const seg = currentSegment(h, eventsOf(cwd, h));
    const last = [...seg].reverse().find(e => e.k === 'measure');
    if (last && last.codeFiles === ev.codeFiles) return null;
  }
  if (ev.k === 'block') {
    const seg = currentSegment(h, eventsOf(cwd, h));
    const last = [...seg].reverse().find(e => e.k === 'block');
    if (last && last.gate === ev.gate && JSON.stringify(last.open) === JSON.stringify(ev.open)) return null;
  }
  ev.t = new Date(now).toISOString();
  ev.c = h.id;
  return appendRetry(eventsPath(cwd), JSON.stringify(ev) + '\n') ? ev : null;
}

/**
 * Close the active contract. The header stays on disk (the closing card still
 * reads it for 15 min) until the next arm archives it.
 * @param {string} cwd
 * @param {string} [reason]
 * @param {{aborted?:boolean, now?:number}} [opts]
 */
function close(cwd, reason, opts = {}) {
  const now = nowOf(opts);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  const next = {
    ...h,
    closedAt: new Date(now).toISOString(),
    closeReason: reason ? String(reason) : (opts.aborted ? 'aborted' : 'done'),
    aborted: !!opts.aborted,
  };
  return writeJsonRetry(contractPath(cwd), next) ? next : null;
}

// ── markers ────────────────────────────────────────────────────────────────

function markPendingArm(cwd, opts = {}) {
  if (disabled()) return null;
  const m = { at: new Date(nowOf(opts)).toISOString(), sessionId: opts.sessionId || null };
  if (typeof opts.args === 'string' && opts.args.trim()) m.args = opts.args.slice(0, ARGS_MAX);
  return writeJsonRetry(pendingPath(cwd), m) ? m : null;
}

function freshMarker(file, field, maxMs, opts = {}) {
  if (disabled()) return null;
  let raw;
  // H-B14b: a READ error (none, or a transient Windows EBUSY / EPERM —
  // AUD-009) keeps the file: a valid pending-arm marker must survive it.
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let m = null;
  try { m = JSON.parse(raw); } catch { /* corrupt */ }
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    // H-B14: a marker that was read but does not parse is removed — left in
    // place it defeats pre's existsSync fast path forever.
    unlinkQuiet(file);
    return null;
  }
  const t = Date.parse(m[field]);
  const now = nowOf(opts);
  if (!Number.isFinite(t) || now - t > maxMs) {
    unlinkQuiet(file);
    return null;
  }
  // A foreign session's marker is left alone (it expires on its own).
  return ownedBy(m, opts.sessionId, m[field], now) ? m : null;
}

/** The arm marker, or null (none, or older than 2 h → removed). */
function pendingArm(cwd, opts = {}) { return freshMarker(pendingPath(cwd), 'at', PENDING_MAX_MS, opts); }
function clearPendingArm(cwd) { unlinkQuiet(pendingPath(cwd)); }

function markBatchHandoff(cwd, opts = {}) {
  if (disabled()) return null;
  const m = { firedAt: new Date(nowOf(opts)).toISOString(), sessionId: opts.sessionId || null };
  return writeJsonRetry(batchHandoffPath(cwd), m) ? m : null;
}

/** The batch hand-off marker, or null (none, or older than 6 h → removed). */
function batchHandoffPending(cwd, opts = {}) { return freshMarker(batchHandoffPath(cwd), 'firedAt', BATCH_MAX_MS, opts); }
function clearBatchHandoff(cwd) { unlinkQuiet(batchHandoffPath(cwd)); }

module.exports = {
  LIB_PATH, rearmHint,
  disabled, contractPath, eventsPath, prevPath, pendingPath, batchHandoffPath,
  readContract, readContractForCard, readRawContract, expiryNotice, arm, update, claim, record, close, events,
  markPendingArm, pendingArm, clearPendingArm, markBatchHandoff, batchHandoffPending, clearBatchHandoff,
  // shared with the sibling modules (not part of the facade's public list)
  nowOf, eventsOf, readJson, strList, sanitize,
};
