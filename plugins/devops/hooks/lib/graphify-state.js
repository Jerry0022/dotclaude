'use strict';
/**
 * @lib graphify-state
 * @version 0.5.0
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

// Sentinel argv sentinel value meaning "run windowless, but write no sentinel".
const NO_SENTINEL = '-';
// argv flag that turns a plain `node graphify-state.js` invocation into the
// background runner (see the require.main block at the bottom of this file).
const BG_RUN_FLAG = '--bg-run';

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
 * @returns {boolean} true iff the runner spawn was issued (not whether it succeeds)
 */
function spawnBgRunner(cmd, args, cwd, sentinel) {
  try {
    spawn(
      process.execPath,
      [__filename, BG_RUN_FLAG, sentinel || NO_SENTINEL, cwd, cmd, ...args],
      { cwd, detached: true, stdio: 'ignore', windowsHide: true },
    ).unref();
    return true;
  } catch {
    return false; // node/toolchain absent — never let this degrade session start
  }
}

/**
 * Fire-and-forget background command, windowless on Windows and surviving the
 * hook that launches it, with NO completion sentinel. Used for graphify
 * side-tasks whose outcome we do not surface (`uv tool install`, `graphify hook
 * uninstall`). See spawnBgRunner for the windowless mechanism.
 * @returns {boolean} true iff the spawn was issued
 */
function bgWindowless(cmd, args, cwd) {
  return spawnBgRunner(cmd, args, cwd, null);
}

/**
 * Background spawn WITH a completion sentinel (Gap #5). A plain detached spawn
 * with stdio:'ignore' makes a failing `graphify update` completely invisible —
 * the runner writes `ok` / `fail:<code>` to a per-project sentinel file once the
 * command exits, so a LATER SessionStart can detect and surface the failure
 * (see readSentinel + ss.graphify.js). git-invisible (os.tmpdir(), not the
 * project) and windowless on Windows (see spawnBgRunner). Fail-open.
 * @returns {boolean} true iff the spawn was issued (not whether it succeeds)
 */
function bgWithSentinel(cmd, args, cwd) {
  const sentinel = sentinelPath(cwd);
  try { fs.unlinkSync(sentinel); } catch { /* no previous sentinel */ }
  return spawnBgRunner(cmd, args, cwd, sentinel);
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
  isGraphifyQueryCommand,
  sentinelPath,
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
 */
function runBgEntrypointChild(runCmd, runArgs, runCwd, writeSentinel, exitFn) {
  const doExit = exitFn || ((code) => process.exit(code));
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
        try {
          attach(spawnChild(true), false);
          return;
        } catch { /* fall through to fail below */ }
      }
      writeSentinel('fail');
      doExit(0);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      writeSentinel(code === 0 ? 'ok' : (code == null ? 'fail' : `fail:${code}`));
      doExit(0);
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
      writeSentinel('fail');
      doExit(0);
      return;
    }
  }
  attach(child, true);
}

// ── Background runner entrypoint ─────────────────────────────────────────────
// When this file is executed directly as `node graphify-state.js --bg-run
// <sentinel|'-'> <cwd> <cmd> [args...]` it acts as the detached, windowless
// wrapper spawned by spawnBgRunner: it runs the real command as a NON-detached,
// windowsHide child (created with CREATE_NO_WINDOW → hidden console, no window),
// waits for it, and writes the ok/fail sentinel. Guarded by require.main so a
// normal `require()` of this module never triggers it.
if (require.main === module && process.argv[2] === BG_RUN_FLAG) {
  const sentinelArg = process.argv[3];
  const runCwd = process.argv[4];
  const runCmd = process.argv[5];
  const runArgs = process.argv.slice(6);
  const writeSentinel = (text) => {
    if (sentinelArg === NO_SENTINEL) return;
    try { fs.writeFileSync(sentinelArg, text); } catch { /* tmp unwritable — nothing to surface to */ }
  };
  runBgEntrypointChild(runCmd, runArgs, runCwd, writeSentinel);
}
