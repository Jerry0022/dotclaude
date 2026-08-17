/**
 * @module batch-state
 * @version 0.1.0
 * @description State and classification for the `/claude-batch` collect mode.
 *
 * Collect mode batches user prompts into `.claude/batch.md` instead of acting
 * on them, until the user fires the merge with an execute marker.
 *
 * Storage is deliberately a PROJECT file, not `os.tmpdir()`:
 *   - survives crash, reboot and `/clear` (which mints a new session_id and
 *     would orphan a session-scoped temp file)
 *   - is readable/editable in the editor, and fillable without Claude running
 *   - avoids the glob fallback in `session-id.js`, which can hand back another
 *     window's file — harmless for advisory state, unacceptable for a mode flag
 *
 * Spec: docs/superpowers/specs/2026-08-16-claude-batch-design.md
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const DEFAULTS = {
  marker: '!',
  inactivityMinutes: 10,
  // Failsafe bounds — either one deactivates collection on its own, so a bug in
  // marker comparison can never lock the user out of their own session.
  expiryHours: 8,
  maxNotes: 100,
};

/**
 * Machine-prompt patterns. Prompts matching these are NEVER collected.
 *
 * Deliberately re-declared instead of imported from
 * `user-prompt-submit/prompt.flow.silent-turn.js`: that module registers
 * `process.stdin` listeners at load time, so requiring it from inside another
 * hook that reads stdin would fight over the stream.
 *
 * The AUTONOMOUS_* entries are ADDITIONS — they do not match silent-turn's
 * patterns. Without them an AFK `/run-backlog` or `/run-autonomous` resume
 * would be swallowed into the queue and the night run would never start.
 */
const MACHINE_PATTERNS = [
  /^\s*silent\s*:/i,
  /^\s*silently\s+(?:run|service|post|get|curl|fetch|heartbeat|keep|check|trigger|update|sync|reset|tick|reload|shutdown|execute|poll|invoke|call)\b/i,
  /^\s*run\s+silently\b/i,
  /<<autonomous-loop(-dynamic)?>>/i,
  /^\s*AUTONOMOUS_AUTOSTART\s*:/i,
  /^\s*AUTONOMOUS_RESUME\s*:/i,
  /^\s*RUN_BACKLOG_AUTOSTART\s*:/i,
];

/**
 * Attachment indicators. A blocked prompt is ERASED from the UI, so a collected
 * screenshot is unrecoverable and an expanded @file would dump whole files into
 * the queue — inverting the saving the mode exists for. Both pass through.
 */
