'use strict';
/**
 * @module run-contract-store
 * @version 0.4.0
 * @plugin devops
 * @description Run-contract persistence: paths, atomic JSON / JSONL io,
 *   lifecycle (arm / update / claim / record / close), expiry + archive and
 *   the pending-arm / batch-handoff markers. Split out of run-contract.js
 *   (AUD-016) — run-contract.js stays the facade every caller requires.
 *
 *   State lives in the WORK-TREE root (`project-root.js`), next to
 *   `strict-mode.json`:
 *     .claude/run-contract.json          header (atomic temp + rename writes)
 *     .claude/run-contract.json.lock     short-lived mutex for update()/close() (AUD-017)
 *     .claude/run-contract.json.corrupt-<ts>-<pid>-<rand>  quarantined unreadable
 *                                         header copies, a few kept, oldest dropped (AUD-022, RT1-R4)
 *     .claude/run-contract.json.corrupt.pending  one-shot "announce it" marker (AUD-022)
 *     .claude/run-contract.events.jsonl  append-only events, one JSON per line
 *     .claude/run-contract.prev.json     archive of the replaced / expired one
 *     .claude/run-contract.pending       arm marker (do-run Skill ran, no answers yet)
 *     .claude/batch-handoff.json         do-batch fired, hand-off pending
 *   hasState(cwd, {pending, batch}) is the hooks' fast-path existence probe
 *   over these names, so no hook spells them out itself.
 *   Every fs error is swallowed and behaves as "no contract".
 *   Kill switch: DOTCLAUDE_RUN_CONTRACT=off → no contract, no marker, no gate.
 *
 * AUD-022 (corrupt header): a header that fails to parse is re-read once
 *   after a short pause (a concurrent atomic rename may be mid-flight), and
 *   if still unreadable is quarantined (renamed, never deleted) rather than
 *   silently treated as "no contract" forever. `expiryNotice()` — the one
 *   channel a running session already gets a once-only notice through —
 *   surfaces it the next time a hook asks.
 * AUD-017 (close always wins): `update()` and `close()` both take a short
 *   file lock (`fs 'wx'`, stale after 1 s) around their read-modify-write so
 *   a close() landing between update()'s read and write can no longer be
 *   overwritten by update()'s stale patch. RT1-R6: `close()` never gives up
 *   just because the lock could not be taken — it writes without the lock
 *   rather than silently drop the close. RT1-R7: the lock file carries a
 *   pid+nonce token; `releaseLock()` only unlinks a lock that still holds
 *   its own token, and a stale takeover renames the file away (verifying it
 *   is really the stale copy) instead of unlinking it outright.
 * AUD-018 (events cap): `readEventLines()` caches by file size + mtime
 *   (cheap re-read within one process); `record()` compacts the JSONL past
 *   a line threshold, dropping foreign/previous-contract lines and, within
 *   each segment, the `block`/`measure`/`card` lines obligations never read
 *   (only the segment's last `measure` and any release-equivalent `card`
 *   matter — see run-contract-obligations.js). RT1-R8: compaction runs
 *   under the header lock, re-checks the events file size right before the
 *   rename (a lock-free `record()` append that raced in is never silently
 *   lost — the compaction is simply skipped, tried again next time), and
 *   the header persists the line count as of the last compaction so the
 *   trigger is "grown past the cap since then", not "still above the cap"
 *   (a compacted-but-still-large file no longer gets rewritten on every
 *   single record() call).
 * RT1-R3 (corrupt vs transient read error): `readJsonStrict()` tells a
 *   read failure (EBUSY/EPERM — a scanner/indexer holding the file) apart
 *   from a successful read whose bytes fail to parse. Only the latter is
 *   ever quarantined; a read error leaves the header alone and this call
 *   just sees "no contract", same as any other transient fs hiccup.
 * RT2-Q3 (lock deadline vs spin): `acquireLock()`'s two EEXIST branches
 *   (stat/read failing, and `takeoverStaleLock()` returning false) now hit
 *   the same deadline check + sleep as every other retry before looping —
 *   an unreadable/unrenamable stale lock (Windows) no longer spins at
 *   100% CPU forever; it gives up at `lockWaitMs` like any other contention.
 * RT2-Q7a (update() vs a lock it lost): `update()` can lose its header lock
 *   to the 1 s stale-lock takeover while still mid read-modify-write; a
 *   close() landing AFTER `update()`'s own "fresh" read but BEFORE its write
 *   used to be silently dropped. `update()` now re-reads the header once
 *   more, immediately before the atomic write and still under whatever lock
 *   it holds, and refuses ONLY the write that would drop a closedAt the
 *   fresh read never saw (a close landing before the fresh read already
 *   survives — `next` merges fresh's closedAt through untouched).
 * RT2-Q7b (quarantine rename-back): `renameSync` REPLACES an existing
 *   target on both Windows and POSIX, so putting a false-positive
 *   quarantine copy back could clobber a header a concurrent `arm()` wrote
 *   at the live path in the meantime. `quarantineCorrupt()` now checks the
 *   live path is still empty right before the rename-back and keeps the
 *   quarantined copy instead of overwriting an occupied one.
 * H3/H4/H5/H6 (harden pass): `acquireLock()` unlinks the zero-byte lock file
 *   it just created if `writeSync` throws after `openSync('wx')` succeeded
 *   (H3), and only accepts a finite, non-negative `lockStaleMs`/`lockWaitMs`
 *   override — NaN/Infinity fall back to the defaults instead of spinning or
 *   never giving up (H4). `takeoverStaleLock()` retries the rename-back once
 *   after `LOCK_RETRY_MS` before giving up, and never unlinks a refreshed
 *   lock it could not put back (H5). `compactEvents()` sorts `kept` by each
 *   event's original read order, not `Date.parse(ev.t)` — a same-millisecond
 *   tie or a missing `t` can no longer drift an event across a segment
 *   boundary on re-read (H6).
 * RT2-Q4 (worktree root, display-only guard): the header now carries `root`
 *   — the work-tree root `arm()` ran in — so `mode-state.js`'s lenient
 *   sessionId path (a run-contract.json Desktop copied into a fresh
 *   worktree) can tell it apart from this worktree's own contract. A header
 *   without the field (written before this change) reads back `root: null`
 *   and behaves exactly as before.
 */

