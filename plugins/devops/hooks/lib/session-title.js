/**
 * @module session-title
 * @version 0.4.0
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
 *   The prefix strings and the matching live in lib/title-scheme.js — the
 *   one table the completion card's CTA headings are built from too.
 *   CJS so hooks `require` it; mcp-server (ESM) loads it through
 *   `hookRequire("lib", "session-title.js")` in mcp-server/lib/mode-state.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  WORK_PREFIX, SHIPPING_PREFIX, BATCH_PREFIX, CONCEPT_PREFIX, CONCEPT_WORKING_PREFIX,
  INTERRUPTED_PREFIX, LEGACY_PREFIXES, LEGACY, stripPrefixes, classify, leadingPrefix,
} = require('./title-scheme');

/** Legacy worded hourglass — rewritten to the bare form wherever found. */
const LEGACY_PENDING_PREFIX = LEGACY.working;

/** `current` without its leading prefixes, or null when nothing is left. */
function rest(current) {
  const r = stripPrefixes(current);
  return r.trim() ? r : null;
}

/**
 * The title prefix work on this prompt should leave, applied to `current`:
 * the new title, or `null` for "leave it as it is". The guards read the
 * two-slot grammar (R1) and check the running ship first:
 *
 * User prompt (`prefix` = WORK_PREFIX): the batch title is owned by its
 * skill; a running `⏳ 🚀 Shipping – ` (or its legacy form) is never
 * replaced, nor is any other ⏳ process (Concept working, Agents, Testing);
 * a bare `⏳ ` title is already marked (the legacy `⏳ Working – ` is not).
 * Every other prefix — a waiting concept and every outcome — yields to the
 * bare hourglass; the turn's card sets the next state.
 *
 * A ship (`prefix` = SHIPPING_PREFIX): everything but the batch and an
 * already running ship becomes `⏳ 🚀 Shipping – ` (a legacy
 * `🚀 Shipping – ` is upgraded).
 *
 * Machine turn (a task notification): any known prefix stays — only a plain
 * title or the legacy worded hourglass is marked.
 *
 * @param {string|null} current the title now (`readCurrentTitle`)
 * @param {{ prefix?: string, machine?: boolean }} [opts]
 * @returns {string|null}
 */
function nextTitle(current, { prefix = WORK_PREFIX, machine = false } = {}) {
  if (typeof current !== 'string' || !current.trim()) return null;
  const kind = classify(current);
  const legacyWorking = kind === 'work' && leadingPrefix(current).prefix === LEGACY_PENDING_PREFIX;
  const r = rest(current);
  if (r === null) return null;
  let next;
  if (machine) {
    if (kind !== 'plain' && !legacyWorking) return null;
    next = WORK_PREFIX + r;
  } else if (kind === 'batch') {
    return null;
  } else if (kind === 'shipping') {
    if (prefix !== SHIPPING_PREFIX || current.startsWith(SHIPPING_PREFIX)) return null;
    next = SHIPPING_PREFIX + r;
  } else if (prefix === SHIPPING_PREFIX) {
    next = SHIPPING_PREFIX + r;
  } else if (kind === 'process' || (kind === 'work' && !legacyWorking)) {
    return null;
  } else {
    next = prefix + r;
  }
  return next !== current ? next : null;
}

/**
 * The title arming /do-batch leaves (activation.md § Session title prefix):
 * `👉 📥 Batch – ` in front, every known prefix stripped first so prefixes
 * never stack. `null` when unknown, already marked, or nothing is left.
 *
 * @param {string|null} current
 * @returns {string|null}
 */
function batchTitle(current) {
  if (typeof current !== 'string' || !current.trim()) return null;
  if (current.startsWith(BATCH_PREFIX)) return null;
  const r = rest(current);
  return r ? BATCH_PREFIX + r : null;
}

/**
 * The title retiring /do-batch leaves (merge.md § Retire): exactly the
 * leading batch prefix removed (`👉 📥 Batch – `, or the legacy
 * `📥 Batch – `). `null` when the title does not carry it — a title the
 * user renamed meanwhile wins — or nothing would be left.
 *
 * @param {string|null} current
 * @returns {string|null}
 */
function unbatchTitle(current) {
  if (typeof current !== 'string' || classify(current) !== 'batch') return null;
  const r = current.slice(leadingPrefix(current).length);
  return r.trim() ? r : null;
}

/**
 * F5: the title a turn that ended WITHOUT a completion card leaves. Only a
 * bare `⏳ ` (generic work, or the legacy `⏳ Working – `) becomes
 * `👉 ⚡ Interrupted – <title>`; a batch, a waiting concept, a running ship
 * and every other named state stay (`null`).
 *
 * @param {string|null} current
 * @returns {string|null}
 */
function interruptedTitle(current) {
  if (typeof current !== 'string' || classify(current) !== 'work') return null;
  const r = rest(current);
  return r ? INTERRUPTED_PREFIX + r : null;
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
  LEGACY_PREFIXES,
  SHIPPING_PREFIX,
  CONCEPT_PREFIX,
  CONCEPT_WORKING_PREFIX,
  BATCH_PREFIX,
  INTERRUPTED_PREFIX,
  classify,
  stripPrefixes,
  nextTitle,
  batchTitle,
  unbatchTitle,
  interruptedTitle,
  readCurrentTitle,
};