const ATTACHMENT_PATTERNS = [
  /\[Image\s*#?\d*\]/i,
  /\[Pasted text\s*#?\d*/i,
  // @path/to/file.ext — the harness expands these into the prompt
  /(^|\s)@[\w.\-/\\]+\.[A-Za-z0-9]{1,8}(\s|$)/,
];

// ── paths ──────────────────────────────────────────────────────────────────

function configPath() {
  return path.join(os.homedir(), '.claude', 'claude-batch.json');
}

function claudeDir(cwd) {
  return path.join(cwd || process.cwd(), '.claude');
}

function notesPath(cwd)    { return path.join(claudeDir(cwd), 'batch.md'); }
function modePath(cwd)     { return path.join(claudeDir(cwd), 'batch-mode.json'); }
/** Dedicated user-activity clock. Must NOT be the notes file's mtime: machine
 *  prompts touch the session every minute, so a clock hanging off general
 *  activity would never reach the inactivity threshold. */
function activityPath(cwd) { return path.join(claudeDir(cwd), 'batch-activity'); }
function lockPath(cwd)     { return path.join(claudeDir(cwd), 'batch-watchdog.lock'); }

// ── config ─────────────────────────────────────────────────────────────────

/** @returns {{marker:string,inactivityMinutes:number,expiryHours:number,maxNotes:number}} */
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  const incoming = { ...(cfg || {}) };
  if ('marker' in incoming) {
    const v = validateMarker(incoming.marker);
    if (!v.ok) throw new Error(`invalid marker (${v.reason})`);
    incoming.marker = v.marker;
  }
  const merged = { ...loadConfig(), ...incoming };
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

// ── mode ───────────────────────────────────────────────────────────────────

/** Raw mode record, or null when collect mode was never activated here. */
function readMode(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(modePath(cwd), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Is collect mode active AND within its failsafe bounds?
 * @param {string} cwd
 * @param {number} [now] epoch ms — injectable for tests
 */
function isModeActive(cwd, now) {
  const mode = readMode(cwd);
  if (!mode || mode.active !== true) return false;
  const t = typeof now === 'number' ? now : Date.now();
  if (mode.expiresAt && t >= Date.parse(mode.expiresAt)) return false;
  if (mode.maxNotes && countNotes(cwd) >= mode.maxNotes) return false;
  return true;
}

/**
 * Why is the mode not active, given that a mode file exists? Lets the skill
 * explain an auto-deactivation instead of silently resuming normal prompts.
 * @returns {'expired'|'full'|null}
 */
function expiryReason(cwd, now) {
  const mode = readMode(cwd);
  if (!mode || mode.active !== true) return null;
  const t = typeof now === 'number' ? now : Date.now();
  if (mode.expiresAt && t >= Date.parse(mode.expiresAt)) return 'expired';
  if (mode.maxNotes && countNotes(cwd) >= mode.maxNotes) return 'full';
  return null;
}

function activate(cwd, opts = {}) {
  const cfg = loadConfig();
  const startedAt = opts.startedAt ? new Date(opts.startedAt) : new Date();
  const hours = opts.expiryHours ?? cfg.expiryHours;
  const mode = {
    active: true,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + hours * 3600_000).toISOString(),
    maxNotes: opts.maxNotes ?? cfg.maxNotes,
    marker: opts.marker ?? cfg.marker,
  };
  fs.mkdirSync(claudeDir(cwd), { recursive: true });
  fs.writeFileSync(modePath(cwd), JSON.stringify(mode, null, 2) + '\n', 'utf8');
  return mode;
}

function deactivate(cwd) {
  try { fs.unlinkSync(modePath(cwd)); } catch { /* already gone */ }
}

// ── notes ──────────────────────────────────────────────────────────────────

/**
 * Append one note. Uses appendFileSync, never read-modify-write: the optional
 * compaction child rewrites the file, and a read-modify-write here would lose
 * whichever side held the stale snapshot.
 * @returns {number} note count after the append
 */
function appendNote(cwd, text, when) {
  const stamp = (when ? new Date(when) : new Date()).toISOString();
  fs.mkdirSync(claudeDir(cwd), { recursive: true });
  const file = notesPath(cwd);
  const header = fs.existsSync(file)
    ? ''
    : '# claude-batch notes\n\nCollected prompts, newest last. Edit freely — the merge reads this file.\n';
  fs.appendFileSync(file, `${header}\n<!-- ${stamp} -->\n${String(text).trim()}\n`, 'utf8');
  return countNotes(cwd);
}

/** Parsed notes in collection order. @returns {{at:string,text:string}[]} */
function readNotes(cwd) {
  let raw;
  try { raw = fs.readFileSync(notesPath(cwd), 'utf8'); } catch { return []; }
  const out = [];
  const re = /<!--\s*(\S+?)\s*-->\n([\s\S]*?)(?=\n<!--\s*\S+?\s*-->\n|$)/g;
  for (const m of raw.matchAll(re)) {
    const text = m[2].trim();
    if (text) out.push({ at: m[1], text });
  }
  return out;
}

function countNotes(cwd) { return readNotes(cwd).length; }

function clearNotes(cwd) {
  try { fs.unlinkSync(notesPath(cwd)); } catch { /* already gone */ }
}

/** Archive the notes next to the file so a merge never destroys the original. */
function archiveNotes(cwd, stampSource) {
  const file = notesPath(cwd);
  if (!fs.existsSync(file)) return null;
  const stamp = (stampSource ? new Date(stampSource) : new Date())
    .toISOString().replace(/[:.]/g, '-');
  const dest = path.join(claudeDir(cwd), `batch-${stamp}.md`);
  fs.renameSync(file, dest);
  return dest;
}

// ── activity clock ─────────────────────────────────────────────────────────

function touchActivity(cwd, when) {
  const t = typeof when === 'number' ? when : Date.now();
  fs.mkdirSync(claudeDir(cwd), { recursive: true });
  fs.writeFileSync(activityPath(cwd), String(t), 'utf8');
  return t;
}

/** @returns {number|null} epoch ms of the last real user prompt */
function readActivity(cwd) {
  try {
    const n = Number(fs.readFileSync(activityPath(cwd), 'utf8').trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ── classification ─────────────────────────────────────────────────────────

function isMachinePrompt(text) {
  if (typeof text !== 'string' || !text) return false;
  return MACHINE_PATTERNS.some(rx => rx.test(text));
}

/**
 * An expanded slash command carries a <command-name> tag — the raw text is NOT
 * literally "/claude-batch off". Comparing against the typed form would miss
 * exactly the escape hatch it is meant to protect.
 */
function isExpandedCommand(text) {
  return typeof text === 'string' && text.includes('<command-name>');
}

function hasAttachment(text, hookInput) {
  if (hookInput && typeof hookInput === 'object') {
    for (const key of ['attachments', 'images', 'files']) {
      const v = hookInput[key];
      if (Array.isArray(v) ? v.length > 0 : v) return true;
    }
  }
  if (typeof text !== 'string' || !text) return false;
  return ATTACHMENT_PATTERNS.some(rx => rx.test(text));
}

const MARKER_MAX_LENGTH = 32;

/**
 * Normalise and sanity-check a marker the user typed themselves.
 *
 * The three offered options are suggestions, not a closed set — a free-text
 * answer ("Let's go") is a legitimate marker and must survive to the config
 * file. Only genuinely unusable input is rejected, and always with a reason
 * the skill can quote back.
 *
 * @returns {{ok:true,marker:string,warning:?'wordy'}|{ok:false,reason:'empty'|'too-long'}}
 */
function validateMarker(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const marker = raw.trim().replace(/\s+/g, ' ');
  if (!marker) return { ok: false, reason: 'empty' };
  if (marker.length > MARKER_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  // A letters-only phrase can also be the honest start of a collected prompt.
  // Word-boundary matching keeps that rare, but the user should hear it once.
  const wordy = /^[\p{L}\p{N} ]+$/u.test(marker) ? 'wordy' : null;
  return { ok: true, marker, warning: wordy };
}

/**
 * Anchored matcher for a marker.
 *
 * Case-insensitive and whitespace-tolerant, because a phrase marker is retyped
 * by hand every time: "let's go" must fire a marker stored as "Let's go", or
 * the prompt is silently collected instead of executed — the exact lock-out the
 * failsafe bounds exist to make impossible.
 *
 * A marker ending in a word character additionally requires a word boundary, so
 * `go` does not fire on "google das mal".
 */
function markerMatch(text, marker) {
  if (typeof text !== 'string' || !text) return null;
  const v = validateMarker(marker);
  if (!v.ok) return null;
  const escaped = v.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const boundary = /[\p{L}\p{N}_]$/u.test(v.marker) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(`^\\s*${escaped}${boundary}`, 'iu').exec(text);
}

function startsWithMarker(text, marker) {
  return markerMatch(text, marker) !== null;
}

function stripMarker(text, marker) {
  const s = String(text ?? '');
  const m = markerMatch(s, marker);
  return m ? s.slice(m[0].length).trimStart() : s;
}

/**
 * Advisory only — never used to decide collect vs. execute. The hook does not
 * guess what a question is; this only enriches the acknowledgement so a
 * forgotten marker on a real question is visible instead of silent.
 */
function looksLikeQuestion(text) {
  if (typeof text !== 'string' || !text) return false;
  return text.trimEnd().endsWith('?');
}

/**
 * The single decision.
 * @returns {'passthrough'|'collect'|'execute'}
 */
function classify({ text, hookInput, marker, modeActive }) {
  if (!modeActive) return 'passthrough';
  if (isMachinePrompt(text)) return 'passthrough';
  if (isExpandedCommand(text)) return 'passthrough';
  if (hasAttachment(text, hookInput)) return 'passthrough';
  if (startsWithMarker(text, marker)) return 'execute';
  return 'collect';
}

/**
 * Will this prompt be collected — i.e. blocked, erased, and never producing a
 * turn? Every state-writing UserPromptSubmit hook must no-op when this is true.
 *
 * Hooks in one event group run in PARALLEL and are NOT short-circuited by a
 * sibling's block, so without this guard they burn one-shot state (a
 * deep-knowledge doc marked "already injected", a tracked issue marked "already
 * seen", a git merge) on a prompt that no longer exists. The payload they emit
 * goes nowhere, but the state change sticks — a silent degradation with no
 * error anywhere.
 *
 * Fails open: any error means "not collected", so a bug here can never suppress
 * a hook on an ordinary turn.
 *
 * @param {object} hookInput parsed hook stdin JSON
 * @returns {boolean}
 */
function willBeCollected(hookInput) {
  try {
    if (!hookInput || typeof hookInput !== 'object') return false;
    const cwd = hookInput.cwd || process.cwd();
    if (!isModeActive(cwd)) return false;
    const text = hookInput.prompt || hookInput.user_message || hookInput.message || '';
    const marker = readMode(cwd)?.marker || loadConfig().marker;
    return classify({ text, hookInput, marker, modeActive: true }) === 'collect';
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULTS,
  MACHINE_PATTERNS,
  ATTACHMENT_PATTERNS,
  configPath, claudeDir, notesPath, modePath, activityPath, lockPath,
  loadConfig, saveConfig,
  readMode, isModeActive, expiryReason, activate, deactivate,
  appendNote, readNotes, countNotes, clearNotes, archiveNotes,
  touchActivity, readActivity,
  isMachinePrompt, isExpandedCommand, hasAttachment,
  startsWithMarker, stripMarker, looksLikeQuestion,
  validateMarker, markerMatch, MARKER_MAX_LENGTH,
  classify, willBeCollected,
};
