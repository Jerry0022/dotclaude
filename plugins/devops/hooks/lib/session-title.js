/**
 * @module session-title
 * @version 0.2.0
 * @description Reads the session's CURRENT sidebar title straight from the
 *   transcript and computes the next one, so a title instruction can hand
 *   Claude the exact `set_session_title` value instead of a
 *   `get_session` → strip → set ritual. Every extra tool round trip re-reads
 *   the whole context: the ritual cost ~3.6 % of all tokens (measured over
 *   100 sessions, ~940 calls). With the title known, the set call rides along
 *   in the turn's first tool batch — no extra API call at all.
 *
 *   Source: the Desktop app appends `{"type":"custom-title","customTitle":…}`
 *   (and a mirroring `{"type":"agent-name","agentName":…}`) to the session
 *   transcript on every rename and re-appends it every few lines, so the last
 *   one sits near the end of the file. Transcripts reach 30 MB — only the tail
 *   is read, growing backwards up to `maxBytes`. `null` means "unknown" (no
 *   transcript, no entry in reach): callers fall back to `get_session`.
 *
 *   CJS so hooks `require` it; mcp-server (ESM) loads it through
 *   `hookRequire("lib", "session-title.js")` in mcp-server/lib/mode-state.js.
 *   The prefix strings mirror `SESSION_PREFIX` / `LEGACY_PREFIXES` there —
 *   session-title.test.js pins them.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Bare hourglass — `SESSION_PREFIX.work` (and `.pending`). */
const WORK_PREFIX = '⏳ ';
/** Legacy worded hourglass — rewritten to the bare form wherever found. */
const LEGACY_PENDING_PREFIX = '⏳ Working – ';
/** The /do-ship process prefix — matched as a whole string (the 🚀 is shared
 *  with the `🚀 Shipped – ` outcome). */
const SHIPPING_PREFIX = '🚀 Shipping – ';
const CONCEPT_PREFIX = '\u{1F9ED} Concept – ';
const CONCEPT_EMOJI = '\u{1F9ED}';
const BATCH_EMOJI = '\u{1F4E5}';
const HOURGLASS = '⏳';

/** Leading emoji of the mode prefixes a skill owns (concept, batch). */
const MODE_PREFIX_EMOJI = [CONCEPT_EMOJI, BATCH_EMOJI];
/** Leading emoji of every outcome prefix a card may leave, the bare ⏳ included. */
const OUTCOME_PREFIX_EMOJI = ['\u{1F680}', '\u{1F38A}', '\u{1F9EA}', '▶️', '\u{1F4E6}', '⛔', '\u{1F6AB}', '\u{1F4CB}', HOURGLASS, '\u{1F527}', '⏸️'];
const KNOWN_PREFIX_EMOJI = [...MODE_PREFIX_EMOJI, ...OUTCOME_PREFIX_EMOJI];

/** `<Word…> – ` after the emoji: "Shipped – ", "Released Stable – ",
 *  "Paused until limit reset – ". Capitalised first word, short. */
const WORDED = /^[A-Z][\p{L}]*(?: [\p{L}]+){0,3} – /u;

/**
 * `title` without every leading devops prefix whose emoji is in `emoji`
 * (stacked prefixes included). A worded prefix ("🧪 Test – ") goes whole; a
 * bare "⏳ " goes as the icon only — the text after it is the title.
 *
 * @param {string} title
 * @param {string[]} [emoji] defaults to every known prefix emoji
 * @returns {string}
 */
function stripPrefixes(title, emoji = KNOWN_PREFIX_EMOJI) {
  let t = String(title ?? '');
  for (;;) {
    const e = emoji.find(x => t.startsWith(x + ' '));
    if (!e) return t;
    const rest = t.slice(e.length + 1);
    const m = rest.match(WORDED);
    if (m) t = rest.slice(m[0].length);
    else if (e === HOURGLASS) t = rest;
    else return t;
  }
}

/**
 * The title prefix work on this prompt should leave, applied to `current`:
 * the new title, or `null` for "leave it as it is".
 *
 * User prompt: `📥 Batch – ` is owned by its skill; a running
 * `🚀 Shipping – ` is never replaced; a bare `⏳ ` title is already marked
 * (the legacy `⏳ Working – ` is not); the concept compass and every outcome
 * prefix yield. Machine turn (a task notification): any mode or outcome
 * prefix stays — only a plain title or a legacy hourglass is marked.
 *
 * @param {string|null} current the title now (`readCurrentTitle`)
 * @param {{ prefix?: string, machine?: boolean }} [opts] prefix: WORK_PREFIX or SHIPPING_PREFIX
 * @returns {string|null}
 */