const fs = require('fs');
const path = require('path');
const { projectClaudeDir, projectRoot } = require('./project-root');

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
  // RT1-R8: events line count as of the last compaction — record()'s
  // auto-compact trigger is "grown past the cap since then", not "still
  // above the cap" (see compactEvents()).
  compactedAtLines: 0,
  // RT2-Q4: the work-tree root arm() ran in (project-root.js), normalised.
  // Desktop can copy an untracked run-contract.json from the main checkout
  // into a fresh worktree; mode-state.js's lenient sessionId path uses this
  // to tell "this worktree's own contract" from a copied-in stranger's. A
  // header written before this field existed reads back as null and the
  // lenient path behaves exactly as it always has.
  root: null,
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
function lockPath(cwd) { return fileIn(cwd, `${FILES.header}.lock`); }
// RT1-R4: each quarantine gets its own unique name (never a fixed
// `.corrupt` that a second quarantining process could unlink from under the
// first one, or that could clobber a fresh header raced in by a concurrent
// arm()). `corruptPrefix` is the common prefix every quarantine copy shares.
function corruptPrefix() { return `${FILES.header}.corrupt-`; }
function corruptUniquePath(cwd, now) {
  return fileIn(cwd, `${corruptPrefix()}${now}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
}
function corruptPendingPath(cwd) { return fileIn(cwd, `${FILES.header}.corrupt.pending`); }

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

function fileExists(file) {
  try { fs.accessSync(file); return true; } catch { return false; }
}

/**
 * The hooks' fast path (pre / post.run.contract): any run-contract state in
 * `cwd`'s work-tree root worth loading the facade for? Existence only —
 * nothing is read, parsed or checked for freshness. The header and the
 * corrupt-quarantine marker always count (R5: the marker can be the only
 * file left once a corrupt header was quarantined, and its one-shot notice
 * must still reach the session); `pending` adds the do-run arm marker,
 * `batch` the do-batch hand-off marker. Not on the facade: the hooks ask
 * before they load it.
 * @param {string} cwd
 * @param {{pending?: boolean, batch?: boolean}} [opts]
 * @returns {boolean}
 */
function hasState(cwd, { pending = false, batch = false } = {}) {
  const files = [contractPath(cwd), corruptPendingPath(cwd)];
  if (pending) files.push(pendingPath(cwd));
  if (batch) files.push(batchHandoffPath(cwd));
  return files.some(fileExists);
}

/** A regular file at `file`? (a directory sitting there is a structural
 * obstruction, not a corrupt header — never quarantine it, AUD-001.) */
function isRegularFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * RT1-R3: like readJson(), but tells apart a READ failure (file missing, or
 * a transient EBUSY/EPERM from an AV scanner / indexer holding the file for
 * a few ms) from bytes that were read fine but fail to parse (or parse to
 * something that isn't a header-shaped object). Only the latter is real
 * corruption — a caller must never quarantine on a read error.
 * @returns {{value: object|null, readError?: true, parseError?: true}}
 */
function readJsonStrict(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { value: null, readError: true };
  }
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { value: v };
    return { value: null, parseError: true };
  } catch {
    return { value: null, parseError: true };
  }
}

function writeTextAtomic(file, text) {
  // H-B12: `tmp` lives outside the try so a write that created the temp file
  // and then threw (ENOSPC / EPERM mid-write) does not leave it behind.
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    unlinkQuiet(tmp);
    return false;
  }
}

function writeJsonAtomic(file, obj) {
  return writeTextAtomic(file, JSON.stringify(obj, null, 2) + '\n');
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

// ── AUD-017: a short mutex around update()/close() read-modify-write ───────
// Both call this around their critical section; a lock file (`fs 'wx'`,
// exclusive create) is safe across processes, not just within this one. A
// lock older than LOCK_STALE_MS is treated as abandoned (a crashed holder)
// and taken over; a caller that still cannot get in after LOCK_MAX_WAIT_MS
// gives up (returns null) rather than blocking indefinitely.
const LOCK_STALE_MS = 1000;
const LOCK_RETRY_MS = 5;
const LOCK_MAX_WAIT_MS = 1000;
// RT1-R6: on Windows, open('wx') on a lock file that is delete-pending (a
// concurrent unlink/rename mid-flight) surfaces as EPERM/EBUSY/EACCES, not
// EEXIST. Treated as "someone else has it" too — retried until the
// deadline, not given up on immediately (which used to silently answer
// update()/close() with null and drop the write).
const LOCK_RETRIABLE = new Set(['EEXIST', 'EPERM', 'EBUSY', 'EACCES']);

/**
 * RT1-R7: rename the stale lock out of the way instead of unlinking it —
 * unlink-after-stat is a race (a second process can unlink the fresh lock
 * the first process just re-created). The renamed copy's content is
 * compared against what was observed at staleness-detection time; a
 * mismatch means someone refreshed the lock between the stat and this
 * rename, so it is put back rather than dropped.
 * @returns {boolean} true if the stale lock was actually taken over
 */
function takeoverStaleLock(file, observedContent) {
  const junk = `${file}.stale-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.renameSync(file, junk);
  } catch {
    return false; // already gone / already taken over by someone else
  }
  let content = null;
  try { content = fs.readFileSync(junk, 'utf8'); } catch { /* best effort */ }
  if (content !== null && content !== observedContent) {
    // H5: the lock was refreshed between the stat and this rename — put it
    // back. A first rename-back failure (Windows EPERM/EBUSY on the target)
    // gets one retry after a short pause; if it still fails, do NOT unlink
    // the moved copy (that would drop the other holder's live token) — keep
    // it quarantined under its junk name and report "not taken over" so the
    // caller retries through the normal deadline/sleep instead.
    try { fs.renameSync(junk, file); return false; } catch { /* retry below */ }
    sleepSync(LOCK_RETRY_MS);
    try { fs.renameSync(junk, file); return false; } catch { return false; }
  }
  unlinkQuiet(junk);
  return true;
}

