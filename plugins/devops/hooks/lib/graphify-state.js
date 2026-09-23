'use strict';
/**
 * @lib graphify-state
 * @version 0.12.0
 * @plugin devops
 * @description Consent + session-state helpers for the graphify enforcement
 *   layer (auto-graph). Default-on / opt-out model: graphify enforcement is
 *   ENABLED unless an explicit `consent:false` record exists, checked at
 *   `.claude/graphify.json` in the consumer project (`readState`/`isDeclined`)
 *   OR the global, machine-wide `~/.claude/graphify.json` (`readGlobalState`)
 *   — either one being `consent:false` disables it (`isEnabled`). Hooks never
 *   WRITE either record — the user opts out manually. Also tracks a
 *   per-session "graphify query already ran" flag so the PreToolUse hard-gate
 *   can relent once Claude has consulted the graph, and provides
 *   `bgWithSentinel`/`readSentinel` — a shared detached-spawn wrapper that
 *   records background `graphify update`/`hook uninstall` outcomes to a
 *   per-project sentinel file so a silent failure (stdio:'ignore') can be
 *   surfaced at the next SessionStart instead of vanishing.
 *
 *   `bgWithSentinel` additionally enforces TWO concurrency bounds on
 *   `graphify update` (all spawn triggers funnel through it): a per-project PID
 *   lock (`updateInFlight`/`updateLockPath`) so at most ONE build runs per
 *   project, AND a machine-wide cap (`globalUpdatesInFlight`/`updateGlobalCap`,
 *   default 2) so the TOTAL live builds across all cwds is bounded. The
 *   SessionStart (10-min) and PreToolUse (2-min) throttles only DEBOUNCE bursts;
 *   on a large repo a single build outlasts its throttle window while a trigger
 *   recurs (historically the 10-min git-sync cron, since removed — but any
 *   recurring session trigger does it), so time-based throttling alone let
 *   builds stack without bound — measured at 12 concurrent runs / ~29 GB commit,
 *   exhausting RAM. The per-project lock alone still let N worktrees each run a
 *   heavy build (RAM + disk saturation), which the global cap prevents.
 *
 *   Two further bounds, both learned from a session whose cwd was $HOME:
 *   `bgWithSentinel` refuses any cwd that is not inside a git work tree
 *   (`isProjectDir`) — that session crawled the whole profile (AppData, every
 *   checkout, ...) for hours at 3+ GB RSS; and the `--bg-run` runner heartbeats
 *   its lock stamp while the build runs, because `updateInFlight` treats a stamp
 *   older than UPDATE_LOCK_STALE_MS as dead without asking the pid — which let a
 *   SECOND build of the same cwd start next to the still-running first one.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const CONSENT_REL = path.join('.claude', 'graphify.json');

/**
 * The `graphify` executable every build/side-task spawn uses. Overridable via
 * DOTCLAUDE_GRAPHIFY_BIN — an absolute path when the CLI is installed somewhere
 * PATH does not reach (uv's ~/.local/bin on a fresh Windows box), or a stub in
 * tests so a hook under test never launches the real Python indexer.
 */
function graphifyBin() {
  const v = process.env.DOTCLAUDE_GRAPHIFY_BIN;
  return typeof v === 'string' && v.trim() ? v : 'graphify';
}

// Shared with every project-rooted `.claude/` writer (lib/project-root.js).
const { findRepoRoot, samePath } = require('./project-root');

/**
 * Root of the PRIMARY checkout when `cwd` sits inside a linked git worktree,
 * else null. A linked worktree's `.git` is a one-line FILE
 * (`gitdir: <main>/.git/worktrees/<name>`); the primary checkout's `.git` is a
 * directory. Pure fs, no git spawn — hot-path safe. Never throws.
 *
 * Why this exists: the knowledge graph is built per cwd, so a fresh worktree
 * has no `graphify-out/` until its own background build lands — measured over
 * 20 sessions, 11 ran in a graph-less worktree while the primary checkout held
 * a fresh multi-MB graph the whole time. The nudge/gate resolve to that graph
 * instead (graph-nudge `resolveGraphJson`).
 * @returns {string|null} absolute primary-checkout root, or null
 */
function mainCheckoutRoot(cwd) {
  const root = findRepoRoot(cwd);
  if (!root) return null;
  try {
    const dotGit = path.join(root, '.git');
    if (!fs.statSync(dotGit).isFile()) return null; // primary checkout already
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    // `<main>/.git/worktrees/<name>` — relative gitdirs resolve against the worktree root.
    const gitdir = path.resolve(root, m[1]);
    const parts = gitdir.split(/[\\/]/);
    const wtIdx = parts.lastIndexOf('worktrees');
    if (wtIdx < 2 || parts[wtIdx - 1] !== '.git') return null;
    const main = parts.slice(0, wtIdx - 1).join(path.sep);
    if (!main || samePath(main, root)) return null;
    return fs.statSync(path.join(main, '.git')).isDirectory() ? main : null;
  } catch {
    return null;
  }
}

/**
 * True iff `cwd` is somewhere the graph may be built AUTOMATICALLY: inside a
 * git work tree whose root is not the user's home directory. A session can start
 * anywhere — a Desktop session with no folder picked, a terminal opened in `~`
 * — and `graphify update .` in such a cwd indexes everything below it; the
 * home directory (observed: hours of CPU, 3+ GB RSS, the whole profile walked)
 * is the worst case, and a dotfiles repo in `~` does not make it a project.
 * Manual `graphify update .` remains the user's call anywhere. Never throws.
 */
function isProjectDir(cwd) {
  const root = findRepoRoot(cwd);
  if (!root) return false;
  try {
    return !samePath(root, os.homedir());
  } catch {
    return false;
  }
}

function consentPath(cwd) {
  return path.join(cwd, CONSENT_REL);
}