function nextTitle(current, { prefix = WORK_PREFIX, machine = false } = {}) {
  if (typeof current !== 'string' || !current.trim()) return null;
  const owned = machine ? KNOWN_PREFIX_EMOJI.filter(e => e !== HOURGLASS) : [BATCH_EMOJI];
  if (owned.some(e => current.startsWith(e))) return null;
  if (current.startsWith(SHIPPING_PREFIX)) return null;
  if (prefix !== SHIPPING_PREFIX && current.startsWith(WORK_PREFIX) && !current.startsWith(LEGACY_PENDING_PREFIX)) return null;
  const strippable = machine ? [HOURGLASS] : [CONCEPT_EMOJI, ...OUTCOME_PREFIX_EMOJI];
  const stripped = stripPrefixes(current, strippable);
  if (!stripped.trim()) return null;
  const next = prefix + stripped;
  return next === current ? null : next;
}

/** The title an entry line carries, or undefined when it is no title entry. */
function titleOf(line, type, key) {
  if (!line.includes(`"type":"${type}"`)) return undefined;
  try {
    const o = JSON.parse(line);
    return o && o.type === type && typeof o[key] === 'string' ? o[key] : undefined;
  } catch { return undefined; }
}

/**
 * The session's current title from the transcript tail: the last
 * `custom-title` entry, else the last `agent-name` entry, else `null`
 * (unknown). Reads 64 KB from the end and doubles up to `maxBytes`; never
 * throws.
 *
 * @param {string|undefined} transcriptPath hook input `transcript_path`
 * @param {{ maxBytes?: number, chunk?: number }} [opts]
 * @returns {string|null}
 */
function readCurrentTitle(transcriptPath, { maxBytes = 4 * 1024 * 1024, chunk = 64 * 1024 } = {}) {
  if (!transcriptPath) return null;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    let span = Math.min(size, chunk);
    for (;;) {
      const start = size - span;
      const buf = Buffer.alloc(span);
      fs.readSync(fd, buf, 0, span, start);
      // Drop the partial first line (also keeps a UTF-8 sequence whole).
      const from = start > 0 ? buf.indexOf(0x0a) + 1 : 0;
      const lines = from > 0 || start === 0 ? buf.subarray(from).toString('utf8').split('\n') : [];
      let agent;
      for (let i = lines.length - 1; i >= 0; i--) {
        const custom = titleOf(lines[i], 'custom-title', 'customTitle');
        if (custom !== undefined) return custom;
        if (agent === undefined) agent = titleOf(lines[i], 'agent-name', 'agentName');
      }
      if (start === 0 || span >= maxBytes) return agent !== undefined ? agent : null;
      span = Math.min(size, maxBytes, span * 2);
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/** Claude Code's project-dir name for `cwd`: every non-alphanumeric char
 *  becomes '-' (`C:\a\.b` → `C---a--b`). */
function projectSlug(cwd) {
  return String(cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * The session transcript `~/.claude/projects/<slug>/<sessionId>.jsonl`, or
 * null. `cwd` given → its slug dir first (one stat); otherwise, or when the
 * session started in another dir, one readdir over the project dirs. Callers
 * without a hook `transcript_path` (mcp-server, card-pregate) resolve it here.
 *
 * @param {string|undefined} sessionId
 * @param {string} [home] defaults to os.homedir()
 * @param {string} [cwd]
 * @returns {string|null}
 */
function findTranscript(sessionId, home = os.homedir(), cwd = undefined) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return null;
  const root = path.join(home, '.claude', 'projects');
  const file = `${sessionId}.jsonl`;
  if (cwd) {
    const p = path.join(root, projectSlug(cwd), file);
    if (fs.existsSync(p)) return p;
  }
  let dirs;
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(root, d, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  projectSlug,
  findTranscript,
  WORK_PREFIX,
  LEGACY_PENDING_PREFIX,
  SHIPPING_PREFIX,
  CONCEPT_PREFIX,
  MODE_PREFIX_EMOJI,
  OUTCOME_PREFIX_EMOJI,
  KNOWN_PREFIX_EMOJI,
  stripPrefixes,
  nextTitle,
  readCurrentTitle,
};
