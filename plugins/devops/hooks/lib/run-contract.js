#!/usr/bin/env node
'use strict';
/**
 * @module run-contract
 * @version 0.1.0
 * @plugin devops
 * @description State, answer parsing, obligations and CLI of the do-run RUN
 *   CONTRACT: what the user chose in the do-run router (passes, ship mode,
 *   auto-agents, qa, backlog triage + refine) is recorded by hooks and every
 *   tool call that would walk past an open obligation is refused.
 *
 *   Spec: docs/superpowers/specs/2026-09-24-run-contract-design.md (A, B, C, D, J).
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
 *
 * Exports (the hook wave imports these names):
 *   FILES, OBLIGATIONS, GATES, DEFAULT_HEADER               constants
 *   disabled()                                    → boolean  kill switch on
 *   contractPath(cwd) / eventsPath(cwd) / prevPath(cwd) / pendingPath(cwd) / batchHandoffPath(cwd) → string
 *   readContract(cwd, {now})                      → header | null (active only)
 *   readContractForCard(cwd, {now})               → header | null (active, or closed ≤ 15 min ago)
 *   readRawContract(cwd)                          → header | null (as on disk, no checks)
 *   arm(cwd, header, {now})                       → header | null (archives an existing one)
 *   update(cwd, patch, {now})                     → header | null
 *   record(cwd, event, {now})                     → event | null (adds t, c; dedupes edit runs)
 *   close(cwd, reason, {aborted, now})            → header | null
 *   events(cwd)                                   → event[] of the current contract
 *   markPendingArm(cwd, {sessionId, args, now}) / pendingArm(cwd, {now}) / clearPendingArm(cwd)
 *   markBatchHandoff(cwd, {sessionId, now}) / batchHandoffPending(cwd, {now}) / clearBatchHandoff(cwd)
 *   extractAnswers(toolResponse, toolInput)       → {questions, answers}
 *   isRouterCall(questions)                       → boolean
 *   parseRouterAnswers(questions, answers, {doRunArgs}) → header fields | null
 *   parseFollowUp(questions, answers)             → patch | null
 *   parseMachinePrompt(text)                      → header fields | null
 *   skillName(raw)                                → current skill name
 *   segments(contract, events)                    → event[][]
 *   currentSegment(contract, events)              → event[]
 *   segmentHasWork(seg)                           → boolean
 *   openObligations(contract, events, gate, ctx)  → [{ob, why, fix, item?}]
 *   formatBlock(contract, open, gate, {libPath})  → string (stderr block, spec D)
 *   chosenLine(contract)                          → string ("Backlog · Autonom · Ship automatisch · Harden + Polish")
 *   summaryForCard(contract, events, lang, ctx)   → string | null (card line, spec J)
 *   cli(argv, {cwd, now})                         → exit code (prints one JSON line)
 *
 * Deviations from the spec text (documented in the commit):
 *   - A backlog `branch` event is an item boundary only when the segment holds
 *     an edit or commit; `auto-agents` skill events after the last edit/commit
 *     move into the new segment (auto-agents usually creates the item branch).
 *     The branch gate likewise needs an edit/commit in the segment.
 *   - At release / card gates every segment obligation needs work in the
 *     segment (else the card after a successful release would re-block).
 *   - Events carry the contract id (`c`); `events()` ignores foreign lines.
 *   - The archive holds the header plus its last 200 events.
 */

const fs = require('fs');
const path = require('path');
const { projectClaudeDir } = require('./project-root');
const { canonicalSkillName } = require('./skill-names');

const FILES = Object.freeze({
  header: 'run-contract.json',
  events: 'run-contract.events.jsonl',
  prev: 'run-contract.prev.json',
  pending: 'run-contract.pending',
  batch: 'batch-handoff.json',
});

const OBLIGATIONS = Object.freeze(['auto-agents', 'harden', 'polish', 'qa', 'do-ship', 'refine', 'triage']);
const GATES = Object.freeze(['edit', 'commit', 'branch', 'auto-agents', 'release', 'card']);

const HOUR = 3600_000;
const EXPIRY_INTERACTIVE_H = 12;
const EXPIRY_AUTONOMOUS_H = 30;
const CARD_GRACE_MS = 15 * 60_000;
const PENDING_MAX_MS = 2 * HOUR;
const BATCH_MAX_MS = 6 * HOUR;
const ARCHIVE_EVENTS = 200;
const ARGS_MAX = 400;
const FOREIGN_GRACE_MS = 10 * 60_000;
const MERGE_WINDOW_MS = 30 * 60_000;

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
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    try { fs.renameSync(tmp, file); } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* gone */ }
      throw err;
    }
    return true;
  } catch { return false; }
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

function unlinkQuiet(file) { try { fs.unlinkSync(file); } catch { /* already gone */ } }

