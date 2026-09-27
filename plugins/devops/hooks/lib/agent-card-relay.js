/**
 * @module agent-card-relay
 * @version 0.1.0
 * @description Did the user actually see the agent card?
 *
 *   pre.agent.announce hands Claude the agent card on every spawn with "show
 *   the user this card verbatim". Transcripts of 2026-09-25..27 (v0.203.0 →
 *   0.214): 83 spawn messages got the card, 10 relayed it (12 %). The typical
 *   miss: after a parallel spawn a one-line progress note ("Linsen laufen
 *   noch; …") or, under the Quiet style, no text at all before the next tool
 *   call. Instructions alone do not carry it, so pre.agent.relay refuses the
 *   next tool call once and stop.agent.relay blocks the turn end once while a
 *   card is still unshown.
 *
 *   Everything is read from the transcript: the Agent tool_use lines (their
 *   `message.id` groups a parallel launch), the hook_additional_context
 *   attachment that carries each spawn's card, and the assistant text written
 *   after the launch. A card counts as shown when a later assistant text (or
 *   a show_widget call) carries its header phrase — "3 Agents gestartet",
 *   "1 agent started". Only the current turn is looked at.
 *
 *   One nudge per launch: the ids already nudged sit in a session file, so a
 *   model that still does not relay is never refused twice (no loops).
 */

'use strict';

const fs = require('fs');
const { sessionFile, writeSessionFile } = require('./session-id');

const TAIL_BYTES = 512 * 1024;
const CARD_PREFIX = 'Agent card';
const NAG_PREFIX = 'dotclaude-devops-agent-card-nag';

/** Is this transcript entry the user's prompt (not a tool result, not meta)? */
function isPromptEntry(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta === true) return false;
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.some(b => b && b.type !== 'tool_result');
}

/** The card markdown inside an announce context (between the --- fences). */
function cardFromContext(text) {
  const s = String(text || '');
  if (!s.startsWith(CARD_PREFIX)) return null;
  const at = s.indexOf('\n---');
  return at === -1 ? null : s.slice(at + 1).trim();
}

/** `### 🤖 **3 Agents gestartet** · Hintergrund` → `3 Agents gestartet`. */
function cardHeader(card) {
  const m = String(card || '').match(/^###[^\n]*?\*\*([^*\n]+)\*\*/m);
  return m ? m[1].trim() : null;
}

/** Text an assistant entry shows the user: text blocks and show_widget code. */
function shownText(entry) {
  const content = entry && entry.message && entry.message.content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    if (b.type === 'tool_use' && /show_widget$/.test(String(b.name || '')) && b.input) {
      parts.push(String(b.input.widget_code || ''));
    }
  }
  return parts.join('\n');
}

/** Parsed entries of the current turn (after the last prompt), in order. */
function currentTurn(transcriptText) {
  const entries = [];
  for (const line of String(transcriptText || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    if (isPromptEntry(e)) entries.length = 0;
    else entries.push(e);
  }
  return entries;
}

/**
 * The spawn launches of the current turn whose card was never shown.
 * @returns {Array<{msgId:string, ids:string[], lastId:string, card:string, header:string}>}
 */
function unrelayedLaunches(transcriptText) {
  if (!String(transcriptText || '').includes(CARD_PREFIX)) return [];
  const turn = currentTurn(transcriptText);

  const launches = new Map(); // msgId → { msgId, ids, lastIdx, lastId }
  const cardFor = new Map();  // toolUseID → card
  turn.forEach((e, i) => {
    if (e.type === 'assistant' && Array.isArray(e.message && e.message.content)) {
      for (const b of e.message.content) {
        if (!b || b.type !== 'tool_use' || b.name !== 'Agent') continue;
        const msgId = (e.message && e.message.id) || b.id;
        if (!launches.has(msgId)) launches.set(msgId, { msgId, ids: [], lastIdx: i, lastId: b.id });
        const l = launches.get(msgId);
        l.ids.push(b.id);
        l.lastIdx = i;
        l.lastId = b.id;
      }
    }
    const a = e.attachment;
    if (a && a.type === 'hook_additional_context' && a.toolUseID) {
      const content = Array.isArray(a.content) ? a.content.join('\n') : a.content;
      const card = cardFromContext(content);
      if (card) cardFor.set(a.toolUseID, card);
    }
  });

  const out = [];
  for (const l of launches.values()) {
    // The last card of a launch lists every agent of it.
    let card = null;
    for (const id of l.ids) if (cardFor.has(id)) card = cardFor.get(id);
    const header = cardHeader(card);
    if (!card || !header) continue;
    let shown = false;
    for (let j = l.lastIdx + 1; j < turn.length && !shown; j++) {
      if (turn[j].type === 'assistant' && shownText(turn[j]).includes(header)) shown = true;
    }
    if (!shown) out.push({ msgId: l.msgId, ids: l.ids, lastId: l.lastId, card, header });
  }
  return out;
}

/** The message id of a tool_use in the current turn, or null. */
function messageIdOf(transcriptText, toolUseId) {
  if (!toolUseId) return null;
  for (const e of currentTurn(transcriptText)) {
    if (e.type !== 'assistant' || !Array.isArray(e.message && e.message.content)) continue;
    if (e.message.content.some(b => b && b.type === 'tool_use' && b.id === toolUseId)) {
      return (e.message && e.message.id) || null;
    }
  }
  return null;
}

function readTail(transcriptPath, tailBytes = TAIL_BYTES) {
  if (!transcriptPath) return '';
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - tailBytes);
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, size - start, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function nagFile(sessionId) {
  return sessionFile(NAG_PREFIX, sessionId);
}

function nagged(sessionId) {
  try { return new Set(fs.readFileSync(nagFile(sessionId), 'utf8').split('\n').filter(Boolean)); } catch { return new Set(); }
}

function markNagged(sessionId, ids) {
  try {
    const all = [...nagged(sessionId), ...[].concat(ids)].slice(-200);
    writeSessionFile(nagFile(sessionId), all.join('\n') + '\n');
  } catch { /* fail open: a lost mark costs one more nudge at most */ }
}

/**
 * The launch to nudge about now, or null: the newest unshown card of the
 * turn that was never nudged. Launches in `skipMsgId` (the message of the
 * tool call being gated — a parallel sibling of the spawn) are left alone.
 * `covers` lists every open launch: the newest card is the one worth showing,
 * and one nudge settles them all.
 */
function launchToNudge(transcriptText, sessionId, { skipMsgId = null } = {}) {
  const done = nagged(sessionId);
  const open = unrelayedLaunches(transcriptText).filter(l => l.msgId !== skipMsgId && !done.has(l.lastId));
  if (!open.length) return null;
  return { ...open[open.length - 1], covers: open.map(l => l.lastId) };
}

function nudgeText(launch, { atStop = false } = {}) {
  const when = atStop
    ? 'The turn was about to end without it.'
    : 'This tool call was held back once so the card comes first — write the card, then repeat the call.';
  return (
    `[agent-card-relay] The agent card of your last launch never reached the user. ${when} ` +
    'Show it now verbatim as your next text (the Quiet output style relays it too; no prose summary in its place):\n' +
    launch.card
  );
}

module.exports = {
  CARD_PREFIX,
  cardFromContext,
  cardHeader,
  currentTurn,
  unrelayedLaunches,
  messageIdOf,
  readTail,
  nagged,
  markNagged,
  launchToNudge,
  nudgeText,
};
