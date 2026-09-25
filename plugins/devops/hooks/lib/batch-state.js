/**
 * @module batch-state
 * @version 0.6.0
 * @description State and classification for the `/do-batch` collect mode.
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
const { projectClaudeDir } = require('./project-root');
const { parseOpenUrlPrompt } = require('./open-url');

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
 * The three markers the skill offers on first run, in display order. The
 * first is the recommendation. All English, no trailing colon — a colon reads
 * as a label, and the user types the marker dozens of times per session.
 *
 * Suggestions, not a closed set: whatever the user types via "Other" is the
 * marker, subject only to `validateMarker`.
 */
const MARKER_SUGGESTIONS = ['>>', '>go', '>start'];

/**
 * Machine-prompt patterns. Prompts matching these are NEVER collected.
 *
 * Deliberately re-declared instead of imported from
 * `user-prompt-submit/prompt.flow.silent-turn.js`: that module registers
 * `process.stdin` listeners at load time, so requiring it from inside another
 * hook that reads stdin would fight over the stream.
 *
 * The AUTONOMOUS_* entries are ADDITIONS — they do not match silent-turn's
 * patterns. Without them an AFK `/do-run backlog` or `/do-run autonomous` resume
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
 * Phrases that turn an ordinary prompt into a do-batch invocation.
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
 * `/do-batch on` and friends. Above it the user typed work into the very
 * prompt that turns collection on, and that work must be filed as a note
 * instead of executed.
 */
const ACTIVATION_CONTENT_MIN = 12;

// ── paths ──────────────────────────────────────────────────────────────────

function configPath() {
  return path.join(os.homedir(), '.claude', 'claude-batch.json');
}

/** Anchored at the git work-tree root, never the raw cwd — see project-root.js. */
function claudeDir(cwd) {
  return projectClaudeDir(cwd);
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
    : '# do-batch notes\n\nCollected prompts, newest last. Edit freely — the merge reads this file.\n';
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
  // Image copies of long-finished collections go now (#490) — never those of
  // the collection just archived, which the hand-off still points at.
  try { pruneAssets(cwd); } catch { /* housekeeping only */ }
  return dest;
}

// ── pasted images (Desktop app) ───────────────────────────────────────────

/**
 * The Desktop app sends a pasted image as its own content block: the
 * UserPromptSubmit payload carries neither an `[Image #N]` placeholder nor an
 * attachment key, so `hasAttachment()` cannot see it and the prompt is
 * collected as text only (#490). The image is not lost, though — the harness
 * saves every image pasted into a session to
 * `<tmp>/claude/<project-slug>/<session_id>/images/<n>.<ext>` when the prompt
 * is submitted, and its mtime matches the note's timestamp to the
 * millisecond. A note finds its image by time; a copy next to the notes
 * survives a temp cleanup.
 *
 * Time is the only link the hook has, so it is used carefully: the collect
 * hook takes only images written within IMAGE_MATCH_WINDOW_MS of the prompt,
 * and the merge gives every image still unclaimed to the note NEAREST to it
 * (never simply the first match), marking a match beyond that window as
 * uncertain.
 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** How far an image's mtime may sit from its note for a certain match. */
const IMAGE_MATCH_WINDOW_MS = 3000;

/** Beyond this gap the merge does not guess at all. */
const IMAGE_LATE_MATCH_MAX_MS = 60_000;

/** Copies live here, covered by the same `/.claude/batch*` exclude as the notes.
 *  They are never moved — archived notes keep pointing at valid files. */
function assetsDir(cwd) { return path.join(claudeDir(cwd), 'batch-assets'); }

/** Source image path → its copy, so no image is ever assigned twice. The
 *  harness never reuses an image name within a session, so the path is key. */
function capturedPath(cwd) { return path.join(assetsDir(cwd), 'captured.json'); }

/**
 * Every `images` directory the harness keeps for this session. The project
 * slug is the harness's own encoding of the cwd, so it is globbed, not derived.
 * Symlinked folders are skipped: only what the harness wrote itself counts.
 * @returns {string[]}
 */