function readRawContract(cwd) {
  const h = readJson(contractPath(cwd));
  return h && h.v === 1 && typeof h.id === 'string' ? h : null;
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

function lastActivity(header, evs) {
  let last = Date.parse(header.armedAt) || 0;
  for (const ev of evs) {
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
    writeJsonAtomic(prevPath(cwd), { ...header, archivedAt: new Date(now).toISOString(), events: evs });
  } catch { /* best effort */ }
  unlinkQuiet(contractPath(cwd));
  unlinkQuiet(eventsPath(cwd));
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
    writeJsonAtomic(prevPath(cwd), { ...existing, archivedAt: new Date(now).toISOString(), events: oldEvents });
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
  const ev = { ...event };
  if (ev.k === 'skill') {
    ev.name = skillName(ev.name);
    if (typeof ev.args === 'string' && ev.args.length > ARGS_MAX) ev.args = ev.args.slice(0, ARGS_MAX);
  }
  if (ev.k === 'edit' || ev.k === 'measure') {
    const evs = eventsOf(cwd, h);
    const last = evs[evs.length - 1];
    if (last && last.k === ev.k && (ev.k === 'edit' || last.codeFiles === ev.codeFiles)) return null;
  }
  ev.t = new Date(now).toISOString();
  ev.c = h.id;
  try {
    fs.mkdirSync(path.dirname(eventsPath(cwd)), { recursive: true });
    fs.appendFileSync(eventsPath(cwd), JSON.stringify(ev) + '\n', 'utf8');
    return ev;
  } catch { return null; }
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
  return writeJsonAtomic(contractPath(cwd), next) ? next : null;
}

// ── markers ────────────────────────────────────────────────────────────────

function markPendingArm(cwd, opts = {}) {
  if (disabled()) return null;
  const m = { at: new Date(nowOf(opts)).toISOString(), sessionId: opts.sessionId || null };
  if (typeof opts.args === 'string' && opts.args.trim()) m.args = opts.args.slice(0, ARGS_MAX);
  return writeJsonAtomic(pendingPath(cwd), m) ? m : null;
}

function freshMarker(file, field, maxMs, opts = {}) {
  if (disabled()) return null;
  const m = readJson(file);
  if (!m) return null;
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
  return writeJsonAtomic(batchHandoffPath(cwd), m) ? m : null;
}

/** The batch hand-off marker, or null (none, or older than 6 h → removed). */
function batchHandoffPending(cwd, opts = {}) { return freshMarker(batchHandoffPath(cwd), 'firedAt', BATCH_MAX_MS, opts); }
function clearBatchHandoff(cwd) { unlinkQuiet(batchHandoffPath(cwd)); }

// ── answer extraction ──────────────────────────────────────────────────────

/** Header guessed from a question text (text-only answer forms carry no header). */
const QUESTION_HEADERS = [
  [/was soll dieser run/i, 'Was?'],
  [/bleibst du erreichbar|bist du dabei|wer shippt/i, 'Ablauf?'],
  [/wie weit darf die änderung/i, 'Umfang?'],
  [/welche durchgänge/i, 'Durchgänge?'],
];

function guessHeader(question) {
  for (const [re, h] of QUESTION_HEADERS) if (re.test(question)) return h;
  return null;
}

function parseAnswerText(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  const re = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

function textOf(resp) {
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(textOf).join('\n');
  if (resp && typeof resp === 'object') {
    if (typeof resp.text === 'string') return resp.text;
    if (resp.content !== undefined) return textOf(resp.content);
    if (typeof resp.result === 'string') return resp.result;
  }
  return '';
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/**
 * `{questions, answers}` from an AskUserQuestion PostToolUse payload (or a
 * transcript `toolUseResult`). Answers: `tool_response.answers` →
 * `tool_input.answers` → text form `"<question>"="<answer>"`. Without
 * questions, they are synthesized from the answer keys (header guessed).
 */
function extractAnswers(toolResponse, toolInput) {
  const resp = toolResponse;
  const input = isPlainObject(toolInput) ? toolInput : {};
  let questions = Array.isArray(input.questions) ? input.questions
    : (isPlainObject(resp) && Array.isArray(resp.questions) ? resp.questions : []);
  let answers = null;
  if (isPlainObject(resp) && isPlainObject(resp.answers)) answers = resp.answers;
  else if (isPlainObject(input.answers)) answers = input.answers;
  else {
    const parsed = parseAnswerText(textOf(resp));
    answers = Object.keys(parsed).length ? parsed : {};
  }
  if (!questions.length) {
    questions = Object.keys(answers).map(q => ({ question: q, header: guessHeader(q) }));
  }
  return { questions, answers };
}

// ── router parsing ─────────────────────────────────────────────────────────

const RECOMMENDED_RE = /\s*\((?:recommended|empfohlen)\)\s*/gi;
function cleanLabel(s) { return String(s == null ? '' : s).replace(RECOMMENDED_RE, ' ').replace(/\s+/g, ' ').trim(); }
function hasRecommended(s) { return /\((?:recommended|empfohlen)\)/i.test(String(s || '')); }

function headerOf(q) { return q && typeof q.header === 'string' ? q.header.trim() : (q && q.question ? guessHeader(q.question) : null); }

/** English / alternative router headers → the canonical German key. */
const HEADER_ALIASES = {
  what: 'was', flow: 'ablauf', scope: 'umfang', passes: 'durchgänge',
  result: 'ergebnis', 'audit scope': 'audit-umfang', 'audit-scope': 'audit-umfang', 'pc after': 'pc danach',
};

/** Header normalised: NFC, trimmed, trailing `?` stripped, case-folded, aliases mapped. */
function canonHeader(h) {
  if (typeof h !== 'string') return '';
  const s = h.normalize('NFC').trim().replace(/\s*\?+$/, '').trim().toLowerCase().replace(/\s+/g, ' ');
  return HEADER_ALIASES[s] || s;
}

function findQuestion(questions, header) {
  const want = canonHeader(header);
  return (questions || []).find(q => canonHeader(headerOf(q)) === want) || null;
}

function optionLabels(q) {
  return Array.isArray(q && q.options) ? q.options.map(o => (typeof o === 'string' ? o : o && o.label) || '').filter(Boolean) : [];
}

/** Raw answer value for a question: keyed by question text, else by header. */
function answerFor(answers, q) {
  if (!answers || !q) return undefined;
  if (q.question && Object.prototype.hasOwnProperty.call(answers, q.question)) return answers[q.question];
  const h = headerOf(q);
  if (h && Object.prototype.hasOwnProperty.call(answers, h)) return answers[h];
  return undefined;
}

/** Answer → list of cleaned tokens. A string that is no exact option label is split on `,`. */
function answerTokens(value, q) {
  if (value == null) return [];
  const labels = optionLabels(q).map(cleanLabel);
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const v of list) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (labels.includes(cleanLabel(s)) || !s.includes(',')) out.push(cleanLabel(s));
    else for (const part of s.split(',')) { const c = cleanLabel(part); if (c) out.push(c); }
  }
  return out;
}

function isRouterCall(questions) {
  if (!Array.isArray(questions)) return false;
  return !!findQuestion(questions, 'Durchgänge?') || (!!findQuestion(questions, 'Ablauf?') && !!findQuestion(questions, 'Umfang?'));
}

const Q1_FIXED = ['prompt', 'audit', 'backlog'];

function modeOfLabel(label) {
  const s = label.toLowerCase();
  if (/prompt/.test(s)) return 'prompt';
  if (/audit/.test(s)) return 'audit';
  if (/backlog/.test(s)) return 'backlog';
  return null;
}

/** Q1 tokens → {mode, alsoAudit} or null. Handles free text like "1 und 2". */
function parseQ1(tokens, q) {
  const named = new Set();
  const labels = optionLabels(q).map(cleanLabel);
  for (const tok of tokens) {
    const direct = modeOfLabel(tok);
    if (direct) { named.add(direct); }
    for (const m of tok.matchAll(/(?<!\d)([1-3])(?!\d)/g)) {
      const idx = Number(m[1]) - 1;
      const byOption = labels[idx] ? modeOfLabel(labels[idx]) : null;
      named.add(byOption || Q1_FIXED[idx]);
    }
  }
  if (!named.size) return null;
  if (named.has('prompt')) return { mode: 'prompt', alsoAudit: named.has('audit') };
  if (named.has('audit')) return { mode: 'audit', alsoAudit: false };
  return { mode: 'backlog', alsoAudit: false };
}

function passFlagsOf(tokens, out) {
  for (const tok of tokens) {
    const s = tok.toLowerCase();
    if (/harden/.test(s)) out.passes.add('harden');
    if (/polish/.test(s)) out.passes.add('polish');
    if (/rethink/.test(s)) out.rethink = true;
    if (/budget|burn|verbrennen/.test(s)) out.burn = true;
  }
}

/** Fields implied by the do-run args (preset Q1). */
function argFields(doRunArgs) {
  const s = typeof doRunArgs === 'string' ? doRunArgs.trim() : '';
  const out = { mode: null, flow: null, burn: false, rethink: false };
  if (!s) return out;
  if (/--from=do-batch\b/i.test(s)) out.mode = 'prompt';
  const first = (s.split(/\s+/)[0] || '').toLowerCase();
  if (first === 'backlog') out.mode = out.mode || 'backlog';
  else if (first === 'audit') out.mode = out.mode || 'audit';
  else if (first === 'autonomous') out.flow = 'autonomous';
  else if (first === 'burn') out.burn = true;
  else if (first === 'rethink') out.rethink = true;
  return out;
}

/**
 * Header fields from the do-run router's answers (spec B), or null when the
 * call is not the router.
 * @param {object[]} questions AskUserQuestion `questions`
 * @param {object} answers keyed by question text (or header)
 * @param {{doRunArgs?:string}} [opts]
 */
function parseRouterAnswers(questions, answers, opts = {}) {
  if (!isRouterCall(questions)) return null;
  const a = answers || {};
  const args = argFields(opts.doRunArgs);
  const out = {
    mode: 'prompt', alsoAudit: false, flow: 'interactive', ship: 'manual', strict: false,
    passes: ['harden', 'polish'], rethink: args.rethink, burn: args.burn,
  };

  const answered = [];
  const q1 = findQuestion(questions, 'Was?');
  const q1r = q1 ? parseQ1(answerTokens(answerFor(a, q1), q1), q1) : null;
  const hint = followUpModeHint(questions);
  out.modeFrom = 'default';
  if (q1r) { out.mode = q1r.mode; out.alsoAudit = q1r.alsoAudit; out.modeFrom = 'q1'; answered.push('mode', 'alsoAudit', 'modeFrom'); }
  else if (args.mode) { out.mode = args.mode; out.modeFrom = 'args'; }
  else if (hint) { out.mode = hint; out.modeFrom = 'follow-up'; }

  const q2 = findQuestion(questions, 'Ablauf?');
  const q2t = q2 ? answerTokens(answerFor(a, q2), q2).join(' ') : '';
  if (q2t) {
    const s = q2t.toLowerCase();
    if (/^\s*(autonom|weg|away)/.test(s)) out.flow = 'autonomous';
    else if (/^\s*(interaktiv|dabei|interactive|present|with you|here)/.test(s)) out.flow = 'interactive';
    else if (/autonom|\bweg\b|\baway\b/.test(s)) out.flow = 'autonomous';
    if (/ship automatisch|ship automatic|ship auto\b/.test(s)) out.ship = 'auto';
    else if (/ship manuell|ship manual/.test(s)) out.ship = 'manual';
    answered.push('flow', 'ship');
  } else if (args.flow) out.flow = args.flow;

  const q3 = findQuestion(questions, 'Umfang?');
  const q3t = q3 ? answerTokens(answerFor(a, q3), q3).join(' ').toLowerCase() : '';
  if (/strikt|strict|nur das|only this|just this/.test(q3t)) out.strict = true;
  if (q3t) answered.push('strict');

  const q4 = findQuestion(questions, 'Durchgänge?');
  if (q4) {
    const tokens = answerTokens(answerFor(a, q4), q4);
    const r = parseQ4(tokens, q4);
    out.passes = r.passes;
    out.rethink = out.rethink || r.rethink;
    out.burn = out.burn || r.burn;
    out.unresolved = r.unresolved;
    if (tokens.length) answered.push('passes', 'rethink', 'burn', 'unresolved');
  }
  Object.defineProperty(out, 'answered', { value: answered, enumerable: false });
  return out;
}

const PLACEHOLDER_RE = /^(something else|other|etwas anderes|sonstiges|andere)$/i;
const NONE_RE = /^(keine?|none|nichts|no|no passes)(\s+(durchgänge|passes))?$/i;
const NEG_RE = /^(?:ohne|kein(?:e|en)?|without|no)\s+(.+)$/i;

/**
 * Q4 tokens → {passes, rethink, burn, unresolved} (R7). Empty → the
 * recommended set. `ohne X` / `kein X` / `without X` / `no X` excludes X.
 * An unrecognised or Other-placeholder token → the recommended set (minus
 * exclusions) when no pass was named, and `unresolved: true` either way.
 */
function parseQ4(tokens, q4) {
  const rec = { passes: new Set(), rethink: false, burn: false };
  const recLabels = optionLabels(q4).filter(hasRecommended);
  if (recLabels.length) passFlagsOf(recLabels, rec);
  else { rec.passes.add('harden'); rec.passes.add('polish'); }
  const recommended = ['harden', 'polish'].filter(p => rec.passes.has(p));
  if (!tokens.length) return { passes: recommended, rethink: rec.rethink, burn: rec.burn, unresolved: false };
  if (tokens.some(t => NONE_RE.test(t.trim()))) return { passes: [], rethink: false, burn: false, unresolved: false };
  const flags = { passes: new Set(), rethink: false, burn: false };
  const neg = new Set();
  let unresolved = false;
  let named = false;
  for (const tok of tokens) {
    const t = tok.trim();
    if (PLACEHOLDER_RE.test(t)) { unresolved = true; continue; }
    const nm = t.match(NEG_RE);
    if (nm) {
      const f = { passes: new Set(), rethink: false, burn: false };
      passFlagsOf([nm[1]], f);
      if (!f.passes.size) unresolved = true;
      f.passes.forEach(p => neg.add(p));
      continue;
    }
    const before = flags.passes.size + Number(flags.rethink) + Number(flags.burn);
    passFlagsOf([t], flags);
    const after = flags.passes.size + Number(flags.rethink) + Number(flags.burn);
    if (after === before) unresolved = true;
    else named = true;
  }
  let passes;
  if (flags.passes.size) passes = ['harden', 'polish'].filter(p => flags.passes.has(p) && !neg.has(p));
  else if (neg.size || unresolved || !named) passes = recommended.filter(p => !neg.has(p));
  else passes = [];
  return { passes, rethink: flags.rethink, burn: flags.burn, unresolved };
}

/**
 * Only the fields a router-shaped call actually answered (R7 merge): a
 * later call carrying some of the router headers updates just those.
 */
function answeredFields(fields) {
  const out = {};
  for (const k of (fields && fields.answered) || []) if (fields[k] !== undefined) out[k] = fields[k];
  return out;
}

/** A router call that lacks one of Ablauf / Umfang / Durchgänge. */
function isPartialRouterCall(questions) {
  return isRouterCall(questions) && !['Ablauf?', 'Umfang?', 'Durchgänge?'].every(h => findQuestion(questions, h));
}

/**
 * A partial router call of this session within 30 min of arming MERGES into
 * the active contract (R7). Returns the updated header, or null (→ arm).
 */
function mergeRouterAnswers(cwd, questions, fields, opts = {}) {
  if (!fields || !isPartialRouterCall(questions)) return null;
  const now = nowOf(opts);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  const armed = Date.parse(h.armedAt);
  if (!Number.isFinite(armed) || now - armed > MERGE_WINDOW_MS) return null;
  return update(cwd, answeredFields(fields), { now, sessionId: opts.sessionId });
}

/** Mode a follow-up header implies (Q1 was preset away): backlog | audit | null. */
function followUpModeHint(questions) {
  let hint = null;
  for (const q of Array.isArray(questions) ? questions : []) {
    const h = canonHeader(headerOf(q));
    if (h === 'milestones' || /^issues/.test(h)) return 'backlog';
    if (h === 'ergebnis' || h === 'audit-umfang') hint = hint || 'audit';
  }
  return hint;
}

/** Does the call carry a question with this (canonical) header? */
function hasHeader(questions, key) {
  return (Array.isArray(questions) ? questions : []).some(q => canonHeader(headerOf(q)) === canonHeader(key));
}

/**
 * Apply a follow-up patch to the active contract. Its `modeHint` upgrades a
 * prompt-mode contract whose mode was only defaulted (no Q1 answer, no do-run
 * args) and that was armed ≤ 30 min ago in this session (R2).
 */
function applyFollowUp(cwd, patch, opts = {}) {
  if (!patch) return null;
  const now = nowOf(opts);
  const h = readContract(cwd, { now, sessionId: opts.sessionId });
  if (!h) return null;
  const p = { ...patch };
  const hint = p.modeHint;
  delete p.modeHint;
  const armed = Date.parse(h.armedAt);
  if (hint && h.mode === 'prompt' && h.modeFrom === 'default' && Number.isFinite(armed) && now - armed <= MERGE_WINDOW_MS) {
    p.mode = hint;
    p.alsoAudit = false;
    p.modeFrom = 'follow-up';
  }
  return update(cwd, p, { now, sessionId: opts.sessionId });
}

/**
 * Patch from the router's follow-up call (spec B), or null when the call
 * carries none of its headers. `modeHint` names the mode its headers imply.
 */
function parseFollowUp(questions, answers) {
  if (!Array.isArray(questions)) return null;
  const a = answers || {};
  const patch = {};
  let hit = false;
  for (const q of questions) {
    const h = canonHeader(headerOf(q));
    const tokens = answerTokens(answerFor(a, q), q);
    if (/^ergebnis$/i.test(h)) {
      hit = true;
      const s = tokens.join(' ').toLowerCase();
      if (/concept/.test(s)) { patch.auditResult = 'concept'; patch.passes = []; }
      else if (/umsetzen|implement/.test(s)) patch.auditResult = 'implement';
    } else if (/^milestones$/i.test(h)) {
      hit = true;
      patch.milestones = tokens;
    } else if (/^issues/i.test(h)) {
      hit = true;
      const nums = [];
      for (const t of tokens) for (const m of t.matchAll(/#(\d+)/g)) nums.push(m[1]);
      patch.items = [...new Set([...(patch.items || []), ...nums])];
    } else if (/^pc danach$/i.test(h)) {
      hit = true;
      patch.pcAfter = tokens.join(', ') || null;
    } else if (/^audit-umfang$/i.test(h)) {
      hit = true;
    }
  }
  if (!hit) return null;
  const hint = followUpModeHint(questions);
  if (hint) patch.modeHint = hint;
  return patch;
}

// ── machine prompts ────────────────────────────────────────────────────────

function kvPairs(text) {
  const out = {};
  for (const m of text.matchAll(/\b([A-Za-z]+)=(\S*)/g)) {
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key] = m[2].replace(/[,.;]+$/, '');
  }
  return out;
}

const YES_RE = /^(yes|y|true|on|ja|1)$/i;

/**
 * Header fields from a `RUN_BACKLOG_AUTOSTART:` / `AUTONOMOUS_AUTOSTART:`
 * prompt (spec G), or null for any other text.
 */
function parseMachinePrompt(text) {
  if (typeof text !== 'string') return null;
  const backlog = /^\s*RUN_BACKLOG_AUTOSTART\s*:/i.test(text);
  const autonomous = !backlog && /^\s*AUTONOMOUS_AUTOSTART\s*:/i.test(text);
  if (!backlog && !autonomous) return null;
  const kv = kvPairs(text);
  const out = { source: 'machine', flow: 'autonomous' };
  if (backlog) out.mode = 'backlog';
  else out.mode = /^audit/i.test(kv.mode || '') ? 'audit' : 'prompt';
  if (kv.ship) {
    if (/^auto/i.test(kv.ship)) out.ship = 'auto';
    else if (/^man/i.test(kv.ship)) out.ship = 'manual';
  }
  if (kv.passes !== undefined) {
    out.passes = /^(none|keine|)$/i.test(kv.passes) ? []
      : kv.passes.split(',').map(s => s.trim().toLowerCase()).filter(p => p === 'harden' || p === 'polish');
  }
  if (kv.strict) out.strict = /^(on|yes|true|an)$/i.test(kv.strict);
  if (kv.queue) out.items = kv.queue.split(',').map(s => s.trim().replace(/^#/, '')).filter(s => /^\d+$/.test(s));
  if (kv.burnMode) out.burn = YES_RE.test(kv.burnMode);
  if (kv.phase) {
    out.phase = kv.phase.toLowerCase();
    if (out.phase === 'presence') out.presence = false;
  }
  return out;
}

/**
 * Patch for an ACTIVE same-session contract from a machine prompt (R5): only
 * ship / passes / strict / items / presence are refreshed, the mode never
 * changes — except `RUN_BACKLOG_AUTOSTART` (forces backlog) and
 * `mode=analyze` over an audit contract (audit as concept: passes cleared).
 */
function machinePatch(active, text) {
  const fields = parseMachinePrompt(text);
  if (!fields) return null;
  const patch = {};
  for (const k of ['ship', 'passes', 'strict', 'items', 'presence']) {
    if (fields[k] !== undefined) patch[k] = fields[k];
  }
  if (/^\s*RUN_BACKLOG_AUTOSTART\s*:/i.test(text)) patch.mode = 'backlog';
  else if (active && active.mode === 'audit' && /^analy/i.test(kvPairs(text).mode || '')) {
    patch.passes = [];
    patch.auditResult = 'concept';
  }
  return patch;
}

// ── segments / obligations ─────────────────────────────────────────────────

/** Current skill name of a raw invocation name (`devops:tune-harden` → `auto-harden`). */
function skillName(raw) {
  try { return canonicalSkillName(String(raw || '')); } catch { return String(raw || '').toLowerCase(); }
}

function isSkill(ev, name) { return ev && ev.k === 'skill' && skillName(ev.name) === name; }
function isEditWork(ev) { return ev && (ev.k === 'edit' || ev.k === 'commit'); }

function segmentHasWork(seg) {
  return Array.isArray(seg) && seg.some(ev => isEditWork(ev) || isSkill(ev, 'auto-agents'));
}
function segmentHasEditWork(seg) { return Array.isArray(seg) && seg.some(isEditWork); }

/**
 * Item segments. Boundary: `release` with ok:true (it closes its segment);
 * in backlog mode a `branch` event after an edit/commit starts a new segment
 * (trailing auto-agents skill events move along).
 * @returns {object[][]} at least one (possibly empty) segment
 */
function segments(contract, evs) {
  const backlog = !!contract && contract.mode === 'backlog';
  const out = [[]];
  for (const ev of Array.isArray(evs) ? evs : []) {
    let cur = out[out.length - 1];
    if (backlog && ev.k === 'branch' && segmentHasEditWork(cur)) {
      let lastWork = -1;
      cur.forEach((e, i) => { if (isEditWork(e)) lastWork = i; });
      const carry = cur.filter((e, i) => i > lastWork && isSkill(e, 'auto-agents'));
      out[out.length - 1] = cur.filter((e, i) => !(i > lastWork && isSkill(e, 'auto-agents')));
      out.push([...carry, ev]);
      continue;
    }
    cur.push(ev);
    if ((ev.k === 'release' && ev.ok === true) || ev.k === 'park') out.push([]);
  }
  return out;
}

function currentSegment(contract, evs) {
  const segs = segments(contract, evs);
  return segs[segs.length - 1];
}

function argsOf(ev) { return typeof ev.args === 'string' ? ev.args : ''; }
function passDone(seg, name) {
  return seg.some(ev => isSkill(ev, name) && !/--invoked-by=ship\b/.test(argsOf(ev)));
}
function isQaAgent(ev) {
  if (!ev || ev.k !== 'agent') return false;
  const t = String(ev.type || '').toLowerCase();
  return t === 'devops:qa' || t === 'qa' || t.endsWith(':qa');
}
function skipOf(list, ob, item) {
  const itemOk = (ev) => item === undefined || String(ev.item) === String(item);
  return list.find(ev => ev.k === 'skip' && ev.ob === ob && itemOk(ev))
    || list.find(ev => ev.k === 'park' && ob !== 'triage' && itemOk(ev))
    || null;
}

/** Latest `measure` event of a segment: {codeFiles:n|null} or undefined. */
function measureOf(seg) {
  for (let i = seg.length - 1; i >= 0; i--) if (seg[i].k === 'measure') return seg[i];
  return undefined;
}

/** ctx.codeFilesChanged, else the segment's latest measure (R9). */
function codeFilesOf(seg, ctx) {
  if (ctx && typeof ctx.codeFilesChanged === 'number') return ctx.codeFilesChanged;
  const m = measureOf(seg || []);
  return m && typeof m.codeFiles === 'number' ? m.codeFiles : null;
}
function issueNamed(args, n) {
  const re = new RegExp(`#${n}(?!\\d)|\\bissues?\\b[^\\n]*?(?<!\\d)${n}(?!\\d)`, 'i');
  return re.test(args);
}

function qaApplies(contract, ctx, seg) {
  const n = codeFilesOf(seg, ctx);
  if (n === null || contract.mode === 'audit') return false;
  return contract.mode === 'backlog' ? n >= 1 : n > 5;
}

/** Per-ob state in a segment: 'done' | 'skipped' | 'open' | null (not applicable). */
function obState(contract, seg, allEvs, ob, gate, ctx) {
  const work = segmentHasWork(seg);
  const editGate = gate === 'edit' || gate === 'commit';
  const skip = skipOf(seg, ob);
  const res = (done) => (done ? 'done' : skip ? 'skipped' : 'open');
  switch (ob) {
    case 'auto-agents':
      if (contract.mode === 'audit') return null;
      if (!editGate && !work) return null;
      return res(seg.some(ev => isSkill(ev, 'auto-agents')));
    case 'harden':
    case 'polish':
      if (!contract.passes.includes(ob) || !work) return null;
      return res(passDone(seg, `auto-${ob}`));
    case 'qa':
      if (!work || !qaApplies(contract, ctx, seg)) return null;
      return res(seg.some(isQaAgent));
    case 'do-ship': {
      if (contract.ship !== 'auto' || !work) return null;
      if (gate === 'release') return res(seg.some(ev => isSkill(ev, 'do-ship')));
      return res(seg.some(ev => (ev.k === 'release' && ev.ok === true)
        || (ev.k === 'card' && (ev.variant === 'ship-blocked' || ev.variant === 'aborted'))
        || (gate === 'summary' && isSkill(ev, 'do-ship'))));
    }
    case 'triage': {
      if (contract.mode !== 'backlog' || contract.presence === false) return null;
      const done = allEvs.some(ev => ev.k === 'agent');
      return done ? 'done' : skipOf(allEvs, 'triage') ? 'skipped' : 'open';
    }
    default:
      return null;
  }
}

const GATE_OBS = {
  edit: ['auto-agents'],
  commit: ['auto-agents'],
  branch: ['harden', 'polish', 'qa', 'do-ship'],
  'auto-agents': ['triage'],
  release: ['auto-agents', 'harden', 'polish', 'qa', 'do-ship', 'refine'],
  card: ['auto-agents', 'harden', 'polish', 'qa', 'do-ship', 'refine'],
};
const AUDIT_OBS = new Set(['harden', 'polish', 'do-ship']);

function invokedBy(contract) {
  return `--invoked-by=${contract.flow === 'autonomous' ? 'autonomous' : 'do-run'}${contract.strict ? ' --strict' : ''}`;
}

function queuedArg(contract, allEvs) {
  const shipped = allEvs.filter(ev => ev.k === 'release' && ev.ok === true).length;
  const N = Array.isArray(contract.items) && contract.items.length ? contract.items.length : '<N>';
  return `--queued=${shipped + 1}/${N}`;
}

function fixFor(contract, ob, allEvs, item) {
  switch (ob) {
    case 'auto-agents':
      return `Skill("devops:auto-agents", "--from=do-run --ship=${contract.ship} <task>")`;
    case 'harden': return `Skill("devops:auto-harden", "${invokedBy(contract)}")`;
    case 'polish': return `Skill("devops:auto-polish", "${invokedBy(contract)}")`;
    case 'qa': return 'Agent({ subagent_type: "devops:qa", prompt: "<verify this item\'s change>" })';
    case 'do-ship':
      return (contract.mode === 'backlog'
        ? `Skill("devops:do-ship", "${queuedArg(contract, allEvs)}")`
        : 'Skill("devops:do-ship")') + '   ← never the ship_* MCP tools directly';
    case 'refine': return `Skill("devops:auto-issue", "#${item} <refine before shipping>")`;
    case 'triage': return 'Agent(...) pre-triage agents per do-run modes/backlog.md Step 2';
    default: return '';
  }
}

const WHY = {
  'auto-agents': 'auto-agents decides the tier in a do-run run',
  harden: 'the user chose "Harden danach"',
  polish: 'the user chose "Polish danach"',
  qa: 'code files changed above the qa threshold',
  'do-ship': 'the user chose "Ship automatisch"',
  refine: 'backlog Step 2 refines every issue before it ships',
  triage: 'backlog Step 2 pre-triage runs before the first auto-agents',
};

/**
 * Obligations still open at `gate` (spec C / D).
 * @param {object} contract active header
 * @param {object[]} evs events of the contract
 * @param {'edit'|'commit'|'branch'|'auto-agents'|'release'|'card'} gate
 * @param {{codeFilesChanged?:number|null, closes?:string[]}} [ctx]
 * @returns {{ob:string, why:string, fix:string, item?:string}[]}
 */
function openObligations(contract, evs, gate, ctx = {}) {
  if (!contract || !GATE_OBS[gate]) return [];
  const all = Array.isArray(evs) ? evs : [];
  const seg = currentSegment(contract, all);
  let obs = GATE_OBS[gate];
  if (contract.mode === 'audit') obs = obs.filter(ob => AUDIT_OBS.has(ob));
  if (gate === 'branch' && (contract.mode !== 'backlog' || !segmentHasEditWork(seg))) return [];
  if (gate === 'auto-agents' && all.some(ev => isSkill(ev, 'auto-agents'))) return [];
  const out = [];
  for (const ob of obs) {
    if (ob === 'refine') {
      if (contract.mode !== 'backlog' || contract.presence === false) continue;
      // Ship manuell never reaches ship_release: the final card checks every item.
      const list = gate === 'card' ? (contract.ship === 'manual' ? contract.items : []) : (ctx && ctx.closes);
      const closes = strList(list).map(s => s.replace(/^#/, ''));
      for (const n of closes) {
        const done = all.some(ev => isSkill(ev, 'auto-issue') && issueNamed(argsOf(ev), n));
        if (!done && !skipOf(all, 'refine', n)) {
          out.push({ ob, item: n, why: `${WHY.refine} (#${n})`, fix: fixFor(contract, ob, all, n) });
        }
      }
      continue;
    }
    if (obState(contract, seg, all, ob, gate, ctx) === 'open') {
      out.push({ ob, why: WHY[ob], fix: fixFor(contract, ob, all) });
    }
  }
  return out;
}

// ── messages ───────────────────────────────────────────────────────────────

function chosenLine(c) {
  const mode = c.mode === 'backlog' ? 'Backlog' : c.mode === 'audit' ? 'Audit' : (c.alsoAudit ? 'Prompt umsetzen + Audit' : 'Prompt umsetzen');
  const parts = [mode, c.flow === 'autonomous' ? 'Autonom' : 'Interaktiv', c.ship === 'auto' ? 'Ship automatisch' : 'Ship manuell'];
  if (c.strict) parts.push('Strikt');
  const passes = (c.passes || []).map(p => (p === 'harden' ? 'Harden' : 'Polish'));
  parts.push(passes.length ? passes.join(' + ') : 'keine Durchgänge');
  if (c.rethink) parts.push('Rethink vorher');
  if (c.burn) parts.push('Budget verbrennen');
  return parts.join(' · ');
}

/**
 * The stderr block of a refused call (spec D). Stable prefix
 * `[run-contract] BLOCKED at <gate>`.
 */
function formatBlock(contract, open, gate, opts = {}) {
  const lib = opts.libPath || __filename;
  const list = Array.isArray(open) ? open : [];
  const scope = contract && contract.mode === 'backlog' ? 'Open for this item' : 'Open for this run';
  const names = list.map(o => (o.item ? `${o.ob} #${o.item}` : o.ob));
  const lines = [
    `[run-contract] BLOCKED at ${gate}: the run the user chose is not finished.`,
    `Chosen: ${contract ? chosenLine(contract) : 'unknown'}`,
    `${scope}: ${names.join(', ')}`,
    'Do now:',
    ...list.map(o => `  ${o.fix}`),
  ];
  const itemSkip = list.find(o => o.item);
  const skipArgs = itemSkip && list.every(o => o.item) ? `${itemSkip.ob} --item ${itemSkip.item}` : '<ob>';
  lines.push(`Conscious skip (shown on the card as ⚠): node "${lib}" skip ${skipArgs} --reason "<why>"`);
  if (contract && contract.mode === 'backlog') {
    lines.push(`Item parked (blocked ship / ⏸ Rückfrage): node "${lib}" park <item> --reason "<why>"`);
  }
  lines.push(`Run over with open steps (card shows ✗): node "${lib}" abort --reason "<why>"`);
  lines.push(`Only when every chosen step ran: node "${lib}" done`);
  return lines.join('\n');
}

function short(s, max = 40) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const CARD_LABELS = {
  de: { interactive: 'Interaktiv', autonomous: 'Autonom', auto: 'Ship auto', manual: 'Ship manuell', strict: 'Strikt', unresolved: 'Durchgänge ?', aborted: 'abgebrochen', none: 'keine Pflichten offen' },
  en: { interactive: 'Interactive', autonomous: 'Autonomous', auto: 'Ship auto', manual: 'Ship manual', strict: 'Strict', unresolved: 'Passes ?', aborted: 'aborted', none: 'no obligations' },
};
const OB_LABEL = { triage: 'Triage', refine: 'Refine', 'auto-agents': 'auto-agents', harden: 'Harden', polish: 'Polish', qa: 'QA', 'do-ship': 'do-ship' };

function renderStates(label, states, skipReason, aggregate) {
  const n = states.length;
  const done = states.filter(s => s === 'done').length;
  const skipped = states.filter(s => s === 'skipped').length;
  const unknown = states.filter(s => s === 'unknown').length;
  const open = n - done - skipped - unknown;
  if (!open && unknown) return `${label} ?`;
  const why = skipped && skipReason ? ` (${short(skipReason)})` : '';
  if (aggregate && n > 1) {
    if (open) return `${label} ${done}/${n} ✗`;
    if (skipped) return `${label} ${done}/${n} ⚠${why}`;
    return `${label} ${done}/${n}`;
  }
  if (open) return `${label} ✗`;
  if (skipped) return `${label} ⚠${why}`;
  return `${label} ✓`;
}

/**
 * The card line (spec J), e.g.
 * `🧾 Run · Backlog · Autonom · Ship auto — auto-agents ✓ · Harden ✓ · Polish ⚠ (keine UI) · QA ✓ · do-ship ✓`.
 * @param {object} contract header (active or recently closed)
 * @param {object[]} evs events
 * @param {'de'|'en'} [lang]
 * @param {{codeFilesChanged?:number|null}} [ctx] counts for the current segment (qa)
 * @returns {string|null}
 */
function summaryForCard(contract, evs, lang = 'de', ctx = {}) {
  if (!contract) return null;
  const L = CARD_LABELS[lang === 'en' ? 'en' : 'de'];
  const all = Array.isArray(evs) ? evs : [];
  const mode = contract.mode === 'backlog' ? 'Backlog' : contract.mode === 'audit' ? 'Audit' : (contract.alsoAudit ? 'Prompt + Audit' : 'Prompt');
  const head = ['🧾 Run', mode, L[contract.flow] || L.interactive, L[contract.ship] || L.manual];
  if (contract.strict) head.push(L.strict);
  if (contract.unresolved) head.push(L.unresolved);
  let line = head.join(' · ');
  if (contract.aborted) line += ` · ✗ ${L.aborted}${contract.closeReason && contract.closeReason !== 'aborted' ? ` (${short(contract.closeReason)})` : ''}`;

  const segs = segments(contract, all);
  const workSegs = segs.filter(segmentHasWork);
  const last = segs[segs.length - 1];
  const parts = [];

  const tri = obState(contract, [], all, 'triage', 'summary', ctx);
  if (tri && (all.some(ev => isSkill(ev, 'auto-agents')) || tri !== 'open')) {
    const s = skipOf(all, 'triage');
    parts.push(renderStates(OB_LABEL.triage, [tri], s && s.reason, false));
  }
  if (contract.mode === 'backlog' && contract.presence !== false && contract.items.length) {
    const st = contract.items.map(n => (all.some(ev => isSkill(ev, 'auto-issue') && issueNamed(argsOf(ev), n)) ? 'done'
      : skipOf(all, 'refine', n) ? 'skipped' : 'open'));
    const s = all.find(ev => ev.k === 'skip' && ev.ob === 'refine');
    parts.push(renderStates(OB_LABEL.refine, st, s && s.reason, true));
  }
  const aggregate = contract.mode === 'backlog';
  for (const ob of ['auto-agents', 'harden', 'polish', 'qa', 'do-ship']) {
    if (contract.mode === 'audit' && !AUDIT_OBS.has(ob)) continue;
    const states = [];
    let reason = null;
    for (const seg of workSegs) {
      let st;
      if (ob === 'qa') {
        if (seg.some(isQaAgent)) st = 'done';
        else if (skipOf(seg, 'qa')) st = 'skipped';
        else if (seg !== last) st = null;
        else if (qaApplies(contract, ctx, seg)) st = 'open';
        else st = measureOf(seg) && codeFilesOf(seg, ctx) === null ? 'unknown' : null;
      } else {
        st = obState(contract, seg, all, ob, 'summary', ctx);
      }
      if (!st) continue;
      states.push(st);
      const s = skipOf(seg, ob);
      if (st === 'skipped' && s && !reason) reason = s.reason;
    }
    if (states.length) parts.push(renderStates(OB_LABEL[ob], states, reason, aggregate));
  }
  return parts.length ? `${line} — ${parts.join(' · ')}` : line;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/**
 * CLI entry. Commands: status · skip <ob> [--item N] --reason "<why>" ·
 * done [--reason] · abort --reason · arm --mode --flow --ship --passes [--strict] [--items].
 * @returns {number} 0 success, 1 usage error / nothing to act on
 */
function cli(argv, opts = {}) {
  const { pos, flags } = parseArgv(Array.isArray(argv) ? argv : []);
  const cwd = typeof flags.cwd === 'string' ? flags.cwd : (opts.cwd || process.cwd());
  const now = nowOf(opts);
  const write = opts.out || ((o) => process.stdout.write(JSON.stringify(o) + '\n'));
  const fail = (error) => { write({ ok: false, error }); return 1; };
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  switch (pos[0]) {
    case 'status': {
      const c = readContract(cwd, { now });
      if (!c) { write({ ok: true, active: false, disabled: disabled(), path: contractPath(cwd) }); return 0; }
      const evs = eventsOf(cwd, c);
      const segs = segments(c, evs);
      write({ ok: true, active: true, contract: c, segment: segs.length, events: evs.length, open: openObligations(c, evs, 'release', {}) });
      return 0;
    }
    case 'skip': {
      const ob = pos[1];
      if (!ob || !OBLIGATIONS.includes(ob)) return fail(`usage: skip <${OBLIGATIONS.join('|')}> [--item N] --reason "<why>"`);
      if (!reason) return fail('skip needs --reason "<why>"');
      const item = flags.item !== undefined && flags.item !== true ? String(flags.item).replace(/^#/, '') : undefined;
      if (ob === 'refine' && !item) return fail('skip refine needs --item <N>');
      const ev = record(cwd, { k: 'skip', ob, reason: short(reason, 200), ...(item ? { item } : {}) }, { now });
      if (!ev) return fail('no active run contract');
      write({ ok: true, skipped: ob, item: item || null, reason: ev.reason });
      return 0;
    }
    case 'done': {
      const c = readContract(cwd, { now });
      const open = c ? openObligations(c, eventsOf(cwd, c), 'card', {}) : [];
      if (open.length) {
        const names = open.map(o => (o.item ? `${o.ob} #${o.item}` : o.ob)).join(', ');
        if (!reason) {
          return fail(`open obligations: ${names} — run them, skip <ob> --reason "<why>", or done --reason "<why>" (closes as aborted, card shows ✗)`);
        }
        const h = close(cwd, reason, { aborted: true, now });
        write({ ok: true, closed: !!h, aborted: true, open: names, id: h ? h.id : null });
        return 0;
      }
      const h = close(cwd, reason || 'done', { now });
      write({ ok: true, closed: !!h, id: h ? h.id : null });
      return 0;
    }
    case 'park': {
      const item = pos[1] ? String(pos[1]).replace(/^#/, '') : '';
      if (!item) return fail('usage: park <item> --reason "<why>"');
      if (!reason) return fail('park needs --reason "<why>"');
      const ev = record(cwd, { k: 'park', item, reason: short(reason, 200) }, { now });
      if (!ev) return fail('no active run contract');
      write({ ok: true, parked: item, reason: ev.reason });
      return 0;
    }
    case 'abort': {
      if (!reason) return fail('abort needs --reason "<status>: <why>"');
      const h = close(cwd, reason, { aborted: true, now });
      if (!h) return fail('no active run contract');
      write({ ok: true, aborted: true, id: h.id, reason });
      return 0;
    }
    case 'batch-clear': {
      if (!reason) return fail('batch-clear needs --reason "<why>"');
      const had = !!readJson(batchHandoffPath(cwd));
      clearBatchHandoff(cwd);
      write({ ok: true, cleared: had, reason: short(reason, 200) });
      return 0;
    }
    case 'arm': {
      const mode = flags.mode === undefined ? 'prompt' : flags.mode;
      const flow = flags.flow === undefined ? 'interactive' : flags.flow;
      const ship = flags.ship === undefined ? 'manual' : flags.ship;
      if (!['prompt', 'backlog', 'audit'].includes(mode)) return fail('--mode prompt|backlog|audit');
      if (!['interactive', 'autonomous'].includes(flow)) return fail('--flow interactive|autonomous');
      if (!['auto', 'manual'].includes(ship)) return fail('--ship auto|manual');
      let passes = ['harden', 'polish'];
      if (flags.passes !== undefined) {
        const raw = flags.passes === true ? '' : String(flags.passes);
        passes = /^(none|keine|)$/i.test(raw) ? [] : raw.split(',').map(s => s.trim().toLowerCase());
        if (passes.some(p => p !== 'harden' && p !== 'polish')) return fail('--passes harden,polish|none');
      }
      const items = typeof flags.items === 'string' ? flags.items.split(',') : [];
      const sessionId = typeof flags.session === 'string' ? flags.session : null;
      const h = arm(cwd, { source: 'cli', mode, modeFrom: 'cli', flow, ship, passes, strict: flags.strict === true || flags.strict === 'on', items, sessionId }, { now });
      if (!h) return fail(disabled() ? 'run contract disabled (DOTCLAUDE_RUN_CONTRACT=off)' : 'could not write the contract');
      write({ ok: true, armed: true, contract: h });
      return 0;
    }
    default:
      return fail('usage: run-contract.js status | skip <ob> [--item N] --reason "<why>" | park <item> --reason "<why>" | done [--reason "<why>"] | abort --reason "<why>" | batch-clear --reason "<why>" | arm --mode <m> --flow <f> --ship <s> --passes <p> [--strict] [--items 1,2] [--session <id>] [--cwd <path>]');
  }
}

if (require.main === module) {
  process.exit(cli(process.argv.slice(2)));
}

module.exports = {
  FILES, OBLIGATIONS, GATES, DEFAULT_HEADER,
  EXPIRY_INTERACTIVE_H, EXPIRY_AUTONOMOUS_H, CARD_GRACE_MS, PENDING_MAX_MS, BATCH_MAX_MS,
  disabled, contractPath, eventsPath, prevPath, pendingPath, batchHandoffPath,
  FOREIGN_GRACE_MS, MERGE_WINDOW_MS,
  ownedBy, claim, applyFollowUp, parseQ4, answeredFields, isPartialRouterCall, mergeRouterAnswers, measureOf, hasHeader, canonHeader, followUpModeHint, machinePatch,
  readContract, readContractForCard, readRawContract, arm, update, record, close, events,
  markPendingArm, pendingArm, clearPendingArm, markBatchHandoff, batchHandoffPending, clearBatchHandoff,
  extractAnswers, isRouterCall, parseRouterAnswers, parseFollowUp, parseMachinePrompt,
  skillName, segments, currentSegment, segmentHasWork, openObligations,
  formatBlock, chosenLine, summaryForCard, cli,
};
