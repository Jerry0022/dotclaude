/**
 * @module approval-wait
 * @version 0.1.0
 * @description Which background-agent tool calls of a session wait on the
 *   user's permission dialog right now — the state behind the 👉 approval
 *   head of the session title (title-scheme `approvalTitle`).
 *
 *   Titles are set by the main thread only (a subagent cannot rename the
 *   session), and while it idles on background agents nothing woke it when
 *   one of them stopped at a permission dialog: the sidebar said
 *   `⏳ ➜ 🤖 Team ┃ …` while the session waited for the user (2026-10-25).
 *
 *   perm.approval.flag / perm.approval.watch (PermissionRequest, `asyncRewake`)
 *   record the waiting call here; post.approval.clear (PostToolUse,
 *   PostToolUseFailure) and substop.approval.clear (SubagentStop) drop it once
 *   the agent moved on. PermissionRequest carries no `tool_use_id`, so an
 *   entry is keyed by agent id + a hash of tool name and input. A dialog the
 *   user DENIES fires no event at all (no PostToolUseFailure, PermissionDenied
 *   only in auto mode): the agent's next finished call that STARTED after the
 *   entry (`now - duration_ms`) clears it, its SubagentStop at the latest. A
 *   parallel call that started before the dialog leaves the entry alone.
 *
 *   The wake turn: when the main thread had ended its turn, the woken turn
 *   only renames the session. The `approval-wake` flag makes it a silent turn
 *   (stop.flow.guard, post.flow.completion) so no card is demanded — a card
 *   would put the ⏳ head straight back. A user prompt drops the flag
 *   (prompt.flow.silent-turn).
 *
 *   State: one JSON file per session in the OS temp dir (lib/session-id) —
 *   per session, not per repo: background agents of one session can work in
 *   several worktrees.
 */

const fs = require('fs');
const crypto = require('crypto');
const { sessionFile, writeSessionFile } = require('./session-id');

const STATE_PREFIX = 'dotclaude-devops-approval-wait';
const WAKE_PREFIX = 'dotclaude-devops-approval-wake';
/** An entry older than this is dropped: a dialog nobody answered, a crash. */
const MAX_AGE_MS = 2 * 3_600_000;
/** A wake flag older than this no longer marks a turn silent — the wake comes within seconds. */
const WAKE_TTL_MS = 2 * 60_000;
/** The main thread's last entry must be this old to count as idle. */
const IDLE_MS = 2000;
const MARKER = '[perm.approval]';
const SET_TOOL = 'mcp__ccd_session_mgmt__set_session_title';
/** The only calls a wake turn makes: the rename and loading its schema. */
const RENAME_TOOLS = Object.freeze(new Set([SET_TOOL, 'ToolSearch']));

/** Key of one tool call: tool name + input, hashed. */
function signature(toolName, toolInput) {
  let input = '';
  try { input = JSON.stringify(toolInput ?? null); } catch { input = String(toolInput); }
  return crypto.createHash('sha1').update(`${toolName || ''}\n${input}`).digest('hex').slice(0, 16);
}

function statePath(sessionId) {
  return sessionFile(STATE_PREFIX, sessionId);
}

/** The session's waiting entries (expired ones dropped), [] when none. */
function readEntries(sessionId, now = Date.now()) {
  let list;
  try { list = JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8')); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e.agent === 'string' && typeof e.sig === 'string' &&
    Number.isFinite(e.at) && now - e.at < MAX_AGE_MS);
}

function writeEntries(sessionId, entries) {
  const file = statePath(sessionId);
  if (!entries.length) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
    return;
  }
  writeSessionFile(file, JSON.stringify(entries));
}

/**
 * Records the subagent call `hook` describes as waiting. Idempotent — flag
 * and watch both call it, in parallel. Null for a main-thread call.
 *
 * @param {object} hook PermissionRequest payload
 * @returns {{agent: string, sig: string, tool: string, at: number}|null}
 */
function record(hook, now = Date.now()) {
  if (!hook || typeof hook.agent_id !== 'string' || !hook.agent_id) return null;
  const sig = signature(hook.tool_name, hook.tool_input);
  const entries = readEntries(hook.session_id, now);
  const known = entries.find((e) => e.agent === hook.agent_id && e.sig === sig);
  if (known) return known;
  const entry = { agent: hook.agent_id, sig, tool: String(hook.tool_name || ''), at: now };
  writeEntries(hook.session_id, [...entries, entry]);
  return entry;
}

/** True when `entry` still waits. */
function isWaiting(sessionId, entry, now = Date.now()) {
  return readEntries(sessionId, now).some((e) => e.agent === entry.agent && e.sig === entry.sig);
}

/**
 * Drops the entries of the agent behind `hook` that are answered: on
 * SubagentStop all of them; on a finished call the one it IS, and every one
 * that call started after (the agent moved on — the dialog was denied).
 *
 * @param {object} hook PostToolUse / PostToolUseFailure / SubagentStop payload
 * @returns {number} how many entries went
 */
