#!/usr/bin/env node
/**
 * @script concept-watch
 * @version 0.3.0
 * @plugin devops
 * @description The concept bridge's two detached watchers, as a script instead
 *   of a shell loop pasted into three documents.
 *
 *   `--mode pulse`  keepalive pulser — POSTs /heartbeat forever so the page's
 *                   connection indicator stays green. Never exits on a pending
 *                   submission, so `claude_ts` stays warm through a long
 *                   `implement`.
 *   `--mode watch`  pickup waker — polls /pending and exits the instant a
 *                   submission lands. The exit IS the signal: a detached Bash
 *                   task re-invokes Claude when it finishes, so the user never
 *                   has to announce a submission in chat (issue #276).
 *                   Since #363 it also OWNS the monitoring duties the per-minute
 *                   cron used to carry, token-free:
 *                     - self-cleanup gate: state file gone / foreign port /
 *                       concept HTML gone ⇒ POST /shutdown, exit with the reason;
 *                     - page liveness: the page is re-opened in the user's
 *                       browser when NO tab is known to the server any more —
 *                       the last tab sent its unload beacon (POST /bye) and
 *                       nothing polled since, or every tab has been silent
 *                       for `--liveness` seconds. At most once per window.
 *                       Silence alone while a tab is still registered never
 *                       reopens: a hidden Edge tab is throttled to one timer
 *                       wake-up per minute after 5 min and, with Sleeping
 *                       Tabs, to none at all (#397);
 *                     - structured exit on a submission —
 *                       `WAKER_EXIT reason=PENDING_SUBMISSION version=N action=…`
 *                       — so the woken Claude reads one line instead of
 *                       re-probing.
 *                   The cron is a sparse backstop only (every 15 min).
 *
 *   Why a script and not the inline `while true; do … sleep 20; done` loops
 *   this replaces:
 *     - The loops' first statement tested a RELATIVE `.claude/concept-active.json`
 *       while the docs mandate the state file at the project root, which is not
 *       always the task's cwd. Both watchers then exited STATE_GONE on their
 *       first iteration — the bug they exist to prevent. `--state` is absolute.
 *     - They were launched BEFORE the step that writes that state file, so a
 *       literal reading killed them at t=0. `--grace` waits for it instead.
 *     - The port guard was `grep -qE '"port"…\b'`; `\b` is a GNU extension, so
 *       on BSD/macOS grep it never matched and both watchers exited
 *       PORT_CHANGED immediately. The comparison is numeric here.
 *     - `allowed-tools` matches command prefixes, and a multi-line loop has no
 *       usable prefix — the only grant that covered it was a blanket one. A
 *       `node …` invocation is already covered.
 *
 *   Exit lines keep the `PULSER_EXIT reason=…` / `WAKER_EXIT reason=…` shape
 *   so the reason→action table in the concept skill still applies verbatim,
 *   plus `STATE_NEVER_APPEARED` for a launch that outran its setup,
 *   `HTML_GONE` for a concept whose page was deleted (#363), and
 *   `DUPLICATE_PULSER` / `DUPLICATE_WAKER` for a watcher that stepped down in
 *   favour of a sibling on the same port.
 *   A `PENDING_SUBMISSION` line carries `version=N action=<a>` after the reason.
 *
 *   Robustness rules, each one a failure seen on a live bridge (2026-09-20):
 *     - a cleanup verdict (state gone / port changed / page gone) must hold
 *       for `--confirm` consecutive polls — a state-file or page rewrite is
 *       not the end of the concept;
 *     - the pulser never exits on request failures while the state file is
 *       there; the waker exits SERVER_DEAD only after `--dead-after` seconds
 *       of continuous failure. Requests wait up to `--timeout` (30 s) so a
 *       bridge that is merely slow under load still counts as alive;
 *     - two watchers of one kind on one port: the younger pulser and the
 *       OLDER waker step down (DUPLICATE_PULSER / DUPLICATE_WAKER).
 *
 *   Exit codes: 0 once it is running — the exit is a signal, not a failure, and
 *   even an internal error is reported as a reason line. Only invalid arguments
 *   exit 2, before any watching starts.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DEFAULTS = {
  interval: 20,      // seconds — under the page's 90s HEARTBEAT_STALE_MS
  grace: 60,         // seconds to wait for the state file before giving up
  tolerate: 4,       // consecutive request failures before declaring the server dead
  // Seconds per request. 30, not 8: a ThreadingHTTPServer on a machine that
  // is also running four agents, a build and a grep over src/ answered
  // /heartbeat in 10–20 s (measured 2026-09-20 — a plain `wc -c` took two
  // minutes on that box). An 8 s deadline turned every such stretch into
  // four "failures" and a SERVER_DEAD on a server that was merely slow. With
  // 30 s the slow answer still lands and refreshes claude_ts, and the
  // worst-case cadence (timeout + interval = 50 s) stays under the page's
  // 90 s stale threshold.
  timeout: 30,
  // Consecutive polls a cleanup verdict (state file gone / port changed /
  // page gone) must hold before the watcher acts on it. Claude rewrites the
  // state file and the page mid-session (tmp + rename, `mv` from a scratch
  // dir), and on Windows both leave a window in which `existsSync` says no.
  // One such poll used to make the waker POST /shutdown on a live bridge —
  // the journal then shows a shutdown/restore pair minutes apart and the
  // user sees "nicht verbunden" until Claude relaunched. Three polls
  // (~1 min) is longer than any rewrite and still prompt for a real end.
  confirm: 3,
  // Watch mode only: seconds of CONTINUOUS request failure before the waker
  // exits SERVER_DEAD (on top of `tolerate`). A wake for a dead bridge makes
  // Claude relaunch it, which is right when the process is gone and wrong
  // when it is only busy — and the busy case is by far the common one.
  deadAfter: 300,
  // Seconds every tab must be silent before the page is re-opened (watch
  // mode; 0 = off). 900 and not 180: Edge's intensive throttling coalesces a
  // hidden tab's timers to ONE wake-up per minute after 5 min, and Sleeping
  // Tabs / efficiency mode suspend it completely — measured on a live bridge:
  // browser_ts advanced once per ~60 s, then not at all. 180 s read every
  // coffee break as "tab closed" and opened a fresh foreground tab each time,
  // which was then backgrounded and throttled in turn — the tab storm of
  // #397. A real close is detected by the page's /bye beacon (see
  // BYE_GRACE_MS), so this value only has to cover the "tab vanished without
  // saying goodbye" case (crash, kill) and can be generous.
  liveness: 900,
};

// After the last known tab said /bye, wait this long before re-opening: a
// reload or an in-place navigation fires pagehide too, and the fresh load
// registers itself within seconds. A deliberate close still gets exactly one
// reopen — just not in the same second the user hit Ctrl+W.
const BYE_GRACE_MS = 60_000;

function parseArgs(argv) {
  const out = { mode: '', port: 0, state: '', ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (!key) continue;
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) continue;
    i++;
    // `--dead-after 300` and `--deadAfter 300` are the same option.
    const name = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (name === 'mode' || name === 'state') out[name] = raw;
    // hasOwn, not `in` — `in` walks the prototype chain, so `--toString 5`
    // would set junk on the options object.
    else if (Object.prototype.hasOwnProperty.call(DEFAULTS, name) || name === 'port') out[name] = Number(raw);
  }
  return out;
}

function validate(opts) {
  if (opts.mode !== 'pulse' && opts.mode !== 'watch') return 'mode must be "pulse" or "watch"';
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) return 'port must be 1-65535';
  // Enforced, not merely described: a relative path resolved against the task's
  // cwd is the exact defect this argument exists to prevent.
  if (!opts.state || !path.isAbsolute(opts.state)) return 'state must be the ABSOLUTE path to concept-active.json';
  if (!(opts.interval > 0) || !(opts.grace >= 0) || !(opts.tolerate > 0) || !(opts.timeout > 0)) {
    return 'interval/grace/tolerate/timeout must be positive numbers';
  }
  if (!(opts.liveness >= 0)) return 'liveness must be 0 (off) or a positive number of seconds';
  if (!Number.isInteger(opts.confirm) || opts.confirm < 1) return 'confirm must be a positive integer';
  if (!(opts.deadAfter >= 0)) return 'dead-after must be 0 or a positive number of seconds';
  return null;
}

/**
 * Identity of THIS watcher, `<startMs>-<pid>`, carried on every poll — the
 * pulser's `POST /heartbeat?pulser=<id>`, the waker's `GET /pending?waker=<id>`.
 * The server echoes the PREVIOUS poller's id back (`prev_pulser` /
 * `prev_waker`), which is how two watchers of one kind on one port find out
 * about each other without a lock file: every session start re-arms the
 * watchers (`ss.concept.resume`), but on Windows the old detached tasks
 * survive the session, so a bridge had three pulsers after two restarts
 * and — worse — two wakers, each of which woke a Claude for the same
 * submission (two `WAKER_EXIT reason=PENDING_SUBMISSION` lines 4 s apart).
 * The id sorts by start time. Which side yields differs by role:
 *   - pulsers are interchangeable → the YOUNGER one exits, the older keeps
 *     the beat and never sees a reason to stop;
 *   - a waker's exit wakes the session that launched it, and a second waker
 *     only ever appears because a NEWER session re-armed → the OLDER one
 *     exits (its owner is the superseded session), the younger stays.
 */