/** @returns {string|null} the lock token to pass to releaseLock(), or null (gave up) */
function acquireLock(cwd, opts = {}) {
  const file = lockPath(cwd);
  // H4: `typeof x === 'number'` accepts NaN/Infinity — a NaN deadline is
  // never reached (the for(;;) never gives up) and a NaN staleMs never
  // takes a lock over. Only a finite, non-negative override replaces the
  // default.
  const staleMs = Number.isFinite(opts.lockStaleMs) && opts.lockStaleMs >= 0 ? opts.lockStaleMs : LOCK_STALE_MS;
  const maxWaitMs = Number.isFinite(opts.lockWaitMs) && opts.lockWaitMs >= 0 ? opts.lockWaitMs : LOCK_MAX_WAIT_MS;
  const deadline = Date.now() + maxWaitMs;
  const token = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, token);
      fs.closeSync(fd);
      return token;
    } catch (e) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        // H3: openSync('wx') already succeeded — this zero-byte lock file is
        // ours — but writeSync threw (ENOSPC / EPERM mid-write). Remove it:
        // left behind, every other waiter rides out the full stale window,
        // and our own next retry would hit EEXIST on our own orphan.
        unlinkQuiet(file);
      }
      if (!e || !LOCK_RETRIABLE.has(e.code)) return null; // unexpected fs error: don't block
      if (e.code === 'EEXIST') {
        let st, content;
        try {
          st = fs.statSync(file);
          content = fs.readFileSync(file, 'utf8');
        } catch {
          // Q3: lock vanished, or is unreadable (Windows: a stale lock whose
          // stat/read keeps throwing) between EEXIST and stat/read. Retry,
          // but through the SAME deadline check + sleep every other branch
          // uses — without it this spins at 100% CPU forever instead of
          // giving up at lockWaitMs.
          if (Date.now() >= deadline) return null;
          sleepSync(LOCK_RETRY_MS);
          continue;
        }
        if (Date.now() - st.mtimeMs > staleMs) {
          // Q3: takeoverStaleLock() can itself fail to rename (unrenamable
          // stale lock) and return false — still subject to the deadline
          // and sleep before the next loop iteration, not an immediate spin.
          takeoverStaleLock(file, content);
          if (Date.now() >= deadline) return null;
          sleepSync(LOCK_RETRY_MS);
          continue;
        }
      }
      if (Date.now() >= deadline) return null;
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

