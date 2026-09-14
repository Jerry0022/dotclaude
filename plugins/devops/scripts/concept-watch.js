#!/usr/bin/env node
/**
 * @script concept-watch
 * @version 0.1.0
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
 *                     - page liveness: no browser poll (GET /heartbeat or
 *                       GET /reload, reported by the server as `browser_ts`)
 *                       for `--liveness` seconds ⇒ re-open the page in the
 *                       user's browser, at most once per silence window;
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
 *   plus `STATE_NEVER_APPEARED` for a launch that outran its setup and
 *   `HTML_GONE` for a concept whose page was deleted (#363). A
 *   `PENDING_SUBMISSION` line carries `version=N action=<a>` after the reason.
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
  timeout: 8,        // seconds per request
  liveness: 180,     // seconds without a browser poll before the page is re-opened (watch mode; 0 = off)
};

function parseArgs(argv) {
  const out = { mode: '', port: 0, state: '', ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (!key) continue;
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) continue;
    i++;
    if (key === 'mode' || key === 'state') out[key] = raw;
    // hasOwn, not `in` — `in` walks the prototype chain, so `--toString 5`
    // would set junk on the options object.
    else if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) || key === 'port') out[key] = Number(raw);
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
  return null;
}

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
  // Page liveness (watch mode): the server reports the last browser poll as
  // `browser_ts`. Silence longer than `liveness` re-opens the page ONCE; the
  // flag re-arms only after a tab has polled again, so a browser that is
  // closed on purpose gets one reopen, never a storm. Before the first poll
  // the watcher's own start is the baseline — a page that never opened is
  // as closed as one that was closed.
  const startedAt = io.now();
  let reopened = false;
  for (;;) {
    const state = io.checkState(opts.state, opts.port, watch ? io.exists : undefined);
    if (state === 'gone') return leave('STATE_GONE');
    if (state === 'port-changed') return leave('PORT_CHANGED');
    if (state === 'html-gone') return leave('HTML_GONE');

    const res = opts.mode === 'pulse'
      ? await io.request(opts.port, '/heartbeat', 'POST', opts.timeout)
      : await io.request(opts.port, '/pending', 'GET', opts.timeout);

    if (res.ok) {
      fails = 0;
      if (watch) {
        let body = {};
        try { body = JSON.parse(res.body) || {}; } catch { /* treat as not pending */ }
        if (body.pending) {
          const version = Number.isInteger(body.version) ? ` version=${body.version}` : '';
          const action = typeof body.action === 'string' && /^[a-z-]+$/.test(body.action) ? ` action=${body.action}` : '';
          return emit('PENDING_SUBMISSION', version + action);
        }
        if (opts.liveness > 0) {
          const seen = Number.isFinite(body.browser_ts) && body.browser_ts > 0 ? body.browser_ts : startedAt;
          const silentMs = io.now() - seen;
          if (silentMs < opts.liveness * 1000) {
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
    } else if (++fails >= opts.tolerate) {
      // Tolerate transient blips — a single failed request (server busy, a
      // competing request) must not tear the watcher down, or the page goes
      // stale on every hiccup.
      return emit('SERVER_DEAD');
    }

    await io.sleep(intervalMs);
  }
}

module.exports = { parseArgs, validate, checkState, readState, reopen, run, DEFAULTS };

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const err = validate(opts);
  if (err) {
    process.stderr.write(`concept-watch: ${err}\n`);
    process.stderr.write('usage: concept-watch.js --mode pulse|watch --port <n> --state <abs path> [--interval 20] [--grace 60] [--liveness 180]\n');
    process.exit(2);
  }
  // A crash must still announce itself as a reason line, not as a stack trace:
  // the exit IS the wake, and an unhandled rejection would exit 1 with nothing
  // the reason → action table can key off.
  run(opts).catch(() => finish(opts.mode === 'pulse' ? 'PULSER' : 'WAKER', 'SERVER_DEAD'));
}
