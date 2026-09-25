/**
 * @module task-chips
 * @version 0.1.0
 * @description Task chips (the Desktop app's `spawn_task`) vs. the completion
 *   card's open points.
 *
 *   On the Desktop app Claude flags an out-of-scope finding with
 *   `mcp__ccd_session__spawn_task`: the app shows a chip, and one click starts
 *   the fix in its own session and worktree. The same finding then often landed
 *   on the card as an open point too ("… — Task-Chip bereit"), and the card's
 *   "Nachbessern" button answered it with "Ja, bitte". A user who had already
 *   clicked the chip fixed the topic twice — the second time in the session
 *   that had just shipped, which then had to ship again. Observed in 10 of the
 *   451 open points written between 2026-08-20 and 2026-09-25; every one of
 *   them said so itself.
 *
 *   The chip is the offer. So:
 *     - post.flow.completion records each chip of the session (title, tldr,
 *       task id from the result) and reminds Claude right there that the chip
 *       is the offer;
 *     - the card server drops every open point that says a chip or follow-up
 *       task exists for it, or names a live chip of this session by its title.
 *
 *   Detection is by the point's own words, never by topic similarity: a point
 *   that merely shares words with a chip ("ship the fix branch separately?")
 *   is a decision about this work and stays. Fail-open throughout — unreadable
 *   state drops nothing.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sessionFile, writeSessionFile } = require('./session-id');

const STATE_PREFIX = 'dotclaude-devops-task-chips';
const SPAWN_TOOL_RE = /^mcp__ccd_session__spawn_task$/;
const DISMISS_TOOL_RE = /^mcp__ccd_session__dismiss_task$/;
/** Chips kept per session — a long session flags a few dozen at most. */
const MAX_CHIPS = 40;
/** A chip file of another session id counts only this long (cwd fallback). */
const FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Shorter titles are too generic to recognise inside a sentence. */
const MIN_TITLE = 16;
/** A quoted fragment of a point must be at least this long to name a chip. */
const MIN_QUOTE = 12;

// ---------------------------------------------------------------------------
// The point's own words: "a chip / follow-up task exists for this".
// ---------------------------------------------------------------------------

/** Nouns that can only mean a spawned task (bare "chip" is handled apart: UI chips exist). */
const CHIP_NOUN = String.raw`(?:task[- ]?chips?|follow[- ]?up[- ]?chips?|folge[- ]?chips?)`;
/** Follow-up task nouns — a chip only together with a state ("Folge-Aufgabe:" alone may be a proposal). */
const TASK_NOUN = String.raw`(?:folge[- ]?(?:tasks?|aufgaben?)|follow[- ]?up[- ]?tasks?)`;
/** A state that says the chip is there already, not a question whether to make one. */
const CHIP_STATE = String.raw`(?:angelegt|erstellt|gespawnt|vorgemerkt|bereit|queued|created|spawned|flagged|ready|offered|angeboten|gestartet|started)`;