/** Unlink the lock only if it still holds `token` — never remove a lock someone else took over. */
function releaseLock(cwd, token) {
  const file = lockPath(cwd);
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return; } // already gone
  if (content !== token) return; // no longer ours (a stale takeover raced past us)
  unlinkQuiet(file);
}

// ── AUD-022: quarantine an unreadable header rather than lose it ───────────
const CORRUPT_RETRY_MS = 30;
const CORRUPT_KEEP_MAX = 3;

/** Drop all but the newest CORRUPT_KEEP_MAX quarantine copies (oldest first). */
function pruneQuarantine(cwd) {
  const dir = projectClaudeDir(cwd);
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  const prefix = corruptPrefix();
  const matches = names.filter(n => n.startsWith(prefix)).sort(); // ts prefix sorts chronologically
  for (const n of matches.slice(0, -CORRUPT_KEEP_MAX)) unlinkQuiet(path.join(dir, n));
}

/**
 * Rename the corrupt header out of the way; never overwrite older data
 * silently. RT1-R4: renamed to a unique name (not a fixed `.corrupt`) so a
 * second quarantining process can never unlink the first one's copy, and
 * the renamed bytes are re-read and put back if they turn out to parse —
 * a fresh header a concurrent arm() raced in under us, not real corruption.
 */
function quarantineCorrupt(cwd, opts = {}) {
  const file = contractPath(cwd);
  const dest = corruptUniquePath(cwd, nowOf(opts));
  try {
    fs.renameSync(file, dest);
  } catch {
    return; // already gone / raced away: nothing left to quarantine
  }
  const r = readJsonStrict(dest);
  if (r.value && r.value.v === 1 && typeof r.value.id === 'string') {
    // Q7b: renameSync REPLACES an existing target on both Windows and POSIX
    // — a plain rename-back could clobber a fresh header a concurrent arm()
    // already wrote at `file` in the gap since we renamed it out. Check
    // right before renaming back; if `file` is occupied again, keep the
    // quarantined copy instead of overwriting whatever is there now.
    if (!fileExists(file)) {
      try { fs.renameSync(dest, file); return; } catch { /* `file` reappeared meanwhile:
        fall through and keep the copy quarantined below rather than lose it */ }
    }
  }
  pruneQuarantine(cwd);
  try { fs.writeFileSync(corruptPendingPath(cwd), '', 'utf8'); } catch { /* best effort */ }
}