function clear(hook, now = Date.now()) {
  if (!hook || typeof hook.agent_id !== 'string' || !hook.agent_id) return 0;
  if (!fs.existsSync(statePath(hook.session_id))) return 0;
  const entries = readEntries(hook.session_id, now);
  const stop = hook.hook_event_name === 'SubagentStop';
  const sig = stop ? null : signature(hook.tool_name, hook.tool_input);
  const started = Number.isFinite(hook.duration_ms) ? now - hook.duration_ms : null;
  const keep = entries.filter((e) => {
    if (e.agent !== hook.agent_id) return true;
    if (stop || e.sig === sig) return false;
    return started !== null && started <= e.at;
  });
  writeEntries(hook.session_id, keep);
  return entries.length - keep.length;
}

/**
 * The MAIN session transcript of `hook` — a subagent's payload may name its
 * own transcript, whose tail carries no title and no main-thread entries.
 */
function mainTranscript(hook) {
  const t = hook && hook.transcript_path;
  const own = `${hook && hook.session_id}.jsonl`;
  if (typeof t === 'string' && t.replace(/\\/g, '/').endsWith('/' + own)) return t;
  const { findTranscript } = require('./session-title');
  return findTranscript(hook && hook.session_id, require('os').homedir(), hook && hook.cwd) || t || null;
}

function parse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/**
 * True when the main thread has ended its turn: its last transcript entry is
 * an assistant message without a tool call, at least IDLE_MS old. Subagent
 * (sidechain), meta and non-message entries are skipped.
 *
 * @param {string} text transcript tail
 */
function isMainIdle(text, now = Date.now()) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const e = parse(lines[i]);
    if (!e || e.isSidechain || e.isMeta || (e.type !== 'user' && e.type !== 'assistant')) continue;
    if (e.type !== 'assistant') return false;
    const c = e.message && e.message.content;
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_use')) return false;
    const at = Date.parse(e.timestamp);
    return !Number.isFinite(at) || now - at >= IDLE_MS;
  }
  return false;
}

/** Marks the coming wake turn silent (main thread idle only). */
function markWake(sessionId, now = Date.now()) {
  try { writeSessionFile(sessionFile(WAKE_PREFIX, sessionId), String(now)); return true; } catch { return false; }
}

/** When the fresh wake flag was written (ms), or null. */
function wakeAt(sessionId, now = Date.now()) {
  try {
    const at = Number(fs.readFileSync(sessionFile(WAKE_PREFIX, sessionId), 'utf8'));
    return Number.isFinite(at) && now - at < WAKE_TTL_MS ? at : null;
  } catch { return null; }
}

/** True when a fresh wake flag waits for its turn. */
function wakePending(sessionId, now = Date.now()) {
  return wakeAt(sessionId, now) !== null;
}

/**
 * True when the main thread did nothing since `since` (ms) but rename the
 * session — the wake turn as it should be. Any other tool call, or a
 * transcript with no entry after `since`, is a real turn: false.
 *
 * @param {string} text transcript tail
 * @param {number} since the wake flag's time
 */
function onlyRenamedSince(text, since) {
  let seen = false;
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    const e = parse(line);
    if (!e || e.isSidechain || e.type !== 'assistant') continue;
    const at = Date.parse(e.timestamp);
    if (!Number.isFinite(at) || at < since) continue;
    const c = e.message && e.message.content;
    for (const b of Array.isArray(c) ? c : []) {
      if (!b || b.type !== 'tool_use') continue;
      if (!RENAME_TOOLS.has(b.name)) return false;
      seen = true;
    }
  }
  return seen;
}

function dropWake(sessionId) {
  try { fs.unlinkSync(sessionFile(WAKE_PREFIX, sessionId)); } catch { /* none */ }
}

function instruction(lead, title) {
  return [
    `${MARKER} ${lead}`,
    `Main thread, Desktop app only — a subagent reading this ignores it: ${SET_TOOL} {session_id:"self", title:${JSON.stringify(title)}} — exact title, no get_session.`,
    `Only deferred → ToolSearch "select:${SET_TOOL}" first. Failing or unavailable: skip silently, no retry.`,
    'Your turn had ended → send only this call, then end the turn: no text, no card. Mid-turn → put it into your next tool batch and carry on.',
    'Do not mention this to the user.',
  ].join('\n');
}

/** The wake text while a background agent waits on a permission dialog. */
function waitText(title) {
  return instruction('A background agent waits for the user to approve a tool call (permission dialog) — the title says whose move it is.', title);
}

/** The wake text once every dialog is answered. */
function restoreText(title) {
  return instruction('The permission dialog was answered — the background agent works again.', title);
}

module.exports = {
  MARKER,
  STATE_PREFIX,
  WAKE_PREFIX,
  MAX_AGE_MS,
  WAKE_TTL_MS,
  IDLE_MS,
  signature,
  statePath,
  readEntries,
  record,
  isWaiting,
  clear,
  mainTranscript,
  isMainIdle,
  markWake,
  RENAME_TOOLS,
  wakeAt,
  wakePending,
  onlyRenamedSince,
  dropWake,
  waitText,
  restoreText,
};