/** Parsed consent record, or null if absent/unreadable. Never throws. */
function readState(cwd) {
  try {
    const obj = JSON.parse(fs.readFileSync(consentPath(cwd), 'utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** True iff the user explicitly opted IN for this project. */
function hasConsent(cwd) {
  const s = readState(cwd);
  return !!(s && s.consent === true);
}

/** True iff the user explicitly opted OUT for this project. */
function isDeclined(cwd) {
  const s = readState(cwd);
  return !!(s && s.consent === false);
}

/**
 * True iff there is NO consent record yet — the project is undecided, so a
 * one-time offer to enable graphify is appropriate. (consent:true / consent:false
 * both return false — the user has already chosen.)
 */
function isUndecided(cwd) {
  return readState(cwd) === null;
}

function globalConsentPath() {
  return path.join(os.homedir(), '.claude', 'graphify.json');
}

/** Parsed GLOBAL (machine-wide) consent record, or null if absent/unreadable. Never throws. */
function readGlobalState() {
  try {
    const obj = JSON.parse(fs.readFileSync(globalConsentPath(), 'utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Read a consent record file distinguishing TRULY ABSENT (no such file) from
 * PRESENT-but-unparseable/invalid (file exists but JSON.parse fails, or the
 * parsed value is not an object). This distinction matters for `isEnabled`:
 * a corrupted opt-out record must not silently re-enable the feature (R5) —
 * corruption is the one failure mode that must fail CLOSED (declined), while
 * a genuinely absent record is the normal default-on case and must fail OPEN
 * (enabled). Never throws.
 * @returns {{present: boolean, obj: object|null}}
 */
function readRecordDistinguishingAbsence(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { present: false, obj: null }; // truly absent (or unreadable — treat as absent)
  }
  try {
    const obj = JSON.parse(raw);
    return { present: true, obj: obj && typeof obj === 'object' ? obj : null };
  } catch {
    return { present: true, obj: null }; // present but unparseable
  }
}

/**
 * True iff graphify enforcement is enabled for `cwd` — the DEFAULT-ON gate.
 * Enabled UNLESS an explicit opt-out (`consent:false`) exists in either the
 * per-project record (.claude/graphify.json) or the global, machine-wide
 * record (~/.claude/graphify.json) — either one being `consent:false` disables
 * it. "No record at all" (project AND global) counts as ENABLED — graphify is
 * key-less, opt-out, and auto-installing by default (see ss.graphify.js).
 * A record that IS PRESENT but unparseable/corrupt (e.g. caught mid atomic
 * rewrite, or disk corruption) is treated as DECLINED, not enabled — the safe,
 * sticky direction for the one signal that must never silently flip back on
 * (R5). Never throws.
 */
function isEnabled(cwd) {
  try {
    const project = readRecordDistinguishingAbsence(consentPath(cwd));
    if (project.present) {
      if (project.obj === null) return false; // present but corrupt → treat as opted-out
      if (project.obj.consent === false) return false;
    }
    const global = readRecordDistinguishingAbsence(globalConsentPath());
    if (global.present) {
      if (global.obj === null) return false; // present but corrupt → treat as opted-out
      if (global.obj.consent === false) return false;
    }
    return true;
  } catch {
    return true; // fail-open — never let an unexpected read error disable the feature
  }
}

/**
 * True iff the user has explicitly opted OUT for this project OR machine-wide
 * (either record has `consent:false`). Distinct from `isDeclined(cwd)`, which
 * only checks the per-project record.
 */
function isDeclinedAnywhere(cwd) {
  return !isEnabled(cwd);
}

function refreshFlagPath(cwd) {
  const key = crypto.createHash('md5').update(`refresh:${cwd}`).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `dotclaude-graphrefresh-${key}.flag`);
}

/**
 * Throttle gate for the demand-driven stale-graph refresh triggered from the
 * PreToolUse graphify-gate. Returns true (and stamps the flag) at most once per
 * `cooldownMs` per project, so a burst of broad searches cannot stack concurrent
 * `graphify extract` runs. Keyed on cwd (not session) so parallel agents/
 * worktrees on the same project share one throttle. Never throws.
 */
function markRefresh(cwd, cooldownMs) {
  const file = refreshFlagPath(cwd);
  try {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age < cooldownMs) return false;
  } catch { /* absent → first run */ }
  try {
    fs.writeFileSync(file, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Give back a throttle slot taken by `markRefresh` when the spawn it guarded
 * was declined downstream (issue #291). Without this the cooldown is spent on a
 * build that never started, and the self-heal cannot retry until it expires —
 * on a machine whose global cap is usually saturated, that is a graph which
 * never converges. Never throws; an already-absent flag is the desired state.
 */
function releaseRefresh(cwd) {
  try { fs.unlinkSync(refreshFlagPath(cwd)); } catch { /* already gone */ }
}

function queryFlagPath(sessionId, cwd) {
  const key = crypto.createHash('md5').update(`${sessionId || 'nosid'}:${cwd}`).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `dotclaude-graphq-${key}.flag`);
}

/** Record that `graphify query` ran this session (relaxes the gate). */
function markQueryDone(sessionId, cwd) {
  try {
    fs.writeFileSync(queryFlagPath(sessionId, cwd), String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Has `graphify query` already run this session for this project? */
function queryDone(sessionId, cwd) {
  try {
    return fs.existsSync(queryFlagPath(sessionId, cwd));
  } catch {
    return false;
  }
}

// ── Adaptive gate relent ─────────────────────────────────────────────────────
// The old "relent for the rest of the session once ANY `graphify query` ran"
// policy is gone — the gate now answers eligible searches itself (see
// pre.tokens.guard's answer-in-gate), so a manual query elsewhere in the
// session no longer needs to disable it wholesale. What remains: the
// per-(session, search) escape hatch (a retry of the exact same search always
// passes — never touches these files), PLUS an adaptive backstop for a
// session that keeps hitting searches the graph genuinely cannot answer: 3
// consecutive bypasses with no accepted answer in between relents the gate
// for the rest of THAT session.
//
// "Consecutive" is tracked across DIFFERENT searches, not just retries of one:
// the hook keeps `getLastBlocked`/`setLastBlocked`/`markLastBlockedBypassed`
// alongside the counter. A NEW block resets the streak only when the PREVIOUS
// blocked search was never retried (an accepted answer); a bypass of the
// search that IS the current `lastBlocked` key increments the streak and
// marks it bypassed so the NEXT block does not reset it — this is what lets
// three DIFFERENT searches, each fired-then-bypassed once, relent the gate.
//
// All three flags (bypass counter, relent flag, last-blocked record) carry a
// TTL (`GATE_STATE_TTL_MS`, ~12h) — without one a machine left running for
// days would accumulate a streak (or a relent) that outlives any session that
// could plausibly still be "the same burst of noisy searches".
const GATE_STATE_TTL_MS = 12 * 60 * 60 * 1000;

function bypassCountPath(sessionId, cwd) {
  const key = crypto.createHash('md5').update(`gbypass:${sessionId || 'nosid'}:${cwd}`).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `dotclaude-graphbypass-${key}.count`);
}

/** Consecutive bypasses since the last accepted answer, for this (session, cwd). 0 when unknown or TTL-expired. */
function bypassCount(sessionId, cwd) {
  try {
    const { n, ts } = JSON.parse(fs.readFileSync(bypassCountPath(sessionId, cwd), 'utf8'));
    if (typeof ts !== 'number' || Date.now() - ts >= GATE_STATE_TTL_MS) return 0;
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/** Record one more bypass; returns the new count. Never throws. */
function noteBypass(sessionId, cwd) {
  const n = bypassCount(sessionId, cwd) + 1;
  try { fs.writeFileSync(bypassCountPath(sessionId, cwd), JSON.stringify({ n, ts: Date.now() })); } catch { /* best effort */ }
  return n;
}

/** An answer was delivered and never retried — the bypass streak no longer applies. */
function clearBypassStreak(sessionId, cwd) {
  try { fs.unlinkSync(bypassCountPath(sessionId, cwd)); } catch { /* already gone */ }
}

function relentFlagPath(sessionId, cwd) {
  const key = crypto.createHash('md5').update(`grelent:${sessionId || 'nosid'}:${cwd}`).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `dotclaude-graphrelent-${key}.flag`);
}

/** Disable the gate for the rest of this (session, cwd) — the adaptive backstop. */
function markRelented(sessionId, cwd) {
  try { fs.writeFileSync(relentFlagPath(sessionId, cwd), String(Date.now())); return true; } catch { return false; }
}

/** Has this (session, cwd) already relented (and is that relent still within its TTL)? */
function isRelented(sessionId, cwd) {
  try {
    const written = parseInt(fs.readFileSync(relentFlagPath(sessionId, cwd), 'utf8'), 10);
    return Number.isFinite(written) && (Date.now() - written) < GATE_STATE_TTL_MS;
  } catch { return false; }
}

function lastBlockedPath(sessionId, cwd) {
  const key = crypto.createHash('md5').update(`glastblocked:${sessionId || 'nosid'}:${cwd}`).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `dotclaude-graphlastblocked-${key}.json`);
}

/**
 * The most recently BLOCKED gate key for this (session, cwd) — `{key,
 * bypassed, ts}` — or `null` when none, unreadable, or past its TTL. `key` is
 * the same string the escape-hatch flag is keyed on (see pre.tokens.guard's
 * `gflag`); `bypassed` is whether that block has since been retried. Never
 * throws.
 */
function getLastBlocked(sessionId, cwd) {
  try {
    const obj = JSON.parse(fs.readFileSync(lastBlockedPath(sessionId, cwd), 'utf8'));
    if (!obj || typeof obj.key !== 'string' || typeof obj.ts !== 'number') return null;
    if (Date.now() - obj.ts >= GATE_STATE_TTL_MS) return null;
    return obj;
  } catch { return null; }
}

/** Record a NEW block for this (session, cwd), replacing whatever was there before. Never throws. */
function setLastBlocked(sessionId, cwd, key) {
  try { fs.writeFileSync(lastBlockedPath(sessionId, cwd), JSON.stringify({ key, bypassed: false, ts: Date.now() })); } catch { /* best effort */ }
}

/** Mark the current last-blocked key as having been retried (bypassed). No-op if it already expired. Never throws. */
function markLastBlockedBypassed(sessionId, cwd) {
  const cur = getLastBlocked(sessionId, cwd);
  if (!cur) return;
  try { fs.writeFileSync(lastBlockedPath(sessionId, cwd), JSON.stringify({ ...cur, bypassed: true })); } catch { /* best effort */ }
}

// ── "Declined" marker — R1 (double block via no-answer) ─────────────────────
// A query that timed out, found nothing, errored, or was skipped because the
// concurrency slots were all busy is NOT a block — the gate flag must stay
// unwritten (see the doc comment above `bypassCountPath`). But without ANY
// record of the attempt, an identical retry re-runs the query from scratch,
// which is not just wasted latency: it can also flip outcome between the two
// calls (live-observed — a path-less search timed out on call 1, then the
// retry got a real answer and was blocked on call 2, exactly the double-block
// this whole mechanism exists to prevent, just via the opposite direction).
// The declined marker records "this exact search was already tried and
// declined, do not try again" — the retry skips the query ENTIRELY (zero
// latency), and is deliberately inert: no gate_bypassed, no streak, no
// classic-flag pre-write, because nothing was ever blocked.
function declinedFlagPath(sessionId, cwd, searchKey) {
  const key = crypto.createHash('md5').update(`gdeclined:${sessionId || 'nosid'}:${cwd}:${searchKey}`).digest('hex').slice(0, 12);
  return path.join(gateStateTmpDir(), `dotclaude-graphdeclined-${key}.json`);
}

/** Record a declined (non-block) outcome for this exact search. Never throws. */
function markDeclined(sessionId, cwd, searchKey, reason) {
  try { fs.writeFileSync(declinedFlagPath(sessionId, cwd, searchKey), JSON.stringify({ reason, ts: Date.now() })); return true; } catch { return false; }
}

/** Read a (still-fresh, within GATE_STATE_TTL_MS) declined record, or null. Never throws. */
function getDeclined(sessionId, cwd, searchKey) {
  try {
    const obj = JSON.parse(fs.readFileSync(declinedFlagPath(sessionId, cwd, searchKey), 'utf8'));
    if (!obj || typeof obj.ts !== 'number') return null;
    if (Date.now() - obj.ts >= GATE_STATE_TTL_MS) return null;
    return obj;
  } catch { return null; }
}

// ── Gate query concurrency cap ───────────────────────────────────────────────
// The answer-in-gate spawns a REAL `graphify query` child synchronously. A
// machine running many concurrent sessions/worktrees, each firing an eligible
// search around the same moment, could otherwise stack an unbounded number of
// those children at once. A small, machine-wide semaphore (default 2
// in-flight, overridable) bounds that: a slot is a plain file created with the
// atomic exclusive `wx` flag, stamped `{pid, ts}`; a slot older than its stale
// window (default ~10s — well above a single query's own ~4s hard timeout) is
// treated as abandoned (a hook that crashed/was killed mid-query) and
// reclaimed. Over the cap → the caller skips the gate entirely (fail-open,
// `gate_skipped_busy`) rather than queueing, since queuing would just move the
// latency the cap exists to bound.
const GATE_QUERY_MAX_INFLIGHT_DEFAULT = 2;
const GATE_QUERY_SLOT_STALE_MS_DEFAULT = 10 * 1000;

function gateQueryMaxInFlight() {
  const n = parseInt(process.env.DOTCLAUDE_GATE_QUERY_MAX, 10);
  return Number.isInteger(n) && n > 0 ? n : GATE_QUERY_MAX_INFLIGHT_DEFAULT;
}

function gateQuerySlotStaleMs() {
  const n = parseInt(process.env.DOTCLAUDE_GATE_QUERY_STALE_MS, 10);
  return Number.isInteger(n) && n > 0 ? n : GATE_QUERY_SLOT_STALE_MS_DEFAULT;
}

function gateQuerySlotPath(i) {
  return path.join(lockBaseDir(), `dotclaude-gatequery-slot-${i}.lock`);
}

/**
 * Release a gate-query slot, but ONLY if it still names `pid` — the same
 * ownership discipline as `refreshUpdateLockFile`/`clearUpdateLockFile`
 * above. Without this a release() closure could unlink a slot a DIFFERENT
 * process has since reclaimed (this process's own slot went stale and was
 * taken over by another acquirer before this process finished), which would
 * let a third acquirer take the slot early and defeat the cap. A slot whose
 * body cannot be parsed (corrupt/0-byte) is left alone — there is nothing
 * safely ownable to remove. Never throws.
 */
function releaseGateQuerySlot(slotPath, pid) {
  try {
    const cur = JSON.parse(fs.readFileSync(slotPath, 'utf8'));
    if (cur && cur.pid === pid) fs.unlinkSync(slotPath);
  } catch { /* corrupt, already gone, or owned by someone else — leave it */ }
}

// ── Opportunistic TTL sweep — R8 ─────────────────────────────────────────────
// Every gate-state file above carries a TTL, but nothing ever DELETES an
// expired one proactively — each is only ever re-checked (and cleaned up) the
// next time that EXACT (session, cwd, search) tuple recurs, which on a
// machine with many short-lived sessions may be never. Left alone forever,
// os.tmpdir() slowly accumulates one small file per distinct search ever
// gated. This is a bounded, fail-silent best-effort sweep — not a mutex, not
// exhaustive — meant to be called occasionally (e.g. once per SessionStart,
// itself throttled by the caller) so the count stays small in practice
// without costing a real directory walk's worth of stats on every call.
const SWEEP_MAX_ENTRIES = 200;
const TMPDIR_SWEEP_PATTERNS = [
  /^claude_confirm_.*\.flag$/,          // classic confirm flag AND the graphgate escape-hatch flag (same namespace)
  /^dotclaude-graphbypass-.*\.count$/,
  /^dotclaude-graphrelent-.*\.flag$/,
  /^dotclaude-graphlastblocked-.*\.json$/,
  /^dotclaude-graphdeclined-.*\.json$/,
];
const LOCKDIR_SWEEP_PATTERNS = [/^dotclaude-gatequery-slot-.*\.lock$/];

/**
 * Remove entries in `dir` matching any of `patterns` whose mtime is older
 * than `ttlMs`, up to `budget` MATCHING entries considered (non-matching
 * entries in the same `readdirSync` listing are free — only a name-regex
 * test, no stat). Never throws.
 * @returns {{scanned:number, removed:number}}
 */
function sweepDirForStaleFiles(dir, patterns, ttlMs, budget) {
  let scanned = 0, removed = 0;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return { scanned, removed }; }
  for (const name of entries) {
    if (scanned >= budget) break;
    if (!patterns.some((re) => re.test(name))) continue;
    scanned++;
    const p = path.join(dir, name);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > ttlMs) {
        fs.unlinkSync(p);
        removed++;
      }
    } catch { /* gone already, or a transient stat/unlink failure — skip */ }
  }
  return { scanned, removed };
}

/**
 * Bounded, fail-silent opportunistic cleanup of expired gate/declined/
 * bypass/relent/last-blocked/slot temp files (R8). Splits the
 * `SWEEP_MAX_ENTRIES` budget between `os.tmpdir()` (gate/declined/bypass/
 * relent/classic-confirm flags) and `lockBaseDir()` (gate-query slots — a
 * distinct dir only when `DOTCLAUDE_GRAPHLOCK_DIR` overrides it, tests
 * mainly). Intended to be called from a throttled SessionStart path, not the
 * PreToolUse hot path. Never throws.
 * @returns {{scanned:number, removed:number}}
 */
function sweepStaleGateState() {
  try {
    const budgetEach = Math.floor(SWEEP_MAX_ENTRIES / 2);
    const a = sweepDirForStaleFiles(gateStateTmpDir(), TMPDIR_SWEEP_PATTERNS, GATE_STATE_TTL_MS, budgetEach);
    const b = sweepDirForStaleFiles(lockBaseDir(), LOCKDIR_SWEEP_PATTERNS, gateQuerySlotStaleMs(), budgetEach);
    return { scanned: a.scanned + b.scanned, removed: a.removed + b.removed };
  } catch {
    return { scanned: 0, removed: 0 };
  }
}

/**
 * Acquire one of the machine-wide gate-query slots. Never throws.
 *
 * A slot whose body fails `JSON.parse` (a 0-byte file from an interrupted
 * write, or genuine corruption) is NOT left alone forever — with the default
 * cap of 2, two such files would silently disable the gate machine-wide,
 * with no self-heal. It falls back to the slot FILE's own mtime to decide
 * staleness instead, same threshold as the parseable case.
 * @returns {(() => void)|null} a release function, or `null` when every slot
 *   is busy — the caller must fail OPEN (skip the gate, allow the search).
 */
function acquireGateQuerySlot() {
  const cap = gateQueryMaxInFlight();
  const staleMs = gateQuerySlotStaleMs();
  for (let i = 0; i < cap; i++) {
    const p = gateQuerySlotPath(i);
    try {
      fs.writeFileSync(p, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
      return () => releaseGateQuerySlot(p, process.pid);
    } catch {
      let stale = false;
      try {
        const { ts } = JSON.parse(fs.readFileSync(p, 'utf8'));
        stale = typeof ts === 'number' && Date.now() - ts > staleMs;
      } catch {
        // Corrupt or 0-byte — JSON.parse tells us nothing; fall back to the
        // file's own mtime so this slot still eventually reclaims (R5).
        try { stale = Date.now() - fs.statSync(p).mtimeMs > staleMs; } catch { stale = false; }
      }
      if (stale) {
        try {
          fs.writeFileSync(p, JSON.stringify({ pid: process.pid, ts: Date.now() }));
          return () => releaseGateQuerySlot(p, process.pid);
        } catch { /* lost a race writing the reclaim — try the next slot */ }
      }
      // else: genuinely busy (or a race with another acquirer) — try the next slot
    }
  }
  return null;
}

/**
 * True iff `cmd` actually RUNS `graphify query` (not merely mentions it).
 * Matches only when a command segment STARTS with `graphify query`, so
 * `echo "graphify query"`, `grep -r "graphify query"`, and commit messages like
 * `git commit -m "add graphify query"` do NOT falsely relent the gate.
 */
function isGraphifyQueryCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  return cmd
    .split(/&&|\|\||[;\n|]/)
    .some((seg) => /^\s*graphify\s+query\b/.test(seg));
}

function sentinelPath(cwd) {
  const key = crypto.createHash('md5').update(`sentinel:${cwd}`).digest('hex').slice(0, 12);
  // Beside the locks (lockBaseDir), not bare os.tmpdir(): a test that isolates
  // its lock dir gets isolated sentinels too, so hook-under-test builds never
  // litter the real temp dir. Production resolves to os.tmpdir() either way.
  return path.join(lockBaseDir(), `dotclaude-graphbuild-${key}.sentinel`);
}

// Sentinel argv sentinel value meaning "run windowless, but write no sentinel".
const NO_SENTINEL = '-';
// argv flag that turns a plain `node graphify-state.js` invocation into the
// background runner (see the require.main block at the bottom of this file).
const BG_RUN_FLAG = '--bg-run';

// ── graphify-update concurrency control ──────────────────────────────────────
// Two layers bound how much `graphify update` runs at once:
//   1. PER-PROJECT lock (updateInFlight): a single `graphify update .` on a large
//      repo can outlast the SessionStart (10-min) and PreToolUse (2-min) spawn
//      throttles, which only DEBOUNCE bursts. When a trigger recurs at least as
//      often as the build takes (historically the 10-min git-sync cron opening a
//      fresh session; that cron is gone, the hazard is not), time-based
//      throttling alone let builds stack without bound
//      (measured: 12 concurrent runs, ~29 GB commit, RAM exhausted). The PID lock
//      caps concurrency at ONE build PER PROJECT across every trigger.
//   2. MACHINE-WIDE cap (globalUpdatesInFlight + updateGlobalCap): the per-project
//      lock does nothing ACROSS projects — N active worktrees/cwds each get their
//      own build, so a multi-worktree machine still ran several heavy builds at
//      once (observed saturating RAM + disk even with the per-project lock). The
//      global cap bounds the TOTAL live builds across all cwds (default 2, via
//      DOTCLAUDE_GRAPH_MAX_BUILDS).
// Both layers read the same lock files; the lock dir is os.tmpdir() in production
// and overridable via DOTCLAUDE_GRAPHLOCK_DIR for test isolation.
//
// "Stale" is measured against the lock's LAST HEARTBEAT, not its spawn time: the
// runner re-stamps its own lock every UPDATE_LOCK_HEARTBEAT_MS while the build
// runs (see the --bg-run entrypoint). Without that, a build merely longer than
// the window lost its lock while still running — observed as two concurrent
// `graphify update .` on one cwd — because updateInFlight() checks the stamp
// BEFORE the pid. The stamp check still has to come first: it is the only
// defence against a recycled pid making a dead runner's lock read as live.
const UPDATE_LOCK_STALE_MS = 45 * 60 * 1000;
const UPDATE_LOCK_HEARTBEAT_DEFAULT_MS = 5 * 60 * 1000;

/** Heartbeat interval for the runner's lock re-stamp (env override for tests). */
function updateLockHeartbeatMs() {
  const n = parseInt(process.env.DOTCLAUDE_GRAPH_HEARTBEAT_MS, 10);
  return Number.isInteger(n) && n > 0 ? n : UPDATE_LOCK_HEARTBEAT_DEFAULT_MS;
}

/** Directory holding the per-project update-lock and sentinel files. Overridable for tests. */
function lockBaseDir() {
  return process.env.DOTCLAUDE_GRAPHLOCK_DIR || os.tmpdir();
}

/**
 * Where per-search gate state (currently: the declined marker) lives.
 * Defaults to `os.tmpdir()`, overridable via `DOTCLAUDE_GRAPHSTATE_TMPDIR` —
 * tests use this to isolate a directory-WIDE scan (`sweepStaleGateState`)
 * from whatever litter genuinely sits in the real system tmp dir (left by
 * other test files or a long-running machine); every other single-file flag
 * in this module targets a unique hashed filename, so a bare `os.tmpdir()`
 * never collides across tests and does not need this override.
 */
function gateStateTmpDir() {
  return process.env.DOTCLAUDE_GRAPHSTATE_TMPDIR || os.tmpdir();
}

/** Machine-wide cap on concurrent `graphify update` runners (default 2, min 1). */
function updateGlobalCap() {
  const n = parseInt(process.env.DOTCLAUDE_GRAPH_MAX_BUILDS, 10);
  return Number.isInteger(n) && n > 0 ? n : 2;
}

/** Per-project lock file recording the live background-update runner's PID. */
function updateLockPath(cwd) {
  const key = crypto.createHash('md5').update(`updatelock:${cwd}`).digest('hex').slice(0, 12);
  return path.join(lockBaseDir(), `dotclaude-graphupdate-${key}.lock`);
}

/**
 * Per-project counter of consecutive DECLINED spawns (issue #291).
 *
 * A decline is normally harmless — the project already has a build, or the
 * machine is at its cap, and the next trigger picks it up. On a machine with
 * many active worktrees, though, a project can lose that draw every single
 * time: ~15 cwds competing for a global cap of 2 leaves most of them silently
 * stale for weeks. That matters more than an ordinary skip, because
 * `pre.tokens.guard` steers broad searches TOWARD the graph — a starved project
 * quietly serves a month-old view of its code. The counter makes a persistent
 * loser visible; a spawn that issues resets it.
 */
function declineCountPath(cwd) {
  const key = crypto.createHash('md5').update(`updatelock:${cwd}`).digest('hex').slice(0, 12);
  return path.join(lockBaseDir(), `dotclaude-graphdecline-${key}`);
}

/** Consecutive declined spawns for `cwd`. 0 when unknown. Never throws. */
function declineCount(cwd) {
  try {
    const n = parseInt(fs.readFileSync(declineCountPath(cwd), 'utf8'), 10);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/** Record one more declined spawn; returns the new count. Never throws. */
function noteDecline(cwd) {
  const n = declineCount(cwd) + 1;
  try { fs.writeFileSync(declineCountPath(cwd), String(n)); } catch { /* best effort */ }
  return n;
}

/** Forget the decline streak — called when a spawn actually issues. */
function clearDeclines(cwd) {
  try { fs.unlinkSync(declineCountPath(cwd)); } catch { /* already gone */ }
}

/**
 * True iff `pid` names a live process. `process.kill(pid, 0)` sends no signal —
 * it only probes existence: it throws ESRCH when the process is gone and EPERM
 * when it exists but is owned by another user (still "alive" for our purposes).
 * A non-integer / non-positive pid is never alive. Never throws.
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

/**
 * True iff a `graphify update` background runner is still active for `cwd`. The
 * lock records the detached runner's PID and spawn time; the runner outlives its
 * graphify child (it awaits the child's exit — see runBgEntrypointChild), so a
 * live runner PID means a live build. A lock whose PID is dead, or older than
 * UPDATE_LOCK_STALE_MS (a runner that crashed without clearing it, or a rare
 * PID reuse), is treated as NOT in flight so a refresh can never wedge forever.
 * Never throws — any read/parse error fails OPEN (returns false → allow a spawn).
 */
function updateInFlight(cwd) {
  try {
    const { pid, ts } = JSON.parse(fs.readFileSync(updateLockPath(cwd), 'utf8'));
    if (typeof ts === 'number' && Date.now() - ts > UPDATE_LOCK_STALE_MS) return false;
    return pidAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Record the live update runner's PID so a concurrent trigger skips
 * (see updateInFlight). Written by bgWithSentinel right after the spawn issues.
 * Never throws — a tmp write failure degrades to "no guard", never a crash.
 */
function writeUpdateLock(cwd, pid) {
  try {
    fs.writeFileSync(updateLockPath(cwd), JSON.stringify({ pid, ts: Date.now() }));
  } catch { /* tmp unwritable — degrade to no guard, never throw */ }
}

/** Remove the update lock (the runner clears it once its build exits). No-op when absent. Never throws. */
function clearUpdateLock(cwd) {
  try { fs.unlinkSync(updateLockPath(cwd)); } catch { /* absent already */ }
}

/** Parsed lock body, or null when absent/corrupt. Never throws. */
function readLockFile(lockPath) {
  try {
    const { pid, ts } = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return { pid, ts };
  } catch {
    return null;
  }
}

/**
 * Heartbeat: re-stamp the lock at `lockPath` with a fresh `ts` — but ONLY while
 * it still names `pid` (the caller, i.e. the live runner). A lock naming another
 * pid belongs to a newer runner that legitimately took over after this one's
 * stamp went stale; touching it would let two builds share one lock again.
 * Never throws.
 * @returns {'owned'|'foreign'|'missing'} what was found — 'missing' also covers
 *   a corrupt body (nothing to own, nothing written)
 */
function refreshUpdateLockFile(lockPath, pid) {
  const cur = readLockFile(lockPath);
  if (!cur || !Number.isInteger(cur.pid)) return 'missing';
  if (cur.pid !== pid) return 'foreign';
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid, ts: Date.now() }));
  } catch { /* tmp unwritable — the stamp ages, updateInFlight fails open as before */ }
  return 'owned';
}

/**
 * Remove the lock at `lockPath` iff it names `pid` — the ownership discipline
 * of refreshUpdateLockFile applied to release. Before this, a finishing runner
 * unlinked whatever lock sat at the path, including a successor's. Never throws.
 * @returns {boolean} true iff a lock owned by `pid` was removed
 */
function clearUpdateLockFile(lockPath, pid) {
  const cur = readLockFile(lockPath);
  if (!cur || cur.pid !== pid) return false;
  try { fs.unlinkSync(lockPath); return true; } catch { return false; }
}

/**
 * Count `graphify update` runners live across ALL projects — the machine-wide
 * concurrency signal the per-project lock cannot provide. Scans every
 * `dotclaude-graphupdate-*.lock` in the lock dir and counts those whose recorded
 * PID is still alive and whose stamp is within UPDATE_LOCK_STALE_MS (stale/dead
 * locks are ignored, exactly like updateInFlight). Never throws — returns what it
 * counted (0 on a scan error) so a read failure can never wedge refresh shut.
 */
function globalUpdatesInFlight() {
  const dir = lockBaseDir();
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^dotclaude-graphupdate-.*\.lock$/.test(f)) continue;
      try {
        const { pid, ts } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (typeof ts === 'number' && Date.now() - ts > UPDATE_LOCK_STALE_MS) continue;
        if (pidAlive(pid)) n++;
      } catch { /* unreadable/corrupt lock — skip */ }
    }
  } catch { /* lock dir unreadable — treat as none in flight */ }
  return n;
}

/**
 * Launch a fire-and-forget background process that must (a) never block session
 * start, (b) outlive the short-lived hook that spawns it, and (c) NOT pop a
 * console window on Windows. Achieving all three at once is the whole trick.
 *
 * The naive `spawn(cmd, { detached:true, shell:true, windowsHide:true })` fails
 * (c): a DETACHED shell has no console of its own (DETACHED_PROCESS), so the
 * grandchild it launches (`graphify` / `uv`, a console app) inherits none and
 * Windows hands it a fresh, VISIBLE console — `windowsHide` on the shell cannot
 * reach the grandchild. That is the cmd/graphify window users saw flash on
 * every SessionStart refresh and every PreToolUse self-heal. Dropping `detached`
 * kills (b) instead: without it the build is reaped when the hook `process.exit`s.
 *
 * The fix is one level of indirection. We spawn THIS file as a DETACHED,
 * windowless Node runner (`node graphify-state.js --bg-run …`). node.exe is a
 * console app, so detaching it gives it no console and `windowsHide`
 * (CREATE_NO_WINDOW) means no window — and being detached, it outlives the hook.
 *
 * That much was 0.116.0's fix and it is correct under plain `conhost.exe` (the
 * classic per-process console host): a first-generation child created with
 * CREATE_NO_WINDOW gets a real but invisible console, full stop. It measurably
 * FAILS, however, on a machine where **Windows Terminal is the registered
 * "Default Terminal Application"** (the Win11 default, no registry override
 * needed) — empirically verified on this machine (Windows 11 build 26200).
 * Under WT delegation, any console-session creation gets handed off to Windows
 * Terminal itself rather than a plain hidden conhost, and WT opens a new,
 * VISIBLE, focus-stealing tab — even though the child was created with
 * CREATE_NO_WINDOW. The specific trigger measured here is the *extra shell
 * layer*: `spawn(cmd, args, { shell:true })` on win32 runs the target through
 * `cmd.exe /d /s /c "<cmd> <args>"`, i.e. a SECOND cmd.exe wrapping the already
 * argv-based command; that double indirection is what WT's delegation picks up
 * and surfaces as a tab. Spawning the target directly — no shell layer at all —
 * does not trigger it: measured with a real `graphify update .` run and with a
 * forced-failure `cmd.exe` child (title-probe + poll of visible window titles
 * showed no new window in either case, while the shell:true path reliably
 * produced one). All call sites here pass a plain argv vector (no `&&`/`|`
 * shell syntax), so shell:false is safe by construction; the one shell:true
 * fallback below exists solely for the (currently theoretical) case of a
 * `.cmd`/`.bat` shim binary, which Node's non-shell spawn cannot exec on
 * Windows — see the retry in `runBgEntrypointChild` below.
 *
 * The runner launches the real command as a NON-detached, windowsHide child,
 * waits for it, and writes the ok/fail sentinel itself, so there is no fragile
 * cmd `%errorlevel%`/redirection quoting and win32 now reports a real exit code
 * too. Fail-open: any spawn error is swallowed.
 *
 * @param {string} cmd    bare command (e.g. "graphify")
 * @param {string[]} args argument vector
 * @param {string} cwd    working directory for the build
 * @param {string|null} sentinel absolute sentinel path, or null for none
 * @param {string|null} lock absolute update-lock path (cleared by the runner on
 *   exit), or null for none — only the `graphify update` path passes one.
 * @returns {number|null} the runner's PID if the spawn was issued, else null
 *   (spawn error — node/toolchain absent). PID, not boolean, so the caller can
 *   record it in the concurrency lock.
 */
function spawnBgRunner(cmd, args, cwd, sentinel, lock) {
  try {
    const child = spawn(
      process.execPath,
      [__filename, BG_RUN_FLAG, sentinel || NO_SENTINEL, lock || NO_SENTINEL, cwd, cmd, ...args],
      { cwd, detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    return child.pid || null;
  } catch {
    return null; // node/toolchain absent — never let this degrade session start
  }
}

/**
 * Fire-and-forget background command, windowless on Windows and surviving the
 * hook that launches it, with NO completion sentinel. Used for graphify
 * side-tasks whose outcome we do not surface (`uv tool install`, `graphify hook
 * uninstall`). See spawnBgRunner for the windowless mechanism. No concurrency
 * lock — these side-tasks are one-shot/idempotent, not the stackable build.
 * @returns {boolean} true iff the spawn was issued
 */
function bgWindowless(cmd, args, cwd) {
  return spawnBgRunner(cmd, args, cwd, null, null) != null;
}

/**
 * Background spawn WITH a completion sentinel (Gap #5). A plain detached spawn
 * with stdio:'ignore' makes a failing `graphify update` completely invisible —
 * the runner writes `ok` / `fail:<code>` to a per-project sentinel file once the
 * command exits, so a LATER SessionStart can detect and surface the failure
 * (see readSentinel + ss.graphify.js). git-invisible (os.tmpdir(), not the
 * project) and windowless on Windows (see spawnBgRunner). Fail-open.
 *
 * Concurrency control: this is the single chokepoint for EVERY `graphify update`
 * spawn (the SessionStart refresh + both PreToolUse self-heal paths), so both
 * bounds apply to all triggers: (1) the PER-PROJECT PID lock skips when this cwd
 * already has a live build — the time-based throttles at the call sites only
 * debounce bursts and cannot see a run that outlived its window (the original
 * RAM-exhaustion bug); (2) the MACHINE-WIDE cap skips when the total live builds
 * across all cwds already equals updateGlobalCap() — the per-project lock alone
 * let N worktrees each run a heavy build and saturate RAM + disk. The runner
 * clears the lock when its build exits (see the --bg-run entrypoint →
 * runBgEntrypointChild).
 *
 * Eligibility comes first: a cwd outside a git work tree (or whose work tree is
 * the home directory) is never built automatically — see isProjectDir for the
 * hours-long $HOME crawl this stops. That refusal is not a "decline" in the
 * issue-#291 sense: nothing is starved, the cwd simply never qualifies, so the
 * decline streak (and its SessionStart report) stays untouched.
 * @returns {boolean} true iff a spawn was issued; false when skipped (cwd not a
 *   project, this cwd already building, or global cap reached) or the spawn errored.
 */
function bgWithSentinel(cmd, args, cwd) {
  if (!isProjectDir(cwd)) return false; // never auto-index a non-project (home dir, temp dir, ...)
  // A decline is bookkept (issue #291): callers throttle themselves before
  // getting here, so a declined spawn that leaves no trace burns the caller's
  // throttle window for work that never ran.
  if (updateInFlight(cwd)) { noteDecline(cwd); return false; } // this project already has a live build
  if (globalUpdatesInFlight() >= updateGlobalCap()) { noteDecline(cwd); return false; } // machine-wide cap reached
  const sentinel = sentinelPath(cwd);
  const lock = updateLockPath(cwd);
  try { fs.unlinkSync(sentinel); } catch { /* no previous sentinel */ }
  const pid = spawnBgRunner(cmd, args, cwd, sentinel, lock);
  if (pid != null) { writeUpdateLock(cwd, pid); clearDeclines(cwd); }
  else noteDecline(cwd);
  return pid != null;
}

/**
 * Read the last background-build sentinel for `cwd`. Returns null when no
 * sentinel exists yet (never ran, or still running). `code` is null only when
 * the child was terminated by a signal (no numeric exit code); a normal
 * non-zero exit reports its code on every platform now (the runner reads it from
 * Node's `exit` event — see spawnBgRunner). Never throws.
 * @returns {null|{status:'ok'}|{status:'fail', code:number|null}|{status:'unknown'}}
 */
function readSentinel(cwd) {
  try {
    const content = fs.readFileSync(sentinelPath(cwd), 'utf8').trim();
    if (content === 'ok') return { status: 'ok' };
    if (content === 'fail') return { status: 'fail', code: null };
    const m = /^fail:(-?\d+)$/.exec(content);
    if (m) return { status: 'fail', code: Number(m[1]) };
    return { status: 'unknown' };
  } catch {
    return null;
  }
}

/** Clear the sentinel so a stale result is not re-reported next SessionStart. */
function clearSentinel(cwd) {
  try { fs.unlinkSync(sentinelPath(cwd)); } catch { /* absent already */ }
}

module.exports = {
  CONSENT_REL,
  consentPath,
  readState,
  hasConsent,
  isDeclined,
  isUndecided,
  globalConsentPath,
  readGlobalState,
  isEnabled,
  isDeclinedAnywhere,
  refreshFlagPath,
  markRefresh,
  queryFlagPath,
  markQueryDone,
  queryDone,
  GATE_STATE_TTL_MS,
  bypassCountPath,
  bypassCount,
  noteBypass,
  clearBypassStreak,
  relentFlagPath,
  markRelented,
  isRelented,
  lastBlockedPath,
  getLastBlocked,
  setLastBlocked,
  markLastBlockedBypassed,
  gateStateTmpDir,
  declinedFlagPath,
  markDeclined,
  getDeclined,
  gateQueryMaxInFlight,
  gateQuerySlotStaleMs,
  gateQuerySlotPath,
  releaseGateQuerySlot,
  acquireGateQuerySlot,
  sweepDirForStaleFiles,
  sweepStaleGateState,
  isGraphifyQueryCommand,
  sentinelPath,
  lockBaseDir,
  updateGlobalCap,
  updateLockPath,
  updateInFlight,
  globalUpdatesInFlight,
  declineCountPath,
  declineCount,
  noteDecline,
  clearDeclines,
  releaseRefresh,
  writeUpdateLock,
  clearUpdateLock,
  refreshUpdateLockFile,
  clearUpdateLockFile,
  updateLockHeartbeatMs,
  graphifyBin,
  findRepoRoot,
  mainCheckoutRoot,
  isProjectDir,
  bgWindowless,
  bgWithSentinel,
  readSentinel,
  clearSentinel,
  runBgEntrypointChild,
};

/**
 * Spawn the real background command as a NON-detached, windowsHide child of the
 * (already detached, windowless) `--bg-run` runner, write the ok/fail sentinel
 * once it exits, and `process.exit(0)` the runner. Tries a shell-less spawn
 * first (the fix for the Windows-Terminal-delegation window flash — see
 * spawnBgRunner's doc comment); if that spawn itself throws or emits `error`
 * with `ENOENT` (typically a `.cmd`/`.bat` shim spawn() cannot exec directly),
 * it retries exactly once through `shell:true` on win32 so a shim install still
 * runs — same behavior as before this fix, just no longer the default path.
 * Exported for unit testing the fallback/command-construction logic; the actual
 * window-visibility behavior is not unit-testable (see qa_hints in the
 * accompanying commit/PR).
 * @param {string} runCmd
 * @param {string[]} runArgs
 * @param {string} runCwd
 * @param {(text: string) => void} writeSentinel
 * @param {(code: number) => void} [exitFn] injectable for tests; defaults to process.exit
 * @param {() => void} [clearLock] release the concurrency lock once the build
 *   settles (ok OR fail); defaults to a no-op. NOT called on the shell-retry
 *   path — the retried child is still running, so the lock must persist.
 */
function runBgEntrypointChild(runCmd, runArgs, runCwd, writeSentinel, exitFn, clearLock) {
  const doExit = exitFn || ((code) => process.exit(code));
  const releaseLock = clearLock || (() => {});
  // Terminal path: record the outcome, release the lock, exit the runner. Order
  // matters — the sentinel is written before the lock clears so a watcher that
  // sees the lock gone can already read the result.
  const finish = (sentinelText) => {
    writeSentinel(sentinelText);
    releaseLock();
    doExit(0);
  };
  const spawnChild = (useShell) => spawn(runCmd, runArgs, {
    cwd: runCwd,
    stdio: 'ignore',
    windowsHide: true,
    shell: useShell,
  });
  const attach = (child, allowShellRetry) => {
    let settled = false;
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (allowShellRetry && process.platform === 'win32' && err && err.code === 'ENOENT') {
        // Likely a .cmd/.bat shim that shell-less spawn() cannot exec — retry
        // once through cmd.exe, matching pre-fix behavior for that edge case.
        // Lock stays held: the retried child is the same logical build.
        try {
          attach(spawnChild(true), false);
          return;
        } catch { /* fall through to fail below */ }
      }
      finish('fail');
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      finish(code === 0 ? 'ok' : (code == null ? 'fail' : `fail:${code}`));
    });
  };
  let child;
  try {
    child = spawnChild(false);
  } catch {
    // Synchronous throw (rare — spawn() normally reports async via 'error').
    // Retry through the shell once before giving up, same as the async path.
    try {
      attach(spawnChild(true), false);
      return;
    } catch {
      finish('fail');
      return;
    }
  }
  attach(child, true);
}

// ── Background runner entrypoint ─────────────────────────────────────────────
// When this file is executed directly as `node graphify-state.js --bg-run
// <sentinel|'-'> <lock|'-'> <cwd> <cmd> [args...]` it acts as the detached,
// windowless wrapper spawned by spawnBgRunner: it runs the real command as a
// NON-detached, windowsHide child (created with CREATE_NO_WINDOW → hidden
// console, no window), waits for it, heartbeats the concurrency lock while it
// runs, writes the ok/fail sentinel, and releases the lock — its own lock only.
// Guarded by require.main so a normal `require()` of this module never
// triggers it.
if (require.main === module && process.argv[2] === BG_RUN_FLAG) {
  const sentinelArg = process.argv[3];
  const lockArg = process.argv[4];
  const runCwd = process.argv[5];
  const runCmd = process.argv[6];
  const runArgs = process.argv.slice(7);
  const writeSentinel = (text) => {
    if (sentinelArg === NO_SENTINEL) return;
    // Publish ATOMICALLY: writeFileSync opens with O_TRUNC, so a concurrent
    // reader landing between the truncate and the write sees a zero-byte file
    // and readSentinel parses '' as {status:'unknown'} — a real outcome silently
    // downgraded to garbage. Stage beside the target, then rename; both paths sit
    // in the same directory, so the rename is atomic on POSIX and on win32
    // (MoveFileEx + MOVEFILE_REPLACE_EXISTING). Matters for every poller: the
    // SessionStart surface in ss.graphify.js as much as the tests.
    const stage = `${sentinelArg}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(stage, text);
      fs.renameSync(stage, sentinelArg);
    } catch {
      // tmp unwritable — nothing to surface to; never leave the stage file behind
      try { fs.unlinkSync(stage); } catch { /* nothing staged */ }
    }
  };
  // Heartbeat: keep this runner's lock stamp fresh for as long as the build
  // runs, so updateInFlight() (stamp-first, then pid) keeps reading it as live
  // past UPDATE_LOCK_STALE_MS — a 3-hour build must not look "stale" at minute
  // 46 and invite a second build onto the same cwd. Stops on 'foreign' (a
  // successor legitimately owns the path now); a 'missing' lock keeps ticking
  // because bgWithSentinel writes the lock right AFTER the spawn returns, so an
  // early tick may simply precede it. unref(): the interval alone must never
  // hold the runner open once the child is gone.
  let heartbeat = null;
  if (lockArg !== NO_SENTINEL) {
    heartbeat = setInterval(() => {
      if (refreshUpdateLockFile(lockArg, process.pid) === 'foreign') {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    }, updateLockHeartbeatMs());
    heartbeat.unref();
  }
  const clearLock = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (lockArg === NO_SENTINEL) return;
    clearUpdateLockFile(lockArg, process.pid); // owned only — never a successor's lock
  };
  runBgEntrypointChild(runCmd, runArgs, runCwd, writeSentinel, undefined, clearLock);
}