/** The one-shot "a header was quarantined" notice, or null (none pending). */
function corruptNotice(cwd) {
  if (!fileExists(corruptPendingPath(cwd))) return null;
  unlinkQuiet(corruptPendingPath(cwd));
  return `[run-contract] A corrupt run-contract.json was found and quarantined (run-contract.json.corrupt-*) — its gates were off. Still in a do-run? Re-arm: ${rearmHint()}`;
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

function readRawContract(cwd, opts = {}) {
  const file = contractPath(cwd);
  // AUD-022 / RT1-R3: readJsonStrict() tells "unreadable" (transient — a
  // scanner/indexer holding the file, or no file at all) apart from
  // "readable but fails to parse" (real corruption). Only the latter, and
  // only when a regular file is actually there — a directory sitting at the
  // path (AUD-001's fallback-arm write-failure fixture) is a structural
  // obstruction, not a corrupt header — ever gets quarantined. A read error
  // just behaves as "no contract this call", same as any other fs hiccup.
  let r = readJsonStrict(file);
  if (r.parseError && isRegularFile(file)) {
    // A concurrent atomic rename (arm/update/close all write temp+rename)
    // can be caught mid-flight — one short retry before treating it as real
    // corruption.
    sleepSync(CORRUPT_RETRY_MS);
    r = readJsonStrict(file);
    if (r.parseError && isRegularFile(file)) {
      quarantineCorrupt(cwd, opts);
      return null;
    }
  }
  const h = r.value;
  // H-B6: normalised on read — a hand-edited / older header without the
  // `passes` / `items` arrays must not throw in the gates (pre's catch-all
  // would turn that into "allow every call").
  return h && h.v === 1 && typeof h.id === 'string' ? sanitize(h) : null;
}

// AUD-018: every gate re-reads the whole events file. A file-level cache
// keyed by size + mtime avoids re-parsing it for calls that land in the same
// process without the file changing underneath (arm/record/close all touch
// mtime on write, so a stale hit is impossible).
let eventsCache = null; // { file, size, mtimeMs, lines }

function readEventLines(cwd) {
  const file = eventsPath(cwd);
  let st;
  try { st = fs.statSync(file); } catch { eventsCache = null; return []; }
  if (eventsCache && eventsCache.file === file && eventsCache.size === st.size && eventsCache.mtimeMs === st.mtimeMs) {
    return eventsCache.lines;
  }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { eventsCache = null; return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === 'object' && typeof ev.k === 'string') out.push(ev);
    } catch { /* torn line */ }
  }
  eventsCache = { file, size: st.size, mtimeMs: st.mtimeMs, lines: out };
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

// AUD-018: cap the JSONL. Triggered from record() once the file holds more
// than EVENTS_COMPACT_LINES lines (own-contract + any leftover foreign
// ones). Rewrites it dropping:
//   - lines of a foreign / previous contract (arm() already archives and
//     unlinks on the normal path; this is the defence-in-depth path for a
//     leftover the unlink missed);
//   - within each segment, `block` lines (obligations never read them) and
//     all but the segment's last `measure` (only the last one is read,
//     `measureOf()`) and any `card` line whose variant is not
//     `ship-blocked` / `aborted` (the only card shape obligations read, as
//     a release-equivalent — run-contract-obligations.js).
// Every kind an obligation reads across segments — skill, agent, release,
// park, skip, branch, edit, commit — is always kept in full.
const EVENTS_COMPACT_LINES = 500;
const CARD_KEEP_VARIANTS = new Set(['ship-blocked', 'aborted']);