function sessionImageDirs(sessionId, tmpRoot = os.tmpdir()) {
  if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return [];
  const base = path.join(tmpRoot, 'claude');
  let slugs;
  try { slugs = fs.readdirSync(base); } catch { return []; }
  const dirs = [];
  for (const slug of slugs) {
    const dir = path.join(base, slug, sessionId, 'images');
    try { if (fs.lstatSync(dir).isDirectory()) dirs.push(dir); } catch { /* not this slug */ }
  }
  return dirs;
}

/** @returns {{file:string, mtimeMs:number, size:number}[]} plain image files, no symlinks */
function listImagesIn(dirs) {
  const out = [];
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!IMAGE_EXT.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.lstatSync(file);
        if (st.isFile()) out.push({ file, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* vanished */ }
    }
  }
  return out;
}

function readCaptured(cwd) {
  try {
    const v = JSON.parse(fs.readFileSync(capturedPath(cwd), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** This session's images that no note has taken yet. */
function unclaimedImages(cwd, dirs) {
  const captured = readCaptured(cwd);
  return listImagesIn(dirs).filter(img => !captured[img.file]);
}

/**
 * Copy images into `.claude/batch-assets/` under the note's timestamp and
 * record them as taken. The manifest is written via rename, so a hook killed
 * mid-write never leaves a torn file.
 * @returns {string[]} absolute paths of the copies, oldest image first
 */
function claimImages(cwd, images, at) {
  if (!images.length) return [];
  const sorted = [...images].sort((a, b) => a.mtimeMs - b.mtimeMs);
  fs.mkdirSync(assetsDir(cwd), { recursive: true });
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
  const captured = readCaptured(cwd);
  let n = 0;
  const copies = sorted.map((img) => {
    // A note can gain images twice (collect + merge): never overwrite a copy.
    let dest;
    do {
      n += 1;
      dest = path.join(assetsDir(cwd), `${stamp}-${n}${path.extname(img.file).toLowerCase()}`);
    } while (fs.existsSync(dest));
    fs.copyFileSync(img.file, dest);
    captured[img.file] = dest;
    return dest;
  });
  const tmp = `${capturedPath(cwd)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(captured, null, 2), 'utf8');
  fs.renameSync(tmp, capturedPath(cwd));
  return copies;
}

/**
 * The unclaimed images written within the window of `at` — the ones pasted
 * into the prompt submitted at that moment.
 * @param {{tmpRoot?:string, windowMs?:number, dirs?:string[]}} [opts]
 */
function imagesNear(cwd, sessionId, at, opts = {}) {
  const windowMs = opts.windowMs ?? IMAGE_MATCH_WINDOW_MS;
  const dirs = opts.dirs || sessionImageDirs(sessionId, opts.tmpRoot);
  return unclaimedImages(cwd, dirs).filter(img => Math.abs(img.mtimeMs - at) <= windowMs);
}

/**
 * Copy this session's images pasted at `at` next to the notes.
 * @returns {string[]} absolute paths of the copies
 */
function captureSessionImages(cwd, sessionId, at, opts = {}) {
  return claimImages(cwd, imagesNear(cwd, sessionId, at, opts), at);
}

/**
 * Merge-time assignment: every unclaimed image goes to the note whose
 * timestamp is NEAREST to it — two notes seconds apart must not both reach
 * for one image, and the earlier one must not win just by coming first. An
 * image nearer to the marker prompt than to any note belongs to that prompt
 * and is left alone; one further than IMAGE_LATE_MATCH_MAX_MS from every note
 * is not guessed at.
 *
 * @param {{at:string}[]} notes
 * @param {{file:string, mtimeMs:number}[]} images
 * @param {number} markerAt epoch ms of the prompt that fired the merge
 * @returns {Map<number, {img:object, gapMs:number}[]>} note index → its images
 */
function assignImagesToNotes(notes, images, markerAt) {
  const times = notes.map(n => Date.parse(n.at));
  const byNote = new Map();
  for (const img of images) {
    let best = -1;
    let gap = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(img.mtimeMs - t);
      if (Number.isFinite(d) && d < gap) { gap = d; best = i; }
    });
    if (best < 0 || gap > IMAGE_LATE_MATCH_MAX_MS) continue;
    if (Number.isFinite(markerAt) && Math.abs(img.mtimeMs - markerAt) < gap) continue;
    if (!byNote.has(best)) byNote.set(best, []);
    byNote.get(best).push({ img, gapMs: gap });
  }
  return byNote;
}

/** Image copies older than this are removed when a collection is archived. */
const ASSET_MAX_AGE_DAYS = 30;

/**
 * Remove image copies older than `maxAgeDays` and forget them in the manifest.
 * Runs when a merge archives its notes: by then every copy of THAT collection
 * is at most a few days old, so only collections long since implemented lose
 * their images. The manifest keeps its source entries (so an old image is
 * never claimed again) but drops the pointer to the deleted copy.
 *
 * @returns {string[]} removed copy paths
 */
function pruneAssets(cwd, { maxAgeDays = ASSET_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const dir = assetsDir(cwd);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const cutoff = now - maxAgeDays * 86_400_000;
  const removed = [];
  for (const name of names) {
    if (name === 'captured.json' || !IMAGE_EXT.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(file); removed.push(file); }
    } catch { /* vanished */ }
  }
  if (removed.length) {
    const gone = new Set(removed);
    const captured = readCaptured(cwd);
    // A truthy marker, not null: the source must still count as taken.
    for (const [src, copy] of Object.entries(captured)) if (gone.has(copy)) captured[src] = 'pruned';
    const tmp = `${capturedPath(cwd)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(captured, null, 2), 'utf8');
    fs.renameSync(tmp, capturedPath(cwd));
  }
  return removed;
}

/** The note lines that tie copies to their note — the merge opens each one. */
function attachmentFileLines(copies) {
  return copies.map(p => `[Anhang-Datei] ${p}`).join('\n');
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
 * literally "/do-batch off". Comparing against the typed form would miss
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

// ── invocation routing ─────────────────────────────────────────────────────

/** First-token routes of `/do-batch <arg>`, mirroring the skill's Step 1. */
const BATCH_ROUTES = {
  on:     /^(on|an|start)$/i,
  off:    /^(off|aus|stop)$/i,
  go:     /^(go|los|merge)$/i,
  marker: /^marker$/i,
  status: /^status$/i,
  help:   /^(help|hilfe|\?)$/i,
};

/**
 * Routes the hook absorbs itself while the mode is already ON.
 *
 * `/do-batch`, `/do-batch on` and `/do-batch <text>` while
 * collecting are not requests for a turn: the user either forgot the mode is
 * on, or is filing a note through the command. `help` is a static text.
 * Letting any of them reach the model costs a full turn — the exact cost the
 * mode exists to avoid. `off`, `go`, `status` and `marker` are the exits and
 * stay passthrough, as does anything carrying an attachment (Step 2.6).
 */
const REARM_ROUTES = new Set(['bare', 'on', 'content', 'help']);

/**
 * Is this prompt a `/do-batch` invocation, and which route does it take?
 *
 * Accepts the expanded form (`<command-name>` tag, what the harness delivers)
 * and the raw form (`/do-batch …` at line start) so the decision does not
 * depend on which one a given runtime hands over. Routes on the FIRST token
 * only; everything after it is `residue` — note content, never an instruction.
 *
 * @param {string} text
 * @returns {{route:'bare'|'on'|'off'|'go'|'marker'|'status'|'content',residue:string}|null}
 */
function parseBatchCommand(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s.trim()) return null;
  let args;
  const cmd = /<command-name>\s*\/?([\w.:-]+)\s*<\/command-name>/i.exec(s);
  if (cmd) {
    if (!/(?:^|[:/])(?:do|claude)-batch$/i.test(cmd[1])) return null;
    const a = /<command-args>([\s\S]*?)<\/command-args>/i.exec(s);
    args = a ? a[1] : '';
  } else {
    const raw = /^\s*\/(?:devops:)?(?:do|claude)-batch(?=\s|$)([\s\S]*)$/i.exec(s);
    if (!raw) return null;
    args = raw[1];
  }
  args = args.trim();
  if (!args) return { route: 'bare', residue: '' };
  const m = /^(\S+)([\s\S]*)$/.exec(args);
  for (const [route, rx] of Object.entries(BATCH_ROUTES)) {
    if (rx.test(m[1])) return { route, residue: m[2].trim() };
  }
  return { route: 'content', residue: args };
}

// ── mode summary ───────────────────────────────────────────────────────────

/**
 * The one block that explains the running mode — shown at activation, on
 * every collected prompt, and when a re-activation is absorbed. One source so
 * the three places can never drift apart: what happens to a prompt, how to
 * fire the merge, how to only stop, and when the mode ends on its own.
 *
 * @param {{marker:string,count?:number,expiryHours?:number,maxNotes?:number}} p
 */
function renderModeSummary(p) {
  const marker = p.marker || DEFAULTS.marker;
  const hours = p.expiryHours ?? DEFAULTS.expiryHours;
  const max = p.maxNotes ?? DEFAULTS.maxNotes;
  const count = typeof p.count === 'number' ? ` · ${p.count} Notiz(en)` : '';
  return [
    `Sammelmodus AKTIV${count} · Marker "${marker}"`,
    `• Sammeln:    jeder Prompt ohne Marker landet als Notiz in .claude/batch.md.`,
    `              Das rote "Eingabe blockiert"-Panel ist dabei normal, kein Fehler.`,
    `• Umsetzen:   "${marker} <text>" oder /do-batch go — merged zuerst main in den`,
    `              Branch, liest alle Notizen und plant EINE Umsetzung. Text nach dem`,
    `              Marker ist Anweisung für diese nächste Phase.`,
    `• Abschalten: /do-batch off — beendet nur das Sammeln, Notizen bleiben;`,
    `              /do-batch on sammelt später weiter (auch nach dem Auto-Ende).`,
    `• Auto-Ende:  nach ${hours} Stunden oder ${max} Notizen.`,
    `• Sonstiges:  /do-batch status · marker (Marker ändern) · help (Ablauf ausführlich).`,
  ].join('\n');
}

/**
 * The long form of the summary — `/do-batch help`. Two lists: what the
 * user does, step by step, and what Claude does at each of those steps. Shown
 * by the hook while collecting (costs nothing) and by the skill otherwise.
 *
 * @param {{marker?:string,expiryHours?:number,maxNotes?:number}} [p]
 */
function renderHelp(p = {}) {
  const marker = p.marker || DEFAULTS.marker;
  const hours = p.expiryHours ?? DEFAULTS.expiryHours;
  const max = p.maxNotes ?? DEFAULTS.maxNotes;
  return [
    'do-batch — Sammelmodus: erst sammeln, dann EINMAL gebündelt umsetzen.',
    '',
    'A) Was DU machst',
    '1. /do-batch                 Einschalten. Beim ersten Mal fragt Claude nach dem',
    `                             Ausführungs-Marker (aktuell "${marker}"). Text hinter dem`,
    '                             Aufruf wird sofort Notiz #1.',
    '2. Prompts tippen            Jeder Prompt ohne Marker wird Notiz. Das rote',
    '                             "Eingabe blockiert"-Panel ist normal, kein Fehler.',
    '                             Screenshots und @Dateien gehen zu Claude durch, der',
    '                             sie nur als Notiz ablegt — nicht bearbeitet.',
    `${`3. "${marker} <text>"`.padEnd(29)}Umsetzung starten (oder /do-batch go). Text hinter`,
    '                             dem Marker ist Anweisung für diese Phase.',
    '4. Plan übernehmen           Claude legt EINEN Plan vor und übergibt ihn: offene',
    '                             Entscheidungen → Concept-Seite, sonst → do-run',
    '                             (dessen Fragen sind die Freigabe). Der Modus ist aus.',
    '',
    'Weitere Befehle: /do-batch off (nur stoppen, Notizen bleiben) · on (weiter',
    'sammeln, auch nach dem Auto-Ende) · status · marker (Ausführungs-Marker ändern)',
    `· help. Auto-Ende nach ${hours} Stunden oder ${max} Notizen — der Marker erreicht`,
    'die Notizen auch danach.',
    '',
    'B) Was CLAUDE macht',
    '1. Einschalten     Marker sichern, Modus-Datei schreiben, .claude/batch.md aus',
    '                   git ausschließen, Erinnerungs-Watchdog starten.',
    '2. Sammeln         Ein Hook stoppt den Prompt VOR dem Modell (kostet nichts) und',
    '                   hängt ihn wörtlich an .claude/batch.md an.',
    '3. Auslösen        main in den Branch mergen (Konflikte zuerst lösen), alle',
    '                   Notizen lesen, Abdeckungsliste #1…#N mit Disposition, Machbarkeit',
    '                   gegen den echten Code prüfen, Widersprüche einzeln nennen, EINEN',
    '                   Plan vorlegen.',
    '4. Übergeben       Notizen archivieren (nie löschen), Modus aus, Watchdog stoppen,',
    '                   dann den Plan weiterreichen: offene Entscheidungen → Concept-',
    '                   Seite, sonst → do-run ohne dessen Frage "Was?". do-batch setzt',
    '                   selbst nichts um.',
  ].join('\n');
}

/** `renderModeSummary` filled from the live state of `cwd`. */
function describeMode(cwd) {
  const mode = readMode(cwd);
  const cfg = loadConfig();
  let expiryHours = cfg.expiryHours;
  if (mode?.startedAt && mode?.expiresAt) {
    const h = (Date.parse(mode.expiresAt) - Date.parse(mode.startedAt)) / 3600_000;
    if (Number.isFinite(h) && h > 0) expiryHours = Math.round(h * 10) / 10;
  }
  return renderModeSummary({
    marker: effectiveMarker(cwd),
    count: countNotes(cwd),
    expiryHours,
    maxNotes: mode?.maxNotes ?? cfg.maxNotes,
  });
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
    // An expanded slash command is unambiguous: either it IS /do-batch, or
    // it is some other command and none of this applies.
    if (!/(?:do|claude)-batch/i.test(cmd[1])) return none;
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
 * `rearm`: a `/do-batch` invocation that would only switch on a mode that
 * is already on (bare, `on`, or free text = a note). The hook absorbs it —
 * stores the residue as a note, answers with the mode summary, exit 2 — so
 * repeating the activation never costs a turn. The exits (`off`, `go`,
 * `status`, `marker`) and anything with an attachment stay `passthrough`.
 *
 * A card's open prompt (`Im Standardbrowser öffnen: <url>`) is never a note:
 * prompt.flow.open-url opens the page and blocks it itself.
 *
 * @returns {'passthrough'|'collect'|'execute'|'rearm'}
 */
function classify({ text, hookInput, marker, modeActive }) {
  if (isMachinePrompt(text)) return 'passthrough';
  if (parseOpenUrlPrompt(text)) return 'passthrough';
  const inv = parseBatchCommand(text);
  if (inv) {
    if (modeActive && REARM_ROUTES.has(inv.route) && !hasAttachment(text, hookInput)) return 'rearm';
    return 'passthrough';
  }
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
 * A card's open prompt counts too, mode on or off: prompt.flow.open-url blocks
 * it the same way (it only lets it through when the browser cannot start).
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
    const text = hookInput.prompt || hookInput.user_message || hookInput.message || '';
    if (parseOpenUrlPrompt(text)) return true;
    const cwd = hookInput.cwd || process.cwd();
    if (!isModeActive(cwd)) return false;
    const verdict = classify({ text, hookInput, marker: effectiveMarker(cwd), modeActive: true });
    return verdict === 'collect' || verdict === 'rearm';
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULTS,
  MARKER_SUGGESTIONS,
  HARNESS_RESERVED_PREFIXES,
  MACHINE_PATTERNS,
  ATTACHMENT_PATTERNS,
  ACTIVATION_PATTERNS,
  ACTIVATION_CONTENT_MIN,
  configPath, claudeDir, notesPath, modePath, activityPath, lockPath,
  loadConfig, saveConfig,
  readMode, isModeActive, expiryReason, activate, deactivate,
  appendNote, readNotes, countNotes, clearNotes, archiveNotes,
  IMAGE_MATCH_WINDOW_MS, IMAGE_LATE_MATCH_MAX_MS, assetsDir, sessionImageDirs, listImagesIn, unclaimedImages,
  claimImages, imagesNear, captureSessionImages, assignImagesToNotes, attachmentFileLines,
  ASSET_MAX_AGE_DAYS, pruneAssets,
  touchActivity, readActivity,
  isMachinePrompt, isExpandedCommand, hasAttachment, attachmentRefs, detectActivation,
  parseBatchCommand, REARM_ROUTES, renderModeSummary, describeMode, renderHelp,
  startsWithMarker, stripMarker, looksLikeQuestion,
  validateMarker, markerMatch, effectiveMarker, MARKER_MAX_LENGTH,
  classify, willBeCollected,
};