const CHIP_REFERENCE_RES = [
  // "als Task-Chip angelegt", "Task chip created", "follow-up chip ready",
  // "Task-Chip „Defer ship-ext plugin self-sync“ angelegt" (title in between)
  new RegExp(`${CHIP_NOUN}[^.?!\\n]{0,48}?\\b${CHIP_STATE}\\b`, 'i'),
  // "als Folge-Task angelegt", "follow-up task queued" — the state right after
  // the noun: "Folge-Aufgabe: die Seite ist bereit …" is a proposal, no chip.
  new RegExp(`${TASK_NOUN}\\s*(?:ist\\s+|is\\s+)?${CHIP_STATE}\\b`, 'i'),
  // "created a task chip", "angelegt als Task-Chip"
  new RegExp(`\\b${CHIP_STATE}\\b[^.?!\\n]{0,24}?${CHIP_NOUN}`, 'i'),
  // "Task-Chip: …" as the point's label
  new RegExp(`^\\s*${CHIP_NOUN}\\s*[:—–]`, 'i'),
  // "(Chip liegt bereit)", "— chip ready" — the singular noun opening a clause
  // right before its state; "Filter-Chips sind bereit" or "Neuer Chip bereit"
  // (UI chips) never match.
  /(?:^|[(—–;,]\s*)chip\s+(?:liegt\s+bereit|bereit|ready|angelegt|erstellt|created|queued|spawned)\b/i,
];

/** Does the point say a task chip / follow-up task already exists for it? */
function mentionsChip(text) {
  const t = String(text || '');
  return CHIP_REFERENCE_RES.some(re => re.test(t));
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[„“”"«»‚‘’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quoted fragments of a point: „…“, "…", «…», '…'. */
function quotedFragments(text) {
  const out = [];
  const re = /[„“"«‚‘']([^„“”"«»‚‘’']{3,120})[“”"»‘’']/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(norm(m[1]));
  return out;
}

/** Does the point name one of `chips` by its title (whole, or a quoted part of it)? */
function namesChip(text, chips) {
  if (!Array.isArray(chips) || !chips.length) return false;
  const t = norm(text);
  const quotes = quotedFragments(text).filter(q => q.length >= MIN_QUOTE);
  return chips.some(c => {
    const title = norm(c && c.title);
    if (title.length >= MIN_TITLE && t.includes(title)) return true;
    return title.length >= MIN_QUOTE && quotes.some(q => title.includes(q));
  });
}

/** Text of an open item: a string, or `{ text, reply }` (both are read). */
function itemText(it) {
  if (typeof it === 'string') return it;
  if (!it || typeof it !== 'object') return '';
  return `${it.text || ''}\n${it.reply || ''}`;
}

/**
 * Open points without the ones a task chip already offers.
 * @param {Array<string|{text?:string, reply?:string}>} open
 * @param {Array<{title?:string}>} [chips]  live chips of this session
 * @returns {{ open: Array, dropped: number }}
 */
function dropChipOpenItems(open, chips) {
  if (!Array.isArray(open) || !open.length) return { open, dropped: 0 };
  const kept = open.filter(it => {
    const text = itemText(it);
    return !(mentionsChip(text) || namesChip(text, chips));
  });
  return { open: kept, dropped: open.length - kept.length };
}

// ---------------------------------------------------------------------------
// Session state — written by post.flow.completion, read by the card server.
// ---------------------------------------------------------------------------

/** The text of a tool response: string, content array, or `{ content }`. */
function responseText(res) {
  if (typeof res === 'string') return res;
  const parts = Array.isArray(res) ? res : (res && Array.isArray(res.content) ? res.content : []);
  return parts.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
}

function readState(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (json && Array.isArray(json.chips)) return json;
  } catch { /* absent or corrupt */ }
  return null;
}

/**
 * Record the chip a successful spawn_task call created.
 * @param {object} hook  PostToolUse payload
 * @returns {{ id:string, title:string }|null}
 */
function recordSpawn(hook) {
  const input = hook && hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const title = String(input.title || '').trim();
  if (!title) return null;
  const m = /task_id:\s*(task_[A-Za-z0-9]+)/.exec(responseText(hook.tool_response));
  const id = m ? m[1] : '';
  const file = sessionFile(STATE_PREFIX, hook.session_id);
  const state = readState(file) || { cwd: '', chips: [] };
  state.cwd = hook.cwd || state.cwd || '';
  state.chips = state.chips.filter(c => !(id && c.id === id));
  state.chips.push({ id, title, tldr: String(input.tldr || '').slice(0, 400), at: new Date().toISOString() });
  if (state.chips.length > MAX_CHIPS) state.chips = state.chips.slice(-MAX_CHIPS);
  try { writeSessionFile(file, JSON.stringify(state)); } catch { /* advisory */ }
  return { id, title };
}

/**
 * A dismiss_task call. A withdrawn chip is no offer any more; one the user
 * already started is being handled in its own session and stays counted.
 * @param {object} hook  PostToolUse payload
 */
function recordDismiss(hook) {
  const input = hook && hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const id = String(input.task_id || '');
  if (!id) return;
  if (/already started/i.test(responseText(hook.tool_response))) return;
  const file = sessionFile(STATE_PREFIX, hook.session_id);
  const state = readState(file);
  if (!state) return;
  let changed = false;
  for (const c of state.chips) {
    if (c.id === id && !c.dismissed) { c.dismissed = true; changed = true; }
  }
  if (changed) {
    try { writeSessionFile(file, JSON.stringify(state)); } catch { /* advisory */ }
  }
}

function samePlace(a, b) {
  const n = (p) => {
    const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  return !!a && !!b && n(a) === n(b);
}

/**
 * Live chips of the session. The card server only knows the session id the
 * model passes — the harness id (the card contract names it), `"self"`, the
 * Desktop `local_…` id or nothing — so an unknown id falls back to the newest
 * chip file of the same working directory from the last 24 h.
 * @param {string} sessionId
 * @param {string} cwd
 * @returns {Array<{id:string,title:string,tldr:string}>}
 */
function readChips(sessionId, cwd) {
  let state = sessionId ? readState(sessionFile(STATE_PREFIX, sessionId)) : null;
  if (!state && cwd) {
    try {
      const dir = os.tmpdir();
      const now = Date.now();
      const candidates = fs.readdirSync(dir)
        .filter(f => f.startsWith(STATE_PREFIX + '-') && !f.endsWith('.tmp'))
        .map(f => {
          const full = path.join(dir, f);
          try { return { full, mtime: fs.statSync(full).mtimeMs }; } catch { return null; }
        })
        .filter(c => c && now - c.mtime <= FALLBACK_MAX_AGE_MS)
        .sort((a, b) => b.mtime - a.mtime);
      for (const c of candidates) {
        const s = readState(c.full);
        if (s && samePlace(s.cwd, cwd)) { state = s; break; }
      }
    } catch { /* tmpdir unreadable */ }
  }
  return state ? state.chips.filter(c => c && !c.dismissed) : [];
}

/** The reminder post.flow.completion hands Claude right after a chip is created. */
function chipReminder(title) {
  return [
    `[task-chip] Chip offered: "${title}". The chip IS the offer — the user starts it with one click.`,
    'Do not repeat this topic on the completion card (no open point, no "chip ready" note): the card',
    'drops such points, and its "Nachbessern" answer would make the user fix it a second time here.',
  ];
}

module.exports = {
  STATE_PREFIX,
  SPAWN_TOOL_RE,
  DISMISS_TOOL_RE,
  mentionsChip,
  namesChip,
  dropChipOpenItems,
  recordSpawn,
  recordDismiss,
  readChips,
  chipReminder,
};