/**
 * Callers (record()) decide when it is worth it; this always attempts the
 * rewrite. RT1-R8: runs under the header lock (append itself stays
 * lock-free — taking a lock on every record() would slow the hot path) and
 * re-checks the events file size right before the rename: a parallel
 * appendFileSync that raced in after we read the file would otherwise be
 * silently dropped by our rewrite. If it grew, or the lock could not be
 * taken at all, this is a no-op — the next record() past the cap tries
 * again. On success, the header's `compactedAtLines` is bumped so the
 * auto-compact trigger in record() is "grown past the cap since the last
 * compaction", not "still above the cap" (which used to rewrite the whole
 * file on every single record() once a segment structure keeps it >500
 * lines forever).
 */
function compactEvents(cwd, header) {
  const token = acquireLock(cwd);
  if (!token) return; // best effort: try again next time
  try {
    const file = eventsPath(cwd);
    let beforeStat;
    try { beforeStat = fs.statSync(file); } catch { beforeStat = null; }
    const all = readEventLines(cwd);
    const own = all.filter(ev => !ev.c || ev.c === header.id);
    // H6: index each event by identity before it is sliced into segments —
    // sorting `kept` by `Date.parse(ev.t)` let a same-millisecond tie (a
    // segment's last `measure` vs its closing `release`/`park`) or an event
    // without a parseable `t` drift across a segment boundary on re-read.
    // Original read order is always the true order (events are appended).
    const ownIndex = new Map(own.map((ev, i) => [ev, i]));
    // Lazy require: breaks the store ↔ obligations circular dependency.
    const { segments } = require('./run-contract-obligations');
    const kept = [];
    for (const seg of segments(header, own)) {
      let lastMeasure = null;
      for (const ev of seg) {
        if (ev.k === 'block') continue;
        if (ev.k === 'measure') { lastMeasure = ev; continue; }
        if (ev.k === 'card') { if (CARD_KEEP_VARIANTS.has(ev.variant)) kept.push(ev); continue; }
        kept.push(ev);
      }
      if (lastMeasure) kept.push(lastMeasure);
    }
    kept.sort((a, b) => ownIndex.get(a) - ownIndex.get(b));
    const body = kept.map(ev => JSON.stringify(ev)).join('\n') + (kept.length ? '\n' : '');
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, body, 'utf8');
      // Right before the rename: has the file grown since we read it? A
      // grow means a lock-free append landed in between — abort, it would
      // be lost by our rename.
      let afterStat;
      try { afterStat = fs.statSync(file); } catch { afterStat = null; }
      const grew = beforeStat ? (!afterStat || afterStat.size !== beforeStat.size) : !!afterStat;
      if (grew) { unlinkQuiet(tmp); return; }
      fs.renameSync(tmp, file);
    } catch {
      unlinkQuiet(tmp);
      return;
    }
    eventsCache = null;
    const fresh = readRawContract(cwd);
    if (fresh && fresh.id === header.id) {
      writeJsonRetry(contractPath(cwd), { ...fresh, compactedAtLines: kept.length });
    }
  } finally {
    releaseLock(cwd, token);
  }
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
  // AUD-011: the CARD path must not show another session's contract just
  // because the asking session id is missing (a card rendered without
  // `session_id` — the real caller, mode-state.js, always passes the
  // `sessionId` key, explicitly null when the card has none). CLI / test
  // callers that omit the key entirely keep ownedBy()'s lenient "unknown
  // asker → owner" semantics; only a caller that opts in to ownership
  // tracking gets the tightened check.
  if (Object.prototype.hasOwnProperty.call(opts, 'sessionId') && !opts.sessionId && h.sessionId) return null;
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
  // AUD-022: the corrupt-quarantine notice rides this same one-shot channel
  // — there is no header left to check ownership against, so any asking
  // session gets it once.
  const corrupt = corruptNotice(cwd);
  if (corrupt) return corrupt;
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
    // RT2-Q4: always the actual arming cwd's work-tree root — never
    // caller-supplied, same as id/armedAt above.
    root: projectRoot(cwd),
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

/**
 * Merge `patch` into the active contract. Returns the new header or null.
 * AUD-017: the whole read-modify-write runs under the header lock, so a
 * close() that runs (in this process or another) either fully finishes
 * before this starts, or fully finishes after this releases — it can never
 * land between this function's read and its write and get overwritten.
 */
