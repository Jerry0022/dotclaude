/**
 * @module batch-state
 * @version 0.3.0
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

/**
 * First characters the harness claims before a prompt exists.
 *
 * A prompt starting with one of these never arrives at UserPromptSubmit as a
 * prompt at all, so a marker built on them can never fire the merge:
 *   `!` → bash mode, the line runs as a shell command
 *   `/` → slash command, expanded into a different payload
 *   `#` → memory capture, appended to CLAUDE.md
 *   `@` → file mention, expanded into file content (also an ATTACHMENT_PATTERN)
 *
 * The failure is silent and total: collection keeps swallowing prompts while the
 * one escape the user was told about does nothing. Hence a hard reject, not a
 * warning.
 */
const HARNESS_RESERVED_PREFIXES = ['!', '/', '#', '@'];

const DEFAULTS = {
  // `>>` and not `!`: see HARNESS_RESERVED_PREFIXES.
  marker: '>>',
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

/**
 * Phrases that turn an ordinary prompt into a claude-batch invocation.
 *
 * Mirrors the skill's own trigger list. Used ONLY to recognise an activating
 * prompt while the mode is still OFF — never to decide collect vs. execute.
 */
const ACTIVATION_PATTERNS = [
  /sammel[-\s]?modus/i,
  /collect[-\s]?mode/i,
  /batch[-\s]?mode/i,
  /erstmal\s+sammeln/i,
  /nicht\s+sofort\s+umsetzen/i,
];

/**
 * Triggers that ARE the request, not just the mode's name. "Erstmal sammeln"
 * cannot be said about the mode without asking for it, so these need no
 * separate on-word.
 */
const SELF_ACTIVATING_PATTERNS = [
  /erstmal\s+sammeln/i,
  /nicht\s+sofort\s+umsetzen/i,
];

/**
 * Words that turn a mention of the mode into a request to switch it on.
 *
 * Naming the mode is not asking for it: "wir sollten den Sammelmodus
 * dokumentieren" is prose, "Sammelmodus an" is an invocation. Requiring one of
 * these in the SAME clause as the trigger is what separates the two.
 */
const ACTIVATION_INTENT = /\b(an|on|start\w*|aktivier\w*|ein|los|bitte)\b/i;

/** Clause boundaries — an intent word two sentences away is not this clause. */
const CLAUSE_BOUNDARIES = ['.', ',', ';', ':', '!', '?', '\n'];

/**
 * The clause `index` sits in — the text between the nearest clause boundaries
 * on either side.
 * @param {string} s
 * @param {number} index
 */
function clauseAround(s, index) {
  let start = 0;
  let end = s.length;
  for (const c of CLAUSE_BOUNDARIES) {
    const before = s.lastIndexOf(c, index);
    if (before !== -1 && before + 1 > start) start = before + 1;
    const after = s.indexOf(c, index);
    if (after !== -1 && after < end) end = after;
  }
  return s.slice(start, end);
}

/** Words that are pure routing (Step 1 of the skill), never note content. */
const ROUTE_WORDS = /\b(on|an|start|off|aus|stop|go|los|merge|marker|status|bitte|mal|jetzt)\b/gi;

/**
 * Below this many characters of residue, an invocation is "activation only" —
 * `/claude-batch on` and friends. Above it the user typed work into the very
 * prompt that turns collection on, and that work must be filed as a note
 * instead of executed.
 */
const ACTIVATION_CONTENT_MIN = 12;

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

/**
 * Config with an ALWAYS-USABLE marker.
 *
 * A stored marker is re-validated on every read, not just on write: configs
 * written before the reserved-prefix rule existed carry `!`, and honouring one
 * would leave collection running with no way to fire the merge. When that
 * happens the default takes over and `markerFallback` records it, so the skill
 * can tell the user instead of the mode silently behaving differently than the
 * config file says.
 *
 * @returns {{marker:string,inactivityMinutes:number,expiryHours:number,maxNotes:number,markerFallback?:{was:string,reason:string}}}
 */
function loadConfig() {
  let raw = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch { /* missing or corrupt — defaults below */ }
  const cfg = { ...DEFAULTS, ...raw };
  delete cfg.markerFallback;
  const v = validateMarker(cfg.marker);
  if (!v.ok) {
    return {
      ...cfg,
      marker: DEFAULTS.marker,
      markerFallback: { was: String(cfg.marker ?? ''), reason: v.reason },
    };
  }
  cfg.marker = v.marker;
  return cfg;
}

function saveConfig(cfg) {
  const incoming = { ...(cfg || {}) };
  if ('marker' in incoming) {
    const v = validateMarker(incoming.marker);
    if (!v.ok) throw new Error(`invalid marker (${v.reason})`);
    incoming.marker = v.marker;
  }
  const merged = { ...loadConfig(), ...incoming };
  // Derived state, never persisted — it would outlive the condition it reports.
  delete merged.markerFallback;
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
  const asked = validateMarker(opts.marker);
  const startedAt = opts.startedAt ? new Date(opts.startedAt) : new Date();
  const hours = opts.expiryHours ?? cfg.expiryHours;
  const mode = {
    active: true,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + hours * 3600_000).toISOString(),
    maxNotes: opts.maxNotes ?? cfg.maxNotes,
    // Pinned so a later config edit cannot change the marker mid-collection —
    // but never an unusable one, or the mode starts with no way out.
    marker: asked.ok ? asked.marker : cfg.marker,
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

/**
 * Parsed notes in collection order.
 *
 * Line endings are normalised before parsing. The file header invites manual
 * editing, and every Windows editor rewrites it CRLF on save — a CRLF
 * separator after `-->`
 * separator matches nothing, so the whole queue would read as EMPTY and the
 * merge would fire on zero notes with no error anywhere.
 *
 * @returns {{at:string,text:string}[]}
 */
function readNotes(cwd) {
  let raw;
  try { raw = fs.readFileSync(notesPath(cwd), 'utf8').replace(/\r\n?/g, '\n'); } catch { return []; }
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

/**
 * Best-effort references for whatever is attached to this prompt.
 *
 * An attached prompt is passed through instead of collected (blocking would
 * erase the image), so the only way it can still reach the merge is as a note
 * the TURN writes. That note is useless without a pointer back to the file it
 * belonged to — "make it like the screenshot" with no screenshot named is
 * exactly the lost linkage this exists to prevent.
 *
 * @returns {string[]} paths / filenames / urls, de-duplicated, capped
 */
function attachmentRefs(text, hookInput) {
  const refs = [];
  if (hookInput && typeof hookInput === 'object') {
    for (const key of ['attachments', 'images', 'files']) {
      const v = hookInput[key];
      if (!v) continue;
      for (const item of (Array.isArray(v) ? v : [v])) {
        if (typeof item === 'string') { refs.push(item); continue; }
        if (item && typeof item === 'object') {
          const p = item.path || item.file_path || item.filename || item.name || item.url;
          if (p) refs.push(String(p));
        }
      }
    }
  }
  if (typeof text === 'string') {
    for (const m of text.matchAll(/(^|\s)@([\w.\-/\\]+\.[A-Za-z0-9]{1,8})(\s|$)/g)) refs.push(m[2]);
  }
  return [...new Set(refs.filter(Boolean))].slice(0, 20);
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
 * The one hard exception to "the user's own answer wins": a marker the harness
 * intercepts before the hook runs (see HARNESS_RESERVED_PREFIXES) cannot work at
 * all, so it is rejected rather than accepted with a warning.
 *
 * @returns {{ok:true,marker:string,warning:?'wordy'}|{ok:false,reason:'empty'|'too-long'|'harness-reserved'}}
 */
function validateMarker(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const marker = raw.trim().replace(/\s+/g, ' ');
  if (!marker) return { ok: false, reason: 'empty' };
  if (marker.length > MARKER_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (HARNESS_RESERVED_PREFIXES.includes(marker[0])) {
    return { ok: false, reason: 'harness-reserved' };
  }
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
 * The marker actually in force for this project.
 *
 * The mode file wins over the config (it pins the marker the mode was started
 * with), but only if it is still usable: a mode file written before the
 * reserved-prefix rule carries `!`, and returning it would mean no prompt can
 * ever fire the merge.
 *
 * @param {string} cwd
 * @returns {string}
 */
function effectiveMarker(cwd) {
  const pinned = validateMarker(readMode(cwd)?.marker);
  return pinned.ok ? pinned.marker : loadConfig().marker;
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
 * Does this prompt turn collect mode ON — and does it carry work on top?
 *
 * The failure this exists for: the user activates the mode and already types
 * their first observations into the SAME prompt. Collection is not armed yet,
 * so the collect hook cannot catch them; the model sees actionable text, starts
 * working it, and skips the skill's own dialogs. The notes are never filed, the
 * mode is on but empty, and the whole point of batching is gone.
 *
 * The hook cannot fix that by storing the text itself: at UserPromptSubmit time
 * nothing has activated yet, and a note written for a prompt that turns out to
 * be a question ABOUT the mode would be pure corruption. So this only reports
 * the shape, and the hook injects a guard telling the turn what to do with it.
 *
 * `payload` is best-effort and exists for the length heuristic — the split into
 * activation vs. content is made in the turn, against the user's actual words.
 *
 * @param {string} text raw prompt text
 * @returns {{activating:boolean,viaCommand:boolean,carriesContent:boolean,payload:string}}
 */
function detectActivation(text) {
  const none = { activating: false, viaCommand: false, carriesContent: false, payload: '' };
  const s = typeof text === 'string' ? text : '';
  if (!s.trim()) return none;
  // A cron or an AFK resume that happens to say "batch-mode" is not a user
  // turning the mode on, and nothing in such a turn would read the guard's
  // self-escape clause. Same exclusion the collect path already makes.
  if (isMachinePrompt(s)) return none;

  let residue;
  let viaCommand = false;
  const cmd = /<command-name>\s*\/?([\w.-]+)\s*<\/command-name>/i.exec(s);
  if (cmd) {
    // An expanded slash command is unambiguous: either it IS /claude-batch, or
    // it is some other command and none of this applies.
    if (!/claude-batch/i.test(cmd[1])) return none;
    viaCommand = true;
    const args = /<command-args>([\s\S]*?)<\/command-args>/i.exec(s);
    residue = args ? args[1] : '';
  } else {
    const hit = ACTIVATION_PATTERNS.map(rx => rx.exec(s)).find(Boolean);
    if (!hit) return none;
    // Naming the mode is not asking for it. Without this, ordinary prose about
    // the feature ("wir sollten den Sammelmodus dokumentieren, aber davor …")
    // drew the guard into a turn that had nothing to do with collecting.
    if (!SELF_ACTIVATING_PATTERNS.some(rx => rx.test(s))) {
      const clause = clauseAround(s, hit.index).replace(hit[0], ' ');
      if (!ACTIVATION_INTENT.test(clause)) return none;
    }
    residue = s;
    for (const rx of ACTIVATION_PATTERNS) {
      residue = residue.replace(new RegExp(rx.source, 'gi'), ' ');
    }
  }

  const payload = residue.replace(ROUTE_WORDS, ' ').replace(/[\s.,;:!?]+/g, ' ').trim();
  // "Was macht der Sammelmodus?" is a question ABOUT the mode, not an activation
  // carrying notes. Short + interrogative is the reliable shape of that; a long
  // one still trips the guard, which is harmless — the guard says to ignore it
  // when the prompt is not actually activating.
  const asking = looksLikeQuestion(s) && payload.length < 40;
  return {
    activating: true,
    viaCommand,
    carriesContent: !asking && payload.length >= ACTIVATION_CONTENT_MIN,
    payload: residue.trim(),
  };
}

/**
 * The single decision.
 *
 * Order matters. The marker is checked BEFORE the attachment rule, because the
 * two rules exist for opposite reasons: attachments pass through so a blocked
 * prompt can never erase an image, but an execute prompt is never blocked in
 * the first place. Checking attachments first meant `>> so wie hier [Image #1]`
 * — the most natural way to fire a merge — silently downgraded to a plain turn:
 * no notes injected, and the model truthfully reporting that it sees no batch
 * while ten notes sat in the file.
 *
 * @returns {'passthrough'|'collect'|'execute'}
 */
function classify({ text, hookInput, marker, modeActive }) {
  if (isMachinePrompt(text)) return 'passthrough';
  if (isExpandedCommand(text)) return 'passthrough';
  // The marker fires the merge even with the mode already off: an expired or
  // note-capped mode must not swallow the user's only way to reach the queue.
  // The caller decides whether notes actually exist.
  if (startsWithMarker(text, marker)) return 'execute';
  if (!modeActive) return 'passthrough';
  if (hasAttachment(text, hookInput)) return 'passthrough';
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
    return classify({ text, hookInput, marker: effectiveMarker(cwd), modeActive: true }) === 'collect';
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULTS,
  HARNESS_RESERVED_PREFIXES,
  MACHINE_PATTERNS,
  ATTACHMENT_PATTERNS,
  ACTIVATION_PATTERNS,
  ACTIVATION_CONTENT_MIN,
  configPath, claudeDir, notesPath, modePath, activityPath, lockPath,
  loadConfig, saveConfig,
  readMode, isModeActive, expiryReason, activate, deactivate,
  appendNote, readNotes, countNotes, clearNotes, archiveNotes,
  touchActivity, readActivity,
  isMachinePrompt, isExpandedCommand, hasAttachment, attachmentRefs, detectActivation,
  startsWithMarker, stripMarker, looksLikeQuestion,
  validateMarker, markerMatch, effectiveMarker, MARKER_MAX_LENGTH,
  classify, willBeCollected,
};