function pulserId(now = Date.now, pid = process.pid) {
  return `${now()}-${pid}`;
}

/** Start time encoded in a watcher id, or NaN for anything that is not one. */
function pulserStart(id) {
  return typeof id === 'string' && /^\d+-\d+$/.test(id) ? Number(id.split('-')[0]) : NaN;
}

// Consecutive polls that must name a sibling as the previous poller before
// a watcher steps down. Three, not one: the backstop cron tick polls without
// an id, and a sibling that is itself about to exit must not take this one
// down with it.
const DUPLICATE_AFTER = 3;

/**
 * Is this watcher still the right one for the concept on disk?
 * With `exists` given (watch mode), a state file whose `html_path` no longer
 * resolves — relative to the project root, the state file's grandparent — is
 * `html-gone`: the concept's page was deleted, the session is over (#363).
 * @returns {'ok'|'gone'|'port-changed'|'html-gone'}
 */
function checkState(statePath, port, exists) {
  let raw;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch (err) {
    // Only "the file is not there" means the concept ended. A transient read
    // error — EBUSY/EPERM during a state rewrite on Windows, EMFILE under load
    // — must be tolerated exactly like the half-written JSON below, or the one
    // terminal verdict fires on a live concept.
    return err && err.code === 'ENOENT' ? 'gone' : 'ok';
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A half-written file during a state rewrite is not a dead concept.
    return 'ok';
  }
  if (!parsed || typeof parsed.port !== 'number') return 'gone';
  // Numeric, so no `"port": 8883` spacing dependency and no 8883-vs-88831 slip.
  if (parsed.port !== port) return 'port-changed';
  if (exists && typeof parsed.html_path === 'string' && parsed.html_path) {
    const root = path.dirname(path.dirname(statePath));
    if (!exists(path.join(root, parsed.html_path))) return 'html-gone';
  }
  return 'ok';
}