function update(cwd, patch = {}, opts = {}) {
  const now = nowOf(opts);
  archiveIfExpired(cwd, now);
  const token = acquireLock(cwd, opts);
  if (!token) return null;
  try {
    const h = readContract(cwd, { now, sessionId: opts.sessionId });
    if (!h) return null;
    const rest = { ...(patch || {}) };
    delete rest.id; delete rest.armedAt; delete rest.v;
    delete rest.closedAt; delete rest.closeReason; delete rest.aborted;
    // RT2-Q4: `root` is arm()'s own work-tree root — never patchable either.
    delete rest.root;
    // Re-read right before the write: `closedAt`/`closeReason`/`aborted` are
    // always stripped from the patch above, so even if a close() landed
    // (real concurrency the lock already prevents, or a stale read this
    // re-read catches) its fields survive the merge below untouched.
    const fresh = readRawContract(cwd);
    if (!fresh || fresh.id !== h.id) return null;
    const next = sanitize({ ...fresh, ...rest });
    // Q7a: a slow update() can lose its lock to the 1s stale takeover
    // (LOCK_STALE_MS) and keep running after a concurrent close() acquires a
    // fresh lock and writes closedAt. When `fresh` (above) already saw that
    // closedAt, `next` already carries it through the merge (the comment
    // above) — the write below is a harmless no-op re-write, and this must
    // still return the merged header, not null. The real gap is a close()
    // landing AFTER `fresh` was read but BEFORE this write: re-read once
    // more, immediately before the atomic write (still under whatever lock
    // this call holds), and refuse ONLY the write that would silently drop
    // a closedAt `fresh` never saw.
    if (!fresh.closedAt) {
      const justBeforeWrite = readRawContract(cwd);
      if (justBeforeWrite && justBeforeWrite.id === h.id && justBeforeWrite.closedAt) return null;
    }
    return writeJsonRetry(contractPath(cwd), next) ? next : null;
  } finally {
    releaseLock(cwd, token);
  }
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
  const written = appendRetry(eventsPath(cwd), JSON.stringify(ev) + '\n') ? ev : null;
  // AUD-018 / RT1-R8: trigger on growth since the last compaction, not on
  // being (still) above the cap — a compacted file whose kept lines still
  // exceed EVENTS_COMPACT_LINES (many live segments) would otherwise be
  // rewritten again on every single subsequent record() call.
  if (written && readEventLines(cwd).length - (h.compactedAtLines || 0) > EVENTS_COMPACT_LINES) compactEvents(cwd, h);
  return written;
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
  // RT1-R6: close must always win. If the lock cannot be taken in time (a
  // delete-pending lock racing EPERM/EBUSY past the retry loop, or a busy
  // holder) close still writes — better a rare lost concurrent update()
  // patch than a lost close that leaves the contract's gates stuck open.
  const token = acquireLock(cwd, opts);
  try {
    const h = readContract(cwd, { now, sessionId: opts.sessionId });
    if (!h) return null;
    const next = {
      ...h,
      closedAt: new Date(now).toISOString(),
      closeReason: reason ? String(reason) : (opts.aborted ? 'aborted' : 'done'),
      aborted: !!opts.aborted,
    };
    return writeJsonRetry(contractPath(cwd), next) ? next : null;
  } finally {
    if (token) releaseLock(cwd, token);
  }
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
  disabled, contractPath, eventsPath, prevPath, pendingPath, batchHandoffPath, hasState,
  readContract, readContractForCard, readRawContract, expiryNotice, arm, update, claim, record, close, events,
  markPendingArm, pendingArm, clearPendingArm, markBatchHandoff, batchHandoffPending, clearBatchHandoff,
  // shared with the sibling modules (not part of the facade's public list)
  nowOf, eventsOf, readJson, strList, sanitize,
  // internal, exposed for this module's own tests only (AUD-017 / AUD-018 / RT1 / RT2)
  compactEvents, EVENTS_COMPACT_LINES, readJsonStrict, corruptPrefix, takeoverStaleLock, quarantineCorrupt,
};
