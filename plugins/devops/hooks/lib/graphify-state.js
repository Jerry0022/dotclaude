'use strict';
/**
 * @lib graphify-state
 * @version 0.3.0
 * @plugin devops
 * @description Consent + session-state helpers for the graphify enforcement
 *   layer (devops-graph). Default-on / opt-out model: graphify enforcement is
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
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const CONSENT_REL = path.join('.claude', 'graphify.json');

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
  return path.join(os.tmpdir(), `dotclaude-graphbuild-${key}.sentinel`);
}

/**
 * Detached background spawn with a completion sentinel (Gap #5). Plain bg()
 * spawns (detached + stdio:'ignore') make a failing `graphify extract`
 * completely invisible — this wraps the command in a platform shell that
 * writes `ok` or `fail:<code>` to a per-project sentinel file once the
 * command exits, so a LATER SessionStart can detect and surface the failure
 * (see readSentinel + ss.graphify.js). git-invisible (os.tmpdir(), not the
 * project). Fail-open: any spawn error is swallowed, matching the shape of
 * the plain bg() helpers in ss.graphify.js / pre.tokens.guard.js.
 * @returns {boolean} true iff the spawn was issued (not whether it succeeds)
 */
function bgWithSentinel(cmd, args, cwd) {
  const sentinel = sentinelPath(cwd);
  try { fs.unlinkSync(sentinel); } catch { /* no previous sentinel */ }
  const quoted = args.map((a) => `"${String(a).replace(/"/g, '""')}"`).join(' ');
  // Two Windows traps shape this implementation:
  //   1. No exit code on win32: %errorlevel% expands at cmd PARSE time (before
  //      the command runs → always 0), and once expanded the token ends in a
  //      digit directly before `>` (`echo fail:0>"…"`), which cmd parses as a
  //      file-handle redirection — the sentinel then contains neither `ok` nor
  //      `fail`. A bare `fail` (ends in a letter) has neither problem.
  //   2. Quoting: a manual spawn('cmd.exe', ['/c', inner]) makes node escape
  //      the inner quotes as \" — cmd.exe does not understand backslash
  //      escapes, the redirect path breaks, and NO sentinel is ever written.
  //      `shell: true` lets node compose the platform shell line verbatim.
  const inner = process.platform === 'win32'
    ? `${cmd} ${quoted} && (echo ok>"${sentinel}") || (echo fail>"${sentinel}")`
    : `${cmd} ${quoted} && echo ok > "${sentinel}" || echo "fail:$?" > "${sentinel}"`;
  try {
    spawn(inner, [], {
      cwd, detached: true, stdio: 'ignore', windowsHide: true, shell: true,
    }).unref();
    return true;
  } catch {
    return false; // toolchain / shell absent
  }
}

/**
 * Read the last background-build sentinel for `cwd`. Returns null when no
 * sentinel exists yet (never ran, or still running). `code` is null when the
 * platform shell could not report one (win32 — see bgWithSentinel).
 * Never throws.
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
  isGraphifyQueryCommand,
  sentinelPath,
  bgWithSentinel,
  readSentinel,
  clearSentinel,
};