/** The state file as an object, or null while it is missing / half-written. */
function readState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Re-open the concept page in the user's browser (#363). Detached and
 * fire-and-forget: a browser that refuses to start must not take the waker
 * down with it. Windows opens Edge explicitly — the page is a localhost URL
 * and `start` would otherwise pick whatever handles http://.
 */
function reopen(url) {
  const { spawn } = require('child_process');
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', 'msedge', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  } catch { /* best effort */ }
}

function request(port, path, method, timeoutSec) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, timeout: timeoutSec * 1000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: res.statusCode === 200, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '' }); });
    req.on('error', () => resolve({ ok: false, body: '' }));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(tag, reason, detail = '') {
  // Synchronous write: the reason line IS the payload of the wake, and on
  // POSIX a piped stdout is async — `process.exit` right after an async write
  // can truncate it.
  const line = `${tag}_EXIT reason=${reason}${detail}\n`;
  try { fs.writeSync(1, line); }
  catch { process.stdout.write(line); }
  process.exit(0);
}

async function run(opts, deps = {}) {
  const io = { request, sleep, checkState, readState, reopen, now: Date.now, exists: (p) => fs.existsSync(p), ...deps };
  const tag = opts.mode === 'pulse' ? 'PULSER' : 'WAKER';
  const watch = opts.mode === 'watch';
  const intervalMs = opts.interval * 1000;
  const emit = deps.emit || ((reason, detail) => finish(tag, reason, detail));
  // Cleanup is the waker's job (#363): it shuts the bridge down before it
  // leaves, so a dead concept never keeps a server alive waiting for a cron.
  const leave = async (reason) => {
    if (watch) await io.request(opts.port, '/shutdown', 'POST', opts.timeout);
    return emit(reason);
  };

  // The launch step used to run before the state file was written, which made
  // the very first check fatal. Wait it out instead.
  // Distinct from STATE_GONE on purpose. "The file vanished" means the concept
  // ended and nothing should be re-launched; "the file never showed up" means
  // the launch outran its setup, and re-launching is exactly right. Collapsing
  // the two would tell Claude to stand down on a live concept.
  const deadline = opts.grace * 1000;
  for (let waited = 0; !io.exists(opts.state); waited += intervalMs) {
    if (waited >= deadline) return emit('STATE_NEVER_APPEARED');
    await io.sleep(Math.min(intervalMs, deadline - waited));
  }

  let fails = 0;
  let failingSince = 0;   // io.now() of the first failure in the current streak
  // Cleanup verdicts are debounced (DEFAULTS.confirm): the verdict must be
  // the SAME one on `confirm` consecutive polls. A different verdict (or
  // 'ok') in between resets the count — a rewrite window is a blip, not a
  // trend.
  let lastVerdict = 'ok';
  let verdictRuns = 0;
  const confirmed = (verdict) => {
    if (verdict === lastVerdict) verdictRuns += 1;
    else { lastVerdict = verdict; verdictRuns = 1; }
    return verdict !== 'ok' && verdictRuns >= opts.confirm;
  };
  // Who polled before me, per the server's echo (see pulserId).
  const myId = io.pulserId ? io.pulserId() : pulserId(io.now);
  const myStart = pulserStart(myId);
  let siblingRuns = 0;
  const siblingSeen = (prev, yieldTo) => {
    const prevStart = pulserStart(prev);
    const sibling = prev !== myId && Number.isFinite(prevStart)
      && (yieldTo === 'older' ? prevStart < myStart : prevStart > myStart);
    siblingRuns = sibling ? siblingRuns + 1 : 0;
    return siblingRuns >= DUPLICATE_AFTER;
  };
  // Page liveness (watch mode). The server reports on /pending:
  //   browser_ts     — last poll from ANY tab (legacy any-tab signal),
  //   browser_tabs   — tabs currently registered (polled within the server's
  //                    TAB_STALE_MS and no /bye yet)          — since #397,
  //   browser_bye_ts — last unload beacon                     — since #397.
  // "Closed" is decided in this order:
  //   1. a tab is registered            → open, whatever browser_ts says
  //                                       (hidden + throttled ≠ closed);
  //   2. none registered, a /bye landed after the last poll and BYE_GRACE_MS
  //      have passed                    → closed (the user closed the last tab);
  //   3. none registered, silent for `liveness` → closed (tab died without
  //      a beacon, or an old page build without tab ids).
  // Against a server without `browser_tabs` (older build) only rule 3 applies.
  // A reopen fires ONCE; the flag re-arms only after a tab is seen again, so
  // a browser closed on purpose gets one reopen, never a storm. Before the
  // first poll the watcher's own start is the baseline — a page that never
  // opened is as closed as one that was closed.
  const startedAt = io.now();
  let reopened = false;
  for (;;) {
    const state = io.checkState(opts.state, opts.port, watch ? io.exists : undefined);
    if (confirmed(state)) {
      if (state === 'gone') return leave('STATE_GONE');
      if (state === 'port-changed') return leave('PORT_CHANGED');
      if (state === 'html-gone') return leave('HTML_GONE');
    }

    const res = opts.mode === 'pulse'
      ? await io.request(opts.port, '/heartbeat?pulser=' + encodeURIComponent(myId), 'POST', opts.timeout)
      : await io.request(opts.port, '/pending?waker=' + encodeURIComponent(myId), 'GET', opts.timeout);

    if (res.ok) {
      fails = 0;
      failingSince = 0;
      let body = {};
      try { body = JSON.parse(res.body) || {}; } catch { /* legacy server / treat as not pending */ }
      if (!watch) {
        // Duplicate detection (see pulserId): the younger pulser yields.
        if (siblingSeen(body.prev_pulser, 'older')) return emit('DUPLICATE_PULSER');
      }
      if (watch) {
        // A pending submission outranks everything: it is the wake this
        // task exists for, and the duplicate that also wakes is the lesser
        // evil (Step 5a treats a second wake as stale). Otherwise the OLDER
        // waker yields to the session that re-armed — without /shutdown, the
        // bridge is the younger one's now.
        if (!body.pending && siblingSeen(body.prev_waker, 'younger')) return emit('DUPLICATE_WAKER');
        if (body.pending) {
          const version = Number.isInteger(body.version) ? ` version=${body.version}` : '';
          const action = typeof body.action === 'string' && /^[a-z-]+$/.test(body.action) ? ` action=${body.action}` : '';
          return emit('PENDING_SUBMISSION', version + action);
        }
        if (opts.liveness > 0) {
          const now = io.now();
          const seen = Number.isFinite(body.browser_ts) && body.browser_ts > 0 ? body.browser_ts : startedAt;
          const silentMs = now - seen;
          const tabs = Number.isInteger(body.browser_tabs) ? body.browser_tabs : null;
          const byeTs = Number.isFinite(body.browser_bye_ts) ? body.browser_bye_ts : 0;
          const saidBye = byeTs > seen && now - byeTs >= BYE_GRACE_MS;
          const closed = tabs === null
            ? silentMs >= opts.liveness * 1000
            : tabs === 0 && (saidBye || silentMs >= opts.liveness * 1000);
          if (!closed) {
            reopened = false;
          } else if (!reopened) {
            const st = io.readState(opts.state);
            const html = st && typeof st.html_path === 'string' ? st.html_path : '';
            if (html) {
              reopened = true;
              io.reopen(`http://localhost:${opts.port}/${html.replace(/^\/+/, '')}`);
            }
          }
        }
      }
    } else {
      // Tolerate transient blips — a single failed request (server busy, a
      // competing request) must not tear the watcher down, or the page goes
      // stale on every hiccup.
      fails += 1;
      if (!failingSince) failingSince = io.now();
      // The pulser NEVER gives up while the state file says the concept is
      // alive. Its exit used to be a second "relaunch the bridge" signal on
      // top of the waker's, and on a bridge that was only slow it left the
      // page red until someone re-armed it by hand — the concept's most
      // common failure. A bridge that is really gone is relaunched off the
      // waker's SERVER_DEAD (or by ss.concept.resume), on the same port, and
      // this pulser simply reconnects. It leaves when the state file does.
      if (watch && fails >= opts.tolerate && io.now() - failingSince >= opts.deadAfter * 1000) {
        return emit('SERVER_DEAD');
      }
    }

    await io.sleep(intervalMs);
  }
}

module.exports = { parseArgs, validate, checkState, readState, reopen, run, pulserId, pulserStart, DEFAULTS, BYE_GRACE_MS, DUPLICATE_AFTER };

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const err = validate(opts);
  if (err) {
    process.stderr.write(`concept-watch: ${err}\n`);
    process.stderr.write('usage: concept-watch.js --mode pulse|watch --port <n> --state <abs path> [--interval 20] [--grace 60] [--liveness 900]\n');
    process.exit(2);
  }
  // A crash must still announce itself as a reason line, not as a stack trace:
  // the exit IS the wake, and an unhandled rejection would exit 1 with nothing
  // the reason → action table can key off.
  run(opts).catch(() => finish(opts.mode === 'pulse' ? 'PULSER' : 'WAKER', 'SERVER_DEAD'));
}
